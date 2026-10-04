import * as D from './dsp';
import { choir, voice, type Vowel } from './voice';

/** Formant-synth vocal hits and choir notes. */

const ease = (x: number) => x * x * (3 - 2 * x);
function curve(points: ReadonlyArray<readonly [number, number]>): (t: number) => number {
  return (t: number) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [t0, v0] = points[i];
      const [t1, v1] = points[i + 1];
      if (t <= t1) return D.lerp(v0, v1, ease((t - t0) / Math.max(1e-6, t1 - t0)));
    }
    return points[points.length - 1][1];
  };
}

interface Word {
  dur: number;
  pitch: ReadonlyArray<readonly [number, number]>;
  vowels: ReadonlyArray<readonly [number, Vowel]>;
  voicing: ReadonlyArray<readonly [number, number]>;
  breath?: ReadonlyArray<readonly [number, number]>;
  shift?: number;
  seed: number;
  vibrato?: readonly [number, number];
}

function word(sr: number, w: Word): Float32Array[] {
  const v = voice(sr, {
    duration: w.dur,
    pitch: curve(w.pitch),
    vowels: w.vowels,
    voicing: curve(w.voicing),
    breath: w.breath ? curve(w.breath) : 0.03,
    formantShift: w.shift ?? 1.05,
    jitter: 0.15,
    vibrato: w.vibrato,
    seed: w.seed,
  });
  return D.finalize(D.reverb(v, sr, { size: 0.45, mix: 0.1, tail: 0.3 }), sr);
}

export const voiceSounds = {
  aah: (sr: number) => D.finalize(D.reverb(choir(sr, [57, 60, 64, 69], 'a', 1.8, 3), sr, { size: 0.8, mix: 0.25, tail: 1 }), sr),
  ooh: (sr: number) => D.finalize(D.reverb(choir(sr, [55, 59, 62, 67], 'u', 1.8, 9), sr, { size: 0.8, mix: 0.25, tail: 1 }), sr),
  hey: (sr: number) =>
    word(sr, {
      dur: 0.42, seed: 1, shift: 1.08,
      pitch: [[0, 210], [0.12, 250], [0.42, 215]],
      vowels: [[0, 'e'], [0.18, 'e'], [0.36, 'i']],
      voicing: [[0, 0], [0.05, 0], [0.08, 1], [0.3, 1], [0.42, 0]],
      breath: [[0, 0.9], [0.06, 0.7], [0.1, 0.05]],
    }),
  yeah: (sr: number) =>
    word(sr, {
      dur: 0.6, seed: 2,
      pitch: [[0, 230], [0.2, 215], [0.6, 170]],
      vowels: [[0, 'y'], [0.08, 'y'], [0.2, 'e'], [0.36, 'ae'], [0.6, 'a']],
      voicing: [[0, 0], [0.03, 1], [0.48, 1], [0.6, 0]],
    }),
  uhoh: (sr: number) =>
    word(sr, {
      dur: 0.7, seed: 3,
      pitch: [[0, 245], [0.2, 240], [0.24, 185], [0.7, 175]],
      vowels: [[0, 'uh'], [0.2, 'uh'], [0.28, 'oh'], [0.7, 'u']],
      voicing: [[0, 0], [0.03, 1], [0.17, 1], [0.2, 0.1], [0.27, 1], [0.58, 1], [0.7, 0]],
    }),
  whoa: (sr: number) =>
    word(sr, {
      dur: 0.75, seed: 4, vibrato: [5, 0.2],
      pitch: [[0, 205], [0.25, 215], [0.75, 140]],
      vowels: [[0, 'w'], [0.12, 'oh'], [0.45, 'o'], [0.75, 'a']],
      voicing: [[0, 0], [0.06, 1], [0.6, 1], [0.75, 0]],
      breath: [[0, 0.5], [0.06, 0.05]],
    }),
  huh: (sr: number) =>
    word(sr, {
      dur: 0.42, seed: 5,
      pitch: [[0, 150], [0.15, 165], [0.42, 240]],
      vowels: [[0, 'schwa'], [0.42, 'uh']],
      voicing: [[0, 0], [0.06, 0], [0.09, 1], [0.34, 1], [0.42, 0]],
      breath: [[0, 0.85], [0.07, 0.6], [0.1, 0.05]],
    }),
  hmm: (sr: number) =>
    word(sr, {
      dur: 0.8, seed: 6, shift: 1,
      pitch: [[0, 135], [0.35, 150], [0.8, 125]],
      vowels: [[0, 'm']],
      voicing: [[0, 0], [0.06, 1], [0.68, 1], [0.8, 0]],
    }),
  yay: (sr: number) =>
    word(sr, {
      dur: 0.55, seed: 7, shift: 1.15, vibrato: [6, 0.25],
      pitch: [[0, 240], [0.25, 310], [0.55, 330]],
      vowels: [[0, 'y'], [0.08, 'e'], [0.4, 'e'], [0.55, 'i']],
      voicing: [[0, 0], [0.03, 1], [0.45, 1], [0.55, 0]],
    }),
  boo: (sr: number) =>
    word(sr, {
      dur: 0.9, seed: 8, shift: 0.95, vibrato: [4.5, 0.3],
      pitch: [[0, 170], [0.9, 120]],
      vowels: [[0, 'u']],
      voicing: [[0, 0], [0.02, 0.6], [0.06, 1], [0.75, 1], [0.9, 0]],
    }),
  ohno: (sr: number) =>
    word(sr, {
      dur: 0.85, seed: 9,
      pitch: [[0, 260], [0.25, 250], [0.33, 200], [0.85, 165]],
      vowels: [[0, 'oh'], [0.25, 'o'], [0.3, 'm'], [0.36, 'm'], [0.42, 'oh'], [0.85, 'u']],
      voicing: [[0, 0], [0.03, 1], [0.72, 1], [0.85, 0]],
    }),
  ha: (sr: number) =>
    word(sr, {
      dur: 0.32, seed: 10, shift: 1.1,
      pitch: [[0, 250], [0.32, 205]],
      vowels: [[0, 'a']],
      voicing: [[0, 0], [0.05, 0], [0.07, 1], [0.22, 1], [0.32, 0]],
      breath: [[0, 0.9], [0.05, 0.8], [0.07, 0.08]],
    }),
  doLow: (sr: number) => D.finalize(D.reverb(choir(sr, [60], 'a', 1.2, 21), sr, { size: 0.7, mix: 0.2, tail: 0.7 }), sr),
  mi: (sr: number) => D.finalize(D.reverb(choir(sr, [64], 'a', 1.2, 22), sr, { size: 0.7, mix: 0.2, tail: 0.7 }), sr),
  sol: (sr: number) => D.finalize(D.reverb(choir(sr, [67], 'a', 1.2, 23), sr, { size: 0.7, mix: 0.2, tail: 0.7 }), sr),
  doHigh: (sr: number) => D.finalize(D.reverb(choir(sr, [72], 'a', 1.2, 24), sr, { size: 0.7, mix: 0.2, tail: 0.7 }), sr),
} satisfies Record<string, (sr: number) => Float32Array[]>;
