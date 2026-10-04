import { EffectRack } from './EffectRack';
import { encodeWav } from './wav';
import workletUrl from './worklets/moha-worklets.js?url';

export type AudioStatus = 'locked' | 'running' | 'suspended' | 'interrupted' | 'closed' | 'unsupported';
export type WorkletStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface AudioInfo {
  status: AudioStatus;
  sampleRate: number;
  baseLatency: number | null;
  outputLatency: number | null;
  worklets: WorkletStatus;
  canSelectOutput: boolean;
  sinkId: string;
  volume: number;
  muted: boolean;
  /** true once the user unlocked audio at least once (START was clicked) */
  unlocked: boolean;
}

export const TRACK_COUNT = 8;

/** Every node of the graph; rebuilt from scratch on RESET AUDIO. */
export interface AudioGraph {
  /** live pad triggers (keyboard, touch, gestures) */
  liveBus: GainNode;
  /** sequencer tracks */
  trackBuses: GainNode[];
  synthBus: GainNode;
  mixBus: GainNode;
  fx: EffectRack;
  master: GainNode;
  mute: GainNode;
  panner: StereoPannerNode | null;
  limiter: DynamicsCompressorNode;
  /** post-limiter tap: what speakers play AND what recorders capture */
  recordTap: GainNode;
  analyser: AnalyserNode;
  /** test / confirmation tones: enter after the effects, so FX settings can never hide them */
  testBus: GainNode;
  /** metronome: heard, never recorded */
  clickBus: GainNode;
  output: GainNode;
}

type Listener = () => void;

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * Owns the single AudioContext of the app and its routing graph.
 *
 *   liveBus / trackBuses / synthBus → mixBus → FX rack → master → mute → pan → limiter → recordTap → output → speakers
 *                                                                                        ├→ analyser (meters)
 *                                                                                        └→ recorders (tap BEFORE destination)
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  graph: AudioGraph | null = null;
  /** increments every time the graph is rebuilt; voices from older generations are stale */
  generation = 0;
  private volume = 0.9;
  private muted = false;
  private pan = 0;
  private workletStatus: WorkletStatus = 'idle';
  private unlocked = false;
  private listeners = new Set<Listener>();
  private rebuildListeners = new Set<Listener>();
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private meterCache = { at: 0, peak: 0, rms: 0 };
  private silentAudio: HTMLAudioElement | null = null;
  private infoCache: AudioInfo | null = null;
  glitchNode: AudioWorkletNode | null = null;
  recorderWorkletReady = false;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && (typeof window.AudioContext !== 'undefined' || !!(window as WebkitWindow).webkitAudioContext);
  }

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.tryAutoResume();
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------

  /**
   * MUST be called synchronously inside a user gesture (click / tap / key).
   * Creates the context on first use, resumes it, and plays a silent buffer so iOS/Safari unlock.
   */
  unlock(): boolean {
    if (!AudioEngine.isSupported()) {
      this.emit();
      return false;
    }
    this.setPlaybackSession();
    if (!this.ctx || this.ctx.state === 'closed') this.create();
    const ctx = this.ctx!;
    // A buffer started synchronously within the gesture is what unlocks WebKit.
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    if (ctx.state !== 'running') {
      ctx.resume().then(
        () => this.emit(),
        (err) => console.warn('[audio] resume() rejected', err),
      );
    }
    this.unlocked = true;
    this.emit();
    return true;
  }

  /** Resume after the browser paused audio (tab hidden, phone call…). Call from a gesture. */
  resume(): Promise<void> {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.unlock();
      return Promise.resolve();
    }
    this.setPlaybackSession();
    return this.ctx.resume().then(() => this.emit());
  }

  /** Throws away the context and builds a fresh one. Call from a gesture. */
  reset(): void {
    const old = this.ctx;
    this.ctx = null;
    this.graph = null;
    this.workletStatus = 'idle';
    this.glitchNode = null;
    this.recorderWorkletReady = false;
    this.unlock();
    if (old) void old.close().catch(() => undefined);
  }

  async waitUntilRunning(timeoutMs = 2000): Promise<boolean> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (this.ctx?.state === 'running') return true;
      await new Promise((r) => setTimeout(r, 30));
    }
    return this.ctx?.state === 'running';
  }

  private async tryAutoResume() {
    if (!this.ctx || !this.unlocked) return;
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* needs a gesture: the "audio paused" banner handles it */
      }
    }
    this.emit();
  }

  private create() {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext!;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      ctx = new Ctor();
    }
    this.ctx = ctx;
    ctx.onstatechange = () => this.emit();
    this.graph = this.buildGraph(ctx);
    this.generation++;
    this.applyMaster();
    for (const cb of this.rebuildListeners) cb();
    void this.loadWorklets(ctx);
  }

  private buildGraph(ctx: AudioContext): AudioGraph {
    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const mixBus = gain();
    const liveBus = gain();
    const synthBus = gain(0.8);
    const trackBuses = Array.from({ length: TRACK_COUNT }, () => gain());
    liveBus.connect(mixBus);
    synthBus.connect(mixBus);
    for (const t of trackBuses) t.connect(mixBus);

    const fx = new EffectRack(ctx);
    mixBus.connect(fx.input);

    const master = gain(this.volume);
    const mute = gain(this.muted ? 0 : 1);
    fx.output.connect(master).connect(mute);

    let panner: StereoPannerNode | null = null;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      mute.connect(panner).connect(limiter);
    } else {
      mute.connect(limiter);
    }

    const testBus = gain();
    testBus.connect(limiter);

    const recordTap = gain();
    limiter.connect(recordTap);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    recordTap.connect(analyser);

    const output = gain();
    recordTap.connect(output);
    const clickBus = gain(0.7);
    clickBus.connect(output);
    output.connect(ctx.destination);

    this.meterBuf = new Float32Array(analyser.fftSize);
    return { liveBus, trackBuses, synthBus, mixBus, fx, master, mute, panner, limiter, recordTap, analyser, testBus, clickBus, output };
  }

  private async loadWorklets(ctx: AudioContext) {
    if (!ctx.audioWorklet) {
      this.workletStatus = 'failed';
      this.emit();
      return;
    }
    this.workletStatus = 'loading';
    this.emit();
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      if (ctx !== this.ctx || !this.graph) return;
      const node = new AudioWorkletNode(ctx, 'moha-glitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.graph.fx.attachGlitch(node);
      this.glitchNode = node;
      this.recorderWorkletReady = true;
      this.workletStatus = 'ready';
    } catch (err) {
      console.warn('[audio] AudioWorklet unavailable — stutter/tape effects and WAV capture disabled', err);
      this.workletStatus = 'failed';
    }
    this.emit();
  }

  /** iPhone silent switch: ask for the "playback" audio session so sounds are audible anyway. */
  private setPlaybackSession() {
    const nav = navigator as Navigator & AudioSessionNavigator;
    try {
      if (nav.audioSession) {
        if (nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
        return;
      }
    } catch {
      /* ignore */
    }
    // Older iOS: a looping silent <audio> element switches the session category to playback.
    const isAppleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isAppleTouch || this.silentAudio) return;
    try {
      const wav = encodeWav([new Float32Array(4410)], 44100);
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const el = document.createElement('audio');
      el.setAttribute('x-webkit-airplay', 'deny');
      el.preload = 'auto';
      el.loop = true;
      el.src = url;
      void el.play().catch(() => undefined);
      this.silentAudio = el;
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------
  // Master controls
  // ------------------------------------------------------------------------------------------

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
    this.emit();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
    this.emit();
  }

  setPan(p: number): void {
    this.pan = Math.max(-1, Math.min(1, p));
    this.applyMaster();
  }

  private applyMaster() {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const now = ctx.currentTime;
    g.master.gain.setTargetAtTime(this.volume, now, 0.02);
    g.mute.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.01);
    g.panner?.pan.setTargetAtTime(this.pan, now, 0.03);
  }

  async setOutputDevice(sinkId: string): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) throw new Error('setSinkId unsupported');
    await ctx.setSinkId(sinkId);
    this.emit();
  }

  // ------------------------------------------------------------------------------------------
  // Test sounds
  // ------------------------------------------------------------------------------------------

  private chime(notes: ReadonlyArray<readonly [number, number]>, level: number, dest?: AudioNode) {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, offset] of notes) {
      for (const [mult, amp] of [[1, 1], [2, 0.3], [3, 0.12]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        const env = ctx.createGain();
        const start = t0 + offset;
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(level * amp, start + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.connect(env).connect(dest ?? g.testBus);
        osc.start(start);
        osc.stop(start + 0.6);
        osc.onended = () => env.disconnect();
      }
    }
  }

  /** Short, clearly audible arpeggio — the "TEST AUDIO" button. */
  playTest(): void {
    this.chime([[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36]], 0.32);
  }

  /** Subtle two-note confirmation played when START unlocks audio. */
  playConfirm(): void {
    this.chime([[783.99, 0], [1174.66, 0.09]], 0.16);
  }

  /** Metronome click (accent = first beat). Scheduled at an exact AudioContext time. */
  click(when: number, accent: boolean): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const osc = ctx.createOscillator();
    osc.frequency.value = accent ? 1760 : 1175;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(env).connect(g.clickBus);
    osc.start(when);
    osc.stop(when + 0.06);
    osc.onended = () => env.disconnect();
  }

  // ------------------------------------------------------------------------------------------
  // Metering & info
  // ------------------------------------------------------------------------------------------

  /** Post-limiter level. Cheap to call from several animation loops (cached per frame). */
  meter(): { peak: number; rms: number } {
    const g = this.graph;
    if (!g || !this.meterBuf) return { peak: 0, rms: 0 };
    const now = performance.now();
    if (now - this.meterCache.at < 8) return this.meterCache;
    g.analyser.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    let acc = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = this.meterBuf[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      acc += v * v;
    }
    this.meterCache = { at: now, peak, rms: Math.sqrt(acc / this.meterBuf.length) };
    return this.meterCache;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Snapshot for UI (stable object between changes, for useSyncExternalStore). */
  getInfo(): AudioInfo {
    if (this.infoCache) return this.infoCache;
    const ctx = this.ctx as (AudioContext & { sinkId?: string; setSinkId?: unknown }) | null;
    const state = ctx?.state as string | undefined;
    let status: AudioStatus;
    if (!AudioEngine.isSupported()) status = 'unsupported';
    else if (!ctx) status = 'locked';
    else if (state === 'running') status = 'running';
    else if (state === 'interrupted') status = 'interrupted';
    else if (state === 'closed') status = 'closed';
    else status = this.unlocked ? 'suspended' : 'locked';
    this.infoCache = {
      status,
      sampleRate: ctx?.sampleRate ?? 0,
      baseLatency: ctx && typeof ctx.baseLatency === 'number' ? ctx.baseLatency : null,
      outputLatency: ctx && typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0 ? ctx.outputLatency : null,
      worklets: this.workletStatus,
      canSelectOutput: typeof ctx?.setSinkId === 'function' || (typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype),
      sinkId: typeof ctx?.sinkId === 'string' ? ctx.sinkId : '',
      volume: this.volume,
      muted: this.muted,
      unlocked: this.unlocked,
    };
    return this.infoCache;
  }

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** Called after a (re)build of the graph — engines drop references to old nodes. */
  onRebuild(cb: Listener): () => void {
    this.rebuildListeners.add(cb);
    return () => this.rebuildListeners.delete(cb);
  }

  private emit() {
    this.infoCache = null;
    for (const cb of this.listeners) cb();
  }
}

export const audioEngine = new AudioEngine();
