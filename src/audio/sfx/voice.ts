import { Rng, TAU, at, bandpass, clamp, highpass, lerp, noise, samples, type Curve } from './dsp';

/**
 * Minimal formant ("talking robot") voice synthesiser: a glottal-like source (band-limited saw +
 * aspiration noise) through four parallel formant resonators whose frequencies glide between vowel
 * keyframes. Good enough for cartoonish "bruh", "wow", "ha ha", choirs…
 */

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'uh' | 'schwa' | 'ae' | 'r' | 'm' | 'w' | 'y' | 'oh';

const FORMANTS: Record<Vowel, [number, number, number, number]> = {
  a: [730, 1090, 2440, 3400],
  e: [530, 1840, 2480, 3500],
  i: [270, 2290, 3010, 3600],
  o: [570, 840, 2410, 3400],
  oh: [450, 800, 2600, 3400],
  u: [300, 870, 2240, 3300],
  uh: [640, 1190, 2390, 3400],
  schwa: [500, 1500, 2500, 3500],
  ae: [660, 1720, 2410, 3400],
  r: [420, 1250, 1600, 3200],
  m: [260, 1000, 2200, 3000],
  w: [300, 610, 2150, 3300],
  y: [260, 2070, 3020, 3600],
};
const BANDWIDTH = [80, 100, 140, 220];
const GAINS = [1, 0.6, 0.34, 0.16];
const NASAL_GAINS = [1, 0.12, 0.06, 0.03];

export interface VoiceSpec {
  duration: number;
  /** fundamental frequency, Hz */
  pitch: Curve;
  /** vowel keyframes [time, vowel]; formants glide linearly between them */
  vowels: ReadonlyArray<readonly [number, Vowel]>;
  /** 0..1 voiced amplitude */
  voicing: Curve;
  /** 0..1 breath/aspiration amplitude ("h" sounds) */
  breath?: Curve;
  /** formant scaling: >1 smaller/brighter (cartoon/child), <1 bigger/darker */
  formantShift?: number;
  /** [rate Hz, depth semitones] */
  vibrato?: readonly [number, number];
  /** random pitch drift amount, semitones */
  jitter?: number;
  seed?: number;
}

function formantTrack(spec: VoiceSpec, k: number): (t: number) => number {
  const frames = spec.vowels;
  const shift = spec.formantShift ?? 1;
  return (t: number) => {
    if (t <= frames[0][0]) return FORMANTS[frames[0][1]][k] * shift;
    for (let j = 0; j < frames.length - 1; j++) {
      const [t0, v0] = frames[j];
      const [t1, v1] = frames[j + 1];
      if (t <= t1) {
        const x = clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
        // ease so vowels sit on their target a bit longer
        const e = x * x * (3 - 2 * x);
        return lerp(FORMANTS[v0][k], FORMANTS[v1][k], e) * shift;
      }
    }
    return FORMANTS[frames[frames.length - 1][1]][k] * shift;
  };
}

function nasality(spec: VoiceSpec): (t: number) => number {
  const frames = spec.vowels;
  return (t: number) => {
    let current = frames[0][1];
    for (const [ft, v] of frames) if (t >= ft) current = v;
    return current === 'm' ? 1 : 0;
  };
}

export function voice(sr: number, spec: VoiceSpec): Float32Array {
  const n = samples(sr, spec.duration);
  const rng = new Rng(spec.seed ?? 5);
  const src = new Float32Array(n);
  let phase = 0;
  let drift = 0;
  let lp = 0;
  const lpCoef = Math.exp((-TAU * 1800) / sr);
  // pitch / amplitude curves are evaluated at control rate (every 16 samples) — much cheaper
  const CONTROL = 16;
  let f = 0;
  let amp = 0;
  let breath = 0;
  const air = spec.breath ? highpass(noise(sr, spec.duration, rng), sr, 500) : null;
  for (let i = 0; i < n; i++) {
    if (i % CONTROL === 0) {
      const t = i / sr;
      if ((i & 255) === 0) drift = drift * 0.92 + rng.bi() * 0.08;
      f = at(spec.pitch, t);
      let semis = 0;
      if (spec.vibrato) semis += spec.vibrato[1] * Math.sin(TAU * spec.vibrato[0] * t);
      if (spec.jitter) semis += drift * spec.jitter;
      if (semis !== 0) f *= Math.pow(2, semis / 12);
      amp = at(spec.voicing, t);
      breath = spec.breath ? at(spec.breath, t) : 0;
    }
    const dt = f / sr;
    // band-limited saw (polyBLEP) as glottal source
    let v = 2 * phase - 1;
    if (phase < dt) {
      const x = phase / dt;
      v -= x + x - x * x - 1;
    } else if (phase > 1 - dt) {
      const x = (phase - 1) / dt;
      v -= x * x + x + x + 1;
    }
    phase += dt;
    phase -= Math.floor(phase);
    // gentle low-pass for a softer, more glottal spectrum
    lp = (1 - lpCoef) * v + lpCoef * lp;
    src[i] = (0.55 * v + 0.9 * lp) * amp + (air ? air[i] * 0.55 * breath : 0);
  }

  const hasNasal = spec.vowels.some(([, v]) => v === 'm');
  const nasal = nasality(spec);
  const out = new Float32Array(n);
  for (let k = 0; k < 4; k++) {
    const track = formantTrack(spec, k);
    const constant = spec.vowels.length === 1;
    const f0 = track(0);
    const band = constant ? bandpass(src, sr, f0, f0 / BANDWIDTH[k]) : bandpass(src, sr, track, (t: number) => track(t) / BANDWIDTH[k]);
    if (!hasNasal) {
      const g = GAINS[k];
      for (let i = 0; i < n; i++) out[i] += band[i] * g;
    } else {
      for (let i = 0; i < n; i++) out[i] += band[i] * lerp(GAINS[k], NASAL_GAINS[k], nasal(i / sr));
    }
  }
  return out;
}

/** A small choir: several detuned voices singing the same vowel on a chord. */
export function choir(sr: number, midiNotes: readonly number[], vowel: Vowel, duration: number, seed = 1): Float32Array {
  const out = new Float32Array(samples(sr, duration));
  midiNotes.forEach((note, idx) => {
    const f0 = 440 * Math.pow(2, (note - 69) / 12);
    const voiceOut = voice(sr, {
      duration,
      pitch: f0,
      vowels: [[0, vowel]],
      voicing: (t) => Math.min(1, t / 0.18) * (t > duration - 0.3 ? Math.max(0, (duration - t) / 0.3) : 1),
      breath: 0.05,
      vibrato: [5 + idx * 0.35, 0.2],
      jitter: 0.12,
      formantShift: note > 64 ? 1.12 : 1,
      seed: seed + idx * 13,
    });
    // cheap ensemble: blend in a copy delayed by ~11 ms
    const d = Math.round(sr * 0.011);
    for (let i = 0; i < out.length; i++) out[i] += (voiceOut[i] + 0.6 * (i >= d ? voiceOut[i - d] : 0)) / (midiNotes.length * 1.6);
  });
  return out;
}
