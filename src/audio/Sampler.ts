import type { AudioEngine } from './AudioEngine';
import type { SampleLibrary } from './SampleLibrary';
import type { PadConfig } from '../engine/projectTypes';

export type TriggerResult = 'played' | 'stopped' | 'empty' | 'loading' | 'failed' | 'no-audio';

export interface TriggerOptions {
  /** AudioContext time; default = now */
  when?: number;
  /** 0..1 */
  velocity?: number;
  /** destination bus; default = the live bus */
  dest?: AudioNode;
  /** for sequenced gate/loop pads: stop after this many seconds */
  duration?: number;
}

interface Voice {
  key: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  start: number;
  /** context time at which a one-shot ends (Infinity for loops / gates) */
  end: number;
  /** buffer seconds played per real second at pitch 0 (for progress display) */
  span: number;
  baseRate: number;
  choke: number;
  mode: PadConfig['mode'];
  generation: number;
  stopping: boolean;
}

const MAX_VOICES = 48;
const MIN_FADE = 0.003;

/**
 * Plays pads. Each trigger is one AudioBufferSourceNode → GainNode (envelope) → [StereoPanner] → bus,
 * so starting a sound costs almost nothing and always happens on the AudioContext clock.
 */
export class Sampler {
  private voices: Voice[] = [];
  private globalPitch = 0;
  private readonly audio: AudioEngine;
  private readonly library: SampleLibrary;

  constructor(audio: AudioEngine, library: SampleLibrary) {
    this.audio = audio;
    this.library = library;
    audio.onRebuild(() => {
      this.voices = [];
    });
  }

  trigger(key: string, pad: PadConfig, opts: TriggerOptions = {}): TriggerResult {
    if (!pad.sample) return 'empty';
    const ctx = this.audio.ctx;
    const graph = this.audio.graph;
    if (!ctx || !graph || ctx.state !== 'running') return 'no-audio';

    // LOOP pads toggle: a second trigger stops the loop
    if (pad.mode === 'loop' && opts.duration === undefined) {
      const looping = this.voices.filter((v) => v.key === key && !v.stopping);
      if (looping.length) {
        for (const v of looping) this.stopVoice(v, Math.max(0.02, pad.fadeOut));
        return 'stopped';
      }
    }

    const ref = pad.sample;
    if (this.library.hasFailed(ref)) return 'failed';
    const base = this.library.get(ref);
    if (!base) {
      // not generated/decoded yet: fetch with priority and play if it arrives quickly
      const askedAt = performance.now();
      void this.library.load(ref, true).then((buf) => {
        if (buf && performance.now() - askedAt < 450) this.trigger(key, pad, { ...opts, when: undefined });
      });
      return 'loading';
    }
    const buffer = pad.reverse ? (this.library.getReversed(ref) ?? base) : base;

    const now = ctx.currentTime;
    const when = Math.max(now, opts.when ?? now);
    const velocity = Math.max(0, Math.min(1, opts.velocity ?? 1));
    const dur = buffer.duration;
    let s = Math.max(0, Math.min(dur - 0.005, pad.trimStart));
    let e = pad.trimEnd > 0 ? Math.max(s + 0.005, Math.min(dur, pad.trimEnd)) : dur;
    if (pad.reverse) [s, e] = [dur - e, dur - s];
    const span = e - s;

    // choke group + retrigger: silence related voices first
    if (pad.choke > 0) for (const v of this.voices) if (v.choke === pad.choke && v.key !== key && !v.stopping) this.stopVoice(v, 0.012, when);
    if (pad.mode === 'retrigger' || pad.mode === 'gate') for (const v of this.voices) if (v.key === key && !v.stopping) this.stopVoice(v, 0.006, when);

    // polyphony limits (per pad, then global)
    const mine = this.voices.filter((v) => v.key === key && !v.stopping);
    while (mine.length >= Math.max(1, pad.poly)) this.stopVoice(mine.shift()!, 0.012, when);
    if (this.voices.length >= MAX_VOICES) this.stopVoice(this.voices[0], 0.01, when);

    const rate = Math.pow(2, (pad.pitch + this.globalPitch) / 12);
    const baseRate = Math.pow(2, pad.pitch / 12);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const gain = ctx.createGain();
    const level = Math.max(0, Math.min(1.5, pad.volume)) * (0.25 + 0.75 * velocity * velocity);
    const fadeIn = Math.max(MIN_FADE, pad.fadeIn);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + fadeIn);

    let pan: StereoPannerNode | null = null;
    if (pad.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, pad.pan));
      src.connect(gain).connect(pan).connect(opts.dest ?? graph.liveBus);
    } else {
      src.connect(gain).connect(opts.dest ?? graph.liveBus);
    }

    const looping = pad.mode === 'loop';
    let end = Infinity;
    if (looping) {
      src.loop = true;
      src.loopStart = s;
      src.loopEnd = e;
      src.start(when, s);
    } else {
      src.start(when, s, span);
      end = when + span / rate;
      const fadeOut = pad.fadeOut > 0 ? Math.min(pad.fadeOut, span / rate / 2) : pad.trimEnd > 0 ? 0.008 : 0;
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(level, Math.max(when + fadeIn, end - fadeOut));
        gain.gain.linearRampToValueAtTime(0, end);
      }
    }

    const voice: Voice = {
      key,
      src,
      gain,
      pan,
      start: when,
      end: pad.mode === 'gate' && opts.duration === undefined ? end : end,
      span,
      baseRate,
      choke: pad.choke,
      mode: pad.mode,
      generation: this.audio.generation,
      stopping: false,
    };
    src.onended = () => this.cleanup(voice);
    this.voices.push(voice);

    if (opts.duration !== undefined && (looping || pad.mode === 'gate')) {
      this.stopVoice(voice, Math.max(0.01, pad.fadeOut), when + opts.duration);
    }
    return 'played';
  }

  /** Gate pads stop when released (key up, finger up, gesture end). */
  release(key: string): void {
    for (const v of this.voices) if (v.key === key && v.mode === 'gate' && !v.stopping) this.stopVoice(v, 0.03);
  }

  stopKey(key: string, fade = 0.02): void {
    for (const v of [...this.voices]) if (v.key === key && !v.stopping) this.stopVoice(v, fade);
  }

  stopAll(fade = 0.05): void {
    for (const v of [...this.voices]) if (!v.stopping) this.stopVoice(v, fade);
  }

  /** Global pitch shift (gesture effect) — also bends sounds that are already playing. */
  setGlobalPitch(semitones: number): void {
    this.globalPitch = semitones;
    const ctx = this.audio.ctx;
    if (!ctx) return;
    for (const v of this.voices) v.src.playbackRate.setTargetAtTime(v.baseRate * Math.pow(2, semitones / 12), ctx.currentTime, 0.03);
  }

  isActive(key: string): boolean {
    const now = this.audio.now;
    return this.voices.some((v) => v.key === key && !v.stopping && v.start <= now + 0.01);
  }

  /** 0..1 progress of the newest voice of a pad (null if silent; 1 = looping). */
  progress(key: string): number | null {
    const now = this.audio.now;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.key !== key || v.stopping) continue;
      if (!Number.isFinite(v.end)) return 1;
      return Math.max(0, Math.min(1, (now - v.start) / Math.max(0.001, v.end - v.start)));
    }
    return null;
  }

  get activeCount(): number {
    return this.voices.filter((v) => !v.stopping).length;
  }

  private stopVoice(v: Voice, fade: number, at?: number) {
    const ctx = this.audio.ctx;
    if (!ctx || v.generation !== this.audio.generation) {
      this.cleanup(v);
      return;
    }
    v.stopping = true;
    const t = Math.max(ctx.currentTime, at ?? ctx.currentTime);
    const g = v.gain.gain;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + Math.max(MIN_FADE, fade));
      v.src.stop(t + Math.max(MIN_FADE, fade) + 0.01);
    } catch {
      this.cleanup(v);
    }
  }

  private cleanup(v: Voice) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      v.src.disconnect();
      v.gain.disconnect();
      v.pan?.disconnect();
    } catch {
      /* already gone */
    }
  }
}
