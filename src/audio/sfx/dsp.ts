/**
 * Tiny offline DSP toolkit used to synthesise the built-in sounds sample by sample.
 * Pure functions on Float32Array — runs in the browser and in Node (unit tests).
 */

export const TAU = Math.PI * 2;
export type Curve = number | ((t: number) => number);
export type Stereo = [Float32Array, Float32Array];

export const at = (c: Curve, t: number): number => (typeof c === 'number' ? c : c(t));
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const samples = (sr: number, seconds: number) => Math.max(1, Math.round(sr * seconds));
export const silence = (sr: number, seconds: number) => new Float32Array(samples(sr, seconds));

/** Deterministic PRNG (mulberry32) so every build generates identical sounds. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  bi(): number {
    return this.next() * 2 - 1;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export type Wave = 'sine' | 'saw' | 'square' | 'triangle' | 'pulse';

export interface OscOptions {
  phase?: number;
  /** pulse width for 'pulse' (0..1) */
  width?: Curve;
  /** vibrato: [rate Hz, depth in semitones] */
  vibrato?: [number, number];
}

/** Band-limited oscillator with an arbitrary frequency curve (Hz as a function of time). */
export function osc(sr: number, seconds: number, freq: Curve, wave: Wave = 'sine', opts: OscOptions = {}): Float32Array {
  const n = samples(sr, seconds);
  const out = new Float32Array(n);
  let ph = opts.phase ?? 0;
  const vib = opts.vibrato;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let f = at(freq, t);
    if (vib) f *= Math.pow(2, (vib[1] * Math.sin(TAU * vib[0] * t)) / 12);
    f = Math.max(0, f);
    const dt = Math.min(0.5, f / sr);
    let v: number;
    switch (wave) {
      case 'sine':
        v = Math.sin(TAU * ph);
        break;
      case 'saw':
        v = 2 * ph - 1 - polyBlep(ph, dt);
        break;
      case 'square':
      case 'pulse': {
        const w = wave === 'pulse' ? clamp(at(opts.width ?? 0.5, t), 0.05, 0.95) : 0.5;
        v = ph < w ? 1 : -1;
        v += polyBlep(ph, dt);
        v -= polyBlep((ph + 1 - w) % 1, dt);
        break;
      }
      case 'triangle':
        v = 1 - 4 * Math.abs(Math.round(ph - 0.25) - (ph - 0.25));
        break;
    }
    out[i] = v;
    ph += f / sr;
    ph -= Math.floor(ph);
  }
  return out;
}

/** FM pair: carrier frequency curve, modulator ratio, index curve. */
export function fm(sr: number, seconds: number, carrier: Curve, ratio: number, index: Curve): Float32Array {
  const n = samples(sr, seconds);
  const out = new Float32Array(n);
  let pc = 0;
  let pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fc = at(carrier, t);
    out[i] = Math.sin(TAU * pc + at(index, t) * Math.sin(TAU * pm));
    pc += fc / sr;
    pm += (fc * ratio) / sr;
    pc -= Math.floor(pc);
    pm -= Math.floor(pm);
  }
  return out;
}

export function noise(sr: number, seconds: number, rng: Rng, color: 'white' | 'pink' | 'brown' = 'white'): Float32Array {
  const n = samples(sr, seconds);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, brown = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.bi();
    if (color === 'white') out[i] = w;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      out[i] = brown * 3.5;
    }
  }
  return out;
}

/** Sum of square waves at inharmonic ratios — the classic metallic cymbal/cowbell source. */
export function metallic(sr: number, seconds: number, freqs: readonly number[]): Float32Array {
  const out = new Float32Array(samples(sr, seconds));
  for (const f of freqs) add(out, osc(sr, seconds, f, 'square'), 1 / freqs.length);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------

/** Piecewise-linear envelope from [time, value] points (value held after the last point). */
export function env(sr: number, seconds: number, points: ReadonlyArray<readonly [number, number]>): Float32Array {
  const n = samples(sr, seconds);
  const out = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t <= points[0][0]) {
      out[i] = points[0][1];
      continue;
    }
    while (k < points.length - 1 && t > points[k + 1][0]) k++;
    if (k >= points.length - 1) {
      out[i] = points[points.length - 1][1];
      continue;
    }
    const [t0, v0] = points[k];
    const [t1, v1] = points[k + 1];
    out[i] = lerp(v0, v1, (t - t0) / Math.max(1e-9, t1 - t0));
  }
  return out;
}

/** Attack then exponential decay (time constant = decay seconds to reach ~37 %). */
export function decayEnv(sr: number, seconds: number, attack: number, decay: number, delay = 0): Float32Array {
  const n = samples(sr, seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr - delay;
    if (t < 0) continue;
    out[i] = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
  }
  return out;
}

export const expDecay = (decay: number, delay = 0) => (t: number) => (t < delay ? 0 : Math.exp(-(t - delay) / decay));

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak';

/** RBJ biquad; frequency / Q may vary over time (coefficients refreshed every 32 samples). */
export function biquad(input: Float32Array, sr: number, type: FilterType, freq: Curve, q: Curve = Math.SQRT1_2, gainDb = 0): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const update = (t: number) => {
    const f = clamp(at(freq, t), 10, sr * 0.48);
    const Q = Math.max(0.05, at(q, t));
    const w0 = (TAU * f) / sr;
    const cs = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    let nb0: number, nb1: number, nb2: number, na0: number;
    let na1 = -2 * cs;
    let na2 = 1 - alpha;
    na0 = 1 + alpha;
    switch (type) {
      case 'lowpass':
        nb0 = (1 - cs) / 2;
        nb1 = 1 - cs;
        nb2 = nb0;
        break;
      case 'highpass':
        nb0 = (1 + cs) / 2;
        nb1 = -(1 + cs);
        nb2 = nb0;
        break;
      case 'bandpass':
        nb0 = alpha;
        nb1 = 0;
        nb2 = -alpha;
        break;
      case 'notch':
        nb0 = 1;
        nb1 = -2 * cs;
        nb2 = 1;
        break;
      case 'peak': {
        const A = Math.pow(10, gainDb / 40);
        nb0 = 1 + alpha * A;
        nb1 = -2 * cs;
        nb2 = 1 - alpha * A;
        na0 = 1 + alpha / A;
        na1 = -2 * cs;
        na2 = 1 - alpha / A;
        break;
      }
    }
    b0 = nb0 / na0;
    b1 = nb1 / na0;
    b2 = nb2 / na0;
    a1 = na1 / na0;
    a2 = na2 / na0;
  };
  const constant = typeof freq === 'number' && typeof q === 'number';
  update(0);
  for (let i = 0; i < n; i++) {
    if (!constant && (i & 31) === 0) update(i / sr);
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

export const lowpass = (s: Float32Array, sr: number, f: Curve, q: Curve = Math.SQRT1_2) => biquad(s, sr, 'lowpass', f, q);
export const highpass = (s: Float32Array, sr: number, f: Curve, q: Curve = Math.SQRT1_2) => biquad(s, sr, 'highpass', f, q);
export const bandpass = (s: Float32Array, sr: number, f: Curve, q: Curve = 1) => biquad(s, sr, 'bandpass', f, q);

/** Removes DC offset (one-pole high-pass at ~20 Hz). */
export function dcBlock(s: Float32Array, sr: number): Float32Array {
  const R = Math.exp((-TAU * 20) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    const y = x - x1 + R * y1;
    x1 = x;
    y1 = y;
    s[i] = y;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

/** Soft saturation (tanh), output roughly level-matched. */
export function drive(s: Float32Array, amount: number): Float32Array {
  const norm = 1 / Math.tanh(Math.max(0.01, amount));
  for (let i = 0; i < s.length; i++) s[i] = Math.tanh(s[i] * amount) * norm;
  return s;
}

export function crush(s: Float32Array, bits: number, hold: number): Float32Array {
  const steps = Math.pow(2, bits - 1);
  let held = 0;
  for (let i = 0; i < s.length; i++) {
    if (i % Math.max(1, Math.round(hold)) === 0) held = Math.round(s[i] * steps) / steps;
    s[i] = held;
  }
  return s;
}

export function echo(s: Float32Array, sr: number, time: number, feedback: number, mix: number, tail = 1): Float32Array {
  const d = samples(sr, time);
  const out = new Float32Array(s.length + samples(sr, tail));
  out.set(s);
  const wet = new Float32Array(out.length);
  for (let i = d; i < out.length; i++) wet[i] = (out[i - d] ?? 0) + wet[i - d] * feedback;
  for (let i = 0; i < out.length; i++) out[i] += wet[i] * mix;
  return out;
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

/** Freeverb-style stereo reverb. Returns [L, R] with `tail` seconds appended. */
export function reverb(input: Float32Array, sr: number, opts: { size?: number; damp?: number; mix?: number; tail?: number; width?: number } = {}): Stereo {
  const { size = 0.8, damp = 0.4, mix = 0.3, tail = 1.5, width = 1 } = opts;
  const n = input.length + samples(sr, tail);
  const scale = sr / 44100;
  const feedback = size * 0.28 + 0.7;
  const d = damp * 0.4;
  const channel = (spread: number): Float32Array => {
    const out = new Float32Array(n);
    const combs = COMBS.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0, store: 0 }));
    const aps = ALLPASSES.map((a) => ({ buf: new Float32Array(Math.round((a + spread) * scale)), i: 0 }));
    for (let k = 0; k < n; k++) {
      const x = (k < input.length ? input[k] : 0) * 0.015;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.store = y * (1 - d) + c.store * d;
        c.buf[c.i] = x + c.store * feedback;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i];
        const y = -acc + b;
        a.buf[a.i] = acc + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = y;
      }
      out[k] = acc;
    }
    return out;
  };
  const wl = channel(0);
  const wr = channel(23 * width);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const wet = mix * 3;
  for (let k = 0; k < n; k++) {
    const dry = k < input.length ? input[k] * (1 - mix * 0.5) : 0;
    L[k] = dry + wl[k] * wet;
    R[k] = dry + wr[k] * wet;
  }
  return [L, R];
}

// ---------------------------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------------------------

export function mul(a: Float32Array, b: Float32Array | Curve, sr?: number): Float32Array {
  if (b instanceof Float32Array) {
    for (let i = 0; i < a.length; i++) a[i] *= i < b.length ? b[i] : 0;
  } else if (typeof b === 'number') {
    for (let i = 0; i < a.length; i++) a[i] *= b;
  } else {
    const rate = sr ?? 48000;
    for (let i = 0; i < a.length; i++) a[i] *= b(i / rate);
  }
  return a;
}

/** Adds `src` (scaled) into `dst` starting at sample `offset`. */
export function add(dst: Float32Array, src: Float32Array, gain = 1, offset = 0): Float32Array {
  const end = Math.min(dst.length, offset + src.length);
  for (let i = Math.max(0, offset); i < end; i++) dst[i] += src[i - offset] * gain;
  return dst;
}

/** Places `src` at `atSeconds` in `dst`. */
export const place = (dst: Float32Array, src: Float32Array, sr: number, atSeconds: number, gain = 1) =>
  add(dst, src, gain, Math.round(atSeconds * sr));

export function peak(s: Float32Array): number {
  let p = 0;
  for (let i = 0; i < s.length; i++) p = Math.max(p, Math.abs(s[i]));
  return p;
}

export function rms(s: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < s.length; i++) acc += s[i] * s[i];
  return Math.sqrt(acc / Math.max(1, s.length));
}

/** Short fades at both ends so nothing clicks. */
export function fadeEdges(s: Float32Array, sr: number, inMs = 2, outMs = 12): Float32Array {
  const fi = Math.min(s.length, samples(sr, inMs / 1000));
  const fo = Math.min(s.length, samples(sr, outMs / 1000));
  for (let i = 0; i < fi; i++) s[i] *= i / fi;
  for (let i = 0; i < fo; i++) s[s.length - 1 - i] *= i / fo;
  return s;
}

/** Trims trailing near-silence (keeps a little tail). */
export function trimTail(channels: Float32Array[], sr: number, thresholdDb = -60): Float32Array[] {
  const thr = Math.pow(10, thresholdDb / 20);
  let last = 0;
  for (const c of channels) for (let i = c.length - 1; i > last; i--) if (Math.abs(c[i]) > thr) { last = i; break; }
  const end = Math.min(channels[0].length, last + samples(sr, 0.02));
  return channels.map((c) => c.slice(0, Math.max(1, end)));
}

/**
 * Final mastering step for every built-in sound: DC removal, edge fades, then a peak + loudness
 * normalisation so all pads sit at a similar level without clipping.
 */
export function finalize(channels: Float32Array[], sr: number, opts: { peak?: number; maxRms?: number } = {}): Float32Array[] {
  const target = opts.peak ?? 0.89;
  const maxRms = opts.maxRms ?? 0.22;
  let out = channels.map((c) => dcBlock(c, sr));
  out = trimTail(out, sr);
  let p = 0;
  let r = 0;
  for (const c of out) {
    p = Math.max(p, peak(c));
    r = Math.max(r, rms(c));
  }
  if (p > 0) {
    let g = target / p;
    if (r * g > maxRms) g = maxRms / r;
    for (const c of out) mul(c, g);
  }
  for (const c of out) fadeEdges(c, sr);
  return out;
}

/** Mono → stereo with an optional constant pan (-1..1). */
export function toStereo(s: Float32Array, pan = 0): Stereo {
  const a = ((pan + 1) * Math.PI) / 4;
  const L = new Float32Array(s.length);
  const R = new Float32Array(s.length);
  const gl = Math.cos(a) * Math.SQRT2;
  const gr = Math.sin(a) * Math.SQRT2;
  for (let i = 0; i < s.length; i++) {
    L[i] = s[i] * gl;
    R[i] = s[i] * gr;
  }
  return [L, R];
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
