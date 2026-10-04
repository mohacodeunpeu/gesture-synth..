/**
 * Master effects chain (node level):
 *
 *   input → HP → LP (DJ filter) → [glitch worklet: stutter / tape stop] → dry ─────────────┐
 *                                                     ├→ delay send → delay ⟲ feedback → ├→ output
 *                                                     └→ reverb send → convolver ───────→ ┘
 *
 * Every parameter change is smoothed with setTargetAtTime so gestures never produce zipper noise.
 * The glitch worklet is spliced in asynchronously; until (or unless) it loads, the chain works
 * without it.
 */
export class EffectRack {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly hp: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private readonly glitchIn: GainNode;
  private readonly glitchOut: GainNode;
  private glitch: AudioWorkletNode | null = null;
  private readonly delay: DelayNode;
  private readonly delaySend: GainNode;
  private readonly delayFb: GainNode;
  private readonly delayTone: BiquadFilterNode;
  private readonly reverbSend: GainNode;
  private readonly convolver: ConvolverNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 10;
    this.hp.Q.value = 0.7;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = this.maxCutoff;
    this.lp.Q.value = 0.7;

    this.glitchIn = ctx.createGain();
    this.glitchOut = ctx.createGain();

    this.input.connect(this.hp).connect(this.lp).connect(this.glitchIn);
    this.glitchIn.connect(this.glitchOut);

    // dry
    this.glitchOut.connect(this.output);

    // delay
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.delay = ctx.createDelay(2.5);
    this.delay.delayTime.value = 0.375;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.35;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 4200;
    this.glitchOut.connect(this.delaySend).connect(this.delay).connect(this.delayTone);
    this.delayTone.connect(this.delayFb).connect(this.delay);
    this.delayTone.connect(this.output);

    // reverb
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.6, 3);
    this.glitchOut.connect(this.reverbSend).connect(this.convolver).connect(this.output);
  }

  private get maxCutoff(): number {
    return Math.min(20000, this.ctx.sampleRate * 0.45);
  }

  private set(param: AudioParam, value: number, tc = 0.015) {
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  /** Splices the stutter/tape worklet into the chain. */
  attachGlitch(node: AudioWorkletNode): void {
    if (this.glitch) return;
    this.glitch = node;
    this.glitchIn.disconnect();
    this.glitchIn.connect(node).connect(this.glitchOut);
  }

  get hasGlitch(): boolean {
    return this.glitch !== null;
  }

  /** DJ filter: -1 = low-pass closed, 0 = open (transparent), +1 = high-pass closed. */
  setFilter(position: number, resonance: number): void {
    const p = Math.abs(position) < 0.02 ? 0 : Math.max(-1, Math.min(1, position));
    const q = 0.7 + Math.max(0, Math.min(1, resonance)) * 11;
    if (p < 0) {
      this.set(this.lp.frequency, Math.max(180, this.maxCutoff * Math.pow(0.012, -p)));
      this.set(this.lp.Q, q);
      this.set(this.hp.frequency, 10);
      this.set(this.hp.Q, 0.7);
    } else {
      this.set(this.hp.frequency, Math.min(7000, 10 * Math.pow(600, p)));
      this.set(this.hp.Q, p > 0 ? q : 0.7);
      this.set(this.lp.frequency, this.maxCutoff);
      this.set(this.lp.Q, 0.7);
    }
  }

  setDelay(mix: number, feedback: number, seconds: number): void {
    this.set(this.delaySend.gain, Math.max(0, Math.min(1, mix)));
    this.set(this.delayFb.gain, Math.max(0, Math.min(0.9, feedback)));
    this.set(this.delay.delayTime, Math.max(0.02, Math.min(2.4, seconds)), 0.06);
  }

  setReverb(mix: number): void {
    this.set(this.reverbSend.gain, Math.max(0, Math.min(1.2, mix * 1.1)));
  }

  setStutter(on: boolean, seconds: number): void {
    this.glitch?.port.postMessage({ type: 'stutter', on, seconds });
  }

  setTapeStop(on: boolean, seconds: number): void {
    this.glitch?.port.postMessage({ type: 'tape', on, seconds });
  }

  dispose(): void {
    for (const n of [this.input, this.hp, this.lp, this.glitchIn, this.glitchOut, this.delaySend, this.delay, this.delayFb, this.delayTone, this.reverbSend, this.convolver, this.output]) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.glitch?.disconnect();
  }
}

/** Stereo noise burst with exponential decay and progressive darkening — a smooth hall. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const pre = Math.floor(rate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const cutoff = 0.6 - 0.5 * x; // brighter early, darker tail
      lp += (rand() * 2 - lp) * cutoff;
      d[i] = lp * Math.pow(1 - x, decay);
    }
  }
  return buf;
}
