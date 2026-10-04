import * as D from './dsp';
import { crash, kick, snare, tom } from './drums';
import { voice } from './voice';

/**
 * Original, procedurally generated meme-style sound effects.
 * None of these reproduce a recording: they are synthesised from scratch at runtime.
 */

const smooth = (x: number) => x * x * (3 - 2 * x);

/** linear interpolation through [time, value] points, as a curve function */
function curve(points: ReadonlyArray<readonly [number, number]>): (t: number) => number {
  return (t: number) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [t0, v0] = points[i];
      const [t1, v1] = points[i + 1];
      if (t <= t1) return D.lerp(v0, v1, smooth((t - t0) / Math.max(1e-6, t1 - t0)));
    }
    return points[points.length - 1][1];
  };
}

export function bruh(sr: number): Float32Array[] {
  const dur = 0.64;
  const v = voice(sr, {
    duration: dur,
    pitch: curve([[0, 122], [0.25, 112], [0.55, 90]]),
    vowels: [[0, 'u'], [0.04, 'r'], [0.13, 'r'], [0.22, 'uh'], [0.64, 'uh']],
    voicing: curve([[0, 0], [0.025, 0.7], [0.06, 1], [0.42, 1], [0.54, 0]]),
    breath: curve([[0, 0.03], [0.4, 0.03], [0.47, 0.75], [0.62, 0]]),
    formantShift: 0.93,
    jitter: 0.2,
    seed: 11,
  });
  const burst = D.mul(D.lowpass(D.noise(sr, 0.04, new D.Rng(3)), sr, 700), D.decayEnv(sr, 0.04, 0.001, 0.01));
  D.add(v, burst, 0.5);
  return D.finalize([v], sr);
}

export function wow(sr: number): Float32Array[] {
  const dur = 0.9;
  const v = voice(sr, {
    duration: dur,
    pitch: curve([[0, 165], [0.32, 245], [0.62, 200], [0.9, 150]]),
    vowels: [[0, 'u'], [0.07, 'w'], [0.24, 'a'], [0.55, 'a'], [0.72, 'o'], [0.88, 'u']],
    voicing: curve([[0, 0], [0.05, 1], [0.74, 1], [0.88, 0]]),
    breath: 0.04,
    formantShift: 1.1,
    vibrato: [5.5, 0.22],
    jitter: 0.12,
    seed: 21,
  });
  return D.finalize(D.reverb(v, sr, { size: 0.55, mix: 0.12, tail: 0.4 }), sr);
}

export function bonk(sr: number): Float32Array[] {
  const d = 0.5;
  const rng = new D.Rng(4);
  const out = new Float32Array(D.samples(sr, d));
  D.add(out, D.mul(D.osc(sr, d, (t) => 540 * (1 + 0.6 * Math.exp(-t * 70)), 'sine'), D.decayEnv(sr, d, 0.0015, 0.1)), 1);
  D.add(out, D.mul(D.osc(sr, d, (t) => 1420 * (1 + 0.3 * Math.exp(-t * 90)), 'sine'), D.decayEnv(sr, d, 0.001, 0.035)), 0.45);
  D.add(out, D.mul(D.osc(sr, d, (t) => 165 * (1 + Math.exp(-t * 40)), 'sine'), D.decayEnv(sr, d, 0.002, 0.075)), 0.85);
  D.add(out, D.mul(D.bandpass(D.noise(sr, d, rng), sr, 2600, 1.2), D.decayEnv(sr, d, 0.0005, 0.006)), 0.6);
  return D.finalize(D.reverb(out, sr, { size: 0.3, mix: 0.1, tail: 0.25 }), sr);
}

export function boom(sr: number): Float32Array[] {
  const d = 2.4;
  const rng = new D.Rng(8);
  const out = new Float32Array(D.samples(sr, d));
  D.add(out, D.mul(D.osc(sr, d, (t) => 34 + 72 * Math.exp(-t * 3.2), 'sine'), D.decayEnv(sr, d, 0.004, 0.75)), 1);
  D.add(out, D.mul(D.osc(sr, d, (t) => 60 + 150 * Math.exp(-t * 25), 'sine'), D.decayEnv(sr, d, 0.001, 0.12)), 0.6);
  const rumble = D.lowpass(D.noise(sr, d, rng, 'brown'), sr, (t) => 120 + 900 * Math.exp(-t * 6));
  D.add(out, D.mul(rumble, D.decayEnv(sr, d, 0.003, 0.5)), 0.6);
  D.drive(out, 2.2);
  return D.finalize(D.reverb(out, sr, { size: 0.92, damp: 0.55, mix: 0.22, tail: 1.2 }), sr, { maxRms: 0.26 });
}

function hornBlast(sr: number, len: number): Float32Array {
  const base = (t: number) => 440 * (1 - 0.12 * Math.exp(-t * 55));
  const s = new Float32Array(D.samples(sr, len));
  D.add(s, D.osc(sr, len, base, 'saw', { vibrato: [6, 0.06] }), 0.5);
  D.add(s, D.osc(sr, len, (t) => base(t) * 1.007, 'saw'), 0.45);
  D.add(s, D.osc(sr, len, (t) => base(t) * 0.994, 'saw'), 0.45);
  D.add(s, D.osc(sr, len, (t) => base(t) * 2.012, 'saw'), 0.22);
  D.drive(s, 2.6);
  let f = D.highpass(s, sr, 320);
  f = D.lowpass(f, sr, 4200);
  f = D.biquad(f, sr, 'peak', 1500, 1.1, 7);
  return D.mul(f, D.env(sr, len, [[0, 0], [0.012, 1], [len - 0.035, 0.95], [len, 0]]));
}

export function airhorn(sr: number): Float32Array[] {
  const out = new Float32Array(D.samples(sr, 1.3));
  D.place(out, hornBlast(sr, 0.13), sr, 0);
  D.place(out, hornBlast(sr, 0.13), sr, 0.17);
  D.place(out, hornBlast(sr, 0.8), sr, 0.36);
  return D.finalize(D.reverb(out, sr, { size: 0.6, mix: 0.12, tail: 0.5 }), sr);
}

export function laugh(sr: number): Float32Array[] {
  const syll = 0.15;
  const count = 5;
  const dur = syll * count + 0.15;
  const k = (t: number) => Math.min(count - 1, Math.floor(t / syll));
  const local = (t: number) => t - k(t) * syll;
  const v = voice(sr, {
    duration: dur,
    pitch: (t) => 285 - 16 * k(t) - 40 * local(t),
    vowels: [[0, 'a']],
    voicing: (t) => {
      if (t >= syll * count) return 0;
      const l = local(t);
      return l < 0.032 ? 0 : l < 0.11 ? Math.min(1, (l - 0.032) / 0.01) : Math.max(0, 1 - (l - 0.11) / 0.025);
    },
    breath: (t) => {
      if (t >= syll * count) return 0;
      const l = local(t);
      return l < 0.035 ? 0.85 : 0.1;
    },
    formantShift: 1.14,
    jitter: 0.25,
    seed: 31,
  });
  return D.finalize(D.reverb(v, sr, { size: 0.45, mix: 0.1, tail: 0.3 }), sr);
}

export function wrong(sr: number): Float32Array[] {
  const buzz = (len: number, f: number) => {
    const s = new Float32Array(D.samples(sr, len));
    D.add(s, D.osc(sr, len, f, 'square'), 0.5);
    D.add(s, D.osc(sr, len, f * 1.016, 'square'), 0.5);
    D.add(s, D.osc(sr, len, f / 2, 'saw'), 0.4);
    D.drive(s, 1.6);
    return D.mul(D.lowpass(s, sr, 2200), D.env(sr, len, [[0, 0], [0.008, 1], [len - 0.02, 1], [len, 0]]));
  };
  const out = new Float32Array(D.samples(sr, 0.8));
  D.place(out, buzz(0.17, 155), sr, 0);
  D.place(out, buzz(0.48, 118), sr, 0.23);
  return D.finalize([out], sr);
}

function brass(sr: number, midi: number, len: number, opts: { cutoff?: number; tremolo?: number } = {}): Float32Array {
  const f = D.midiHz(midi);
  const s = new Float32Array(D.samples(sr, len));
  for (const [ratio, g] of [[1, 0.5], [1.006, 0.4], [0.995, 0.4], [0.5, 0.45]] as const) D.add(s, D.osc(sr, len, f * ratio, 'saw'), g);
  const top = opts.cutoff ?? 2600;
  const filtered = D.lowpass(s, sr, (t) => 260 + (top - 260) * Math.min(1, t / 0.045) * (0.55 + 0.45 * Math.exp(-t * 4)), 1.2);
  const trem = opts.tremolo ?? 0;
  return D.mul(filtered, (t) => {
    const a = Math.min(1, t / 0.012) * (t > len - 0.07 ? Math.max(0, (len - t) / 0.07) : 1);
    return a * (1 - trem * (0.5 + 0.5 * Math.sin(D.TAU * 6.5 * t)));
  }, sr);
}

export function dramatic(sr: number): Float32Array[] {
  const out = new Float32Array(D.samples(sr, 2.3));
  D.place(out, brass(sr, 48, 0.2), sr, 0);
  D.place(out, brass(sr, 48, 0.2), sr, 0.28);
  D.place(out, brass(sr, 47, 1.35, { tremolo: 0.3, cutoff: 2100 }), sr, 0.56);
  for (const [t, f] of [[0, 65.4], [0.28, 65.4], [0.56, 61.7]] as const) {
    D.place(out, D.mul(D.osc(sr, 0.9, (x) => f * (1 + 0.3 * Math.exp(-x * 30)), 'sine'), D.decayEnv(sr, 0.9, 0.002, 0.3)), sr, t, 0.9);
  }
  return D.finalize(D.reverb(out, sr, { size: 0.85, mix: 0.24, tail: 1 }), sr);
}

export function sadTrombone(sr: number): Float32Array[] {
  const notes: Array<[number, number, number]> = [[55, 0, 0.33], [54, 0.37, 0.33], [53, 0.74, 0.33], [52, 1.11, 1.15]];
  const out = new Float32Array(D.samples(sr, 2.5));
  notes.forEach(([midi, start, len], idx) => {
    const last = idx === notes.length - 1;
    const f = D.midiHz(midi);
    const pitch = (t: number) => f * (0.96 + 0.04 * Math.min(1, t / 0.06)) * (last ? Math.pow(2, (0.45 * Math.min(1, t / 0.4) * Math.sin(D.TAU * 5.2 * t)) / 12) : 1);
    const s = D.add(D.osc(sr, len, pitch, 'saw'), D.osc(sr, len, (t) => pitch(t) * 1.004, 'square'), 0.35);
    const wah = D.lowpass(s, sr, (t) => {
      const x = Math.min(1, t / len);
      return 380 + 1300 * Math.sin(Math.PI * Math.min(1, x * (last ? 1.6 : 1.2)));
    }, 2.2);
    D.mul(wah, D.env(sr, len, [[0, 0], [0.03, 1], [len - 0.06, 0.9], [len, 0]]));
    D.place(out, wah, sr, start);
  });
  return D.finalize(D.reverb(out, sr, { size: 0.5, mix: 0.12, tail: 0.4 }), sr);
}

export function rimshot(sr: number): Float32Array[] {
  const out = new Float32Array(D.samples(sr, 1.8));
  D.place(out, snare(sr, { tone: 210 }), sr, 0, 0.8);
  D.place(out, tom(sr, 110), sr, 0.16, 0.9);
  D.place(out, kick(sr), sr, 0.36, 0.9);
  const [cl, cr] = crash(sr, 0.7);
  const L = D.place(new Float32Array(out), cl, sr, 0.36, 0.55);
  const R = D.place(new Float32Array(out), cr, sr, 0.36, 0.55);
  return D.finalize([L, R], sr);
}

export function boing(sr: number): Float32Array[] {
  const d = 0.8;
  const f = (t: number) => 140 + 230 * (1 - Math.exp(-t * 9)) + 55 * Math.sin(D.TAU * 15 * t) * Math.exp(-t * 4);
  const s = D.add(D.osc(sr, d, f, 'sine'), D.osc(sr, d, f, 'triangle'), 0.35);
  D.mul(s, D.decayEnv(sr, d, 0.003, 0.28));
  return D.finalize([s], sr);
}

export function crickets(sr: number): Float32Array[] {
  const d = 2.6;
  const out = new Float32Array(D.samples(sr, d));
  const cricket = (freq: number, period: number, offset: number) => {
    for (let start = offset; start < d - 0.15; start += period) {
      for (let p = 0; p < 3; p++) {
        const len = 0.02;
        const pulse = D.mul(D.osc(sr, len, (t) => freq * (1 + 0.02 * Math.sin(D.TAU * 80 * t)), 'sine'), (t) => Math.sin((Math.PI * t) / len), sr);
        D.place(out, pulse, sr, start + p * 0.034, 0.5);
      }
    }
  };
  cricket(4600, 0.5, 0.05);
  cricket(4150, 0.62, 0.28);
  return D.finalize(D.reverb(out, sr, { size: 0.5, mix: 0.2, tail: 0.5 }), sr, { peak: 0.6 });
}

export function tada(sr: number): Float32Array[] {
  const out = new Float32Array(D.samples(sr, 2.1));
  for (const n of [67, 72]) D.place(out, brass(sr, n, 0.11, { cutoff: 3200 }), sr, 0, 0.5);
  for (const n of [48, 60, 64, 67, 72]) D.place(out, brass(sr, n, 1.15, { cutoff: 3600, tremolo: 0.12 }), sr, 0.16, 0.45);
  [84, 88, 91, 96].forEach((n, i) => {
    const bell = D.mul(D.osc(sr, 0.6, D.midiHz(n), 'sine'), D.decayEnv(sr, 0.6, 0.001, 0.18));
    D.place(out, bell, sr, 0.17 + i * 0.05, 0.35);
  });
  return D.finalize(D.reverb(out, sr, { size: 0.7, mix: 0.18, tail: 0.8 }), sr);
}

export function whoosh(sr: number): Float32Array[] {
  const d = 0.8;
  const nz = D.noise(sr, d, new D.Rng(12), 'pink');
  const swept = D.bandpass(nz, sr, (t) => 300 + 2600 * Math.pow(Math.sin((Math.PI * t) / d), 2), 1.4);
  D.mul(swept, (t) => Math.pow(Math.sin((Math.PI * Math.min(t, d)) / d), 1.5), sr);
  const L = D.mul(new Float32Array(swept), (t) => 1 - 0.8 * (t / d), sr);
  const R = D.mul(new Float32Array(swept), (t) => 0.2 + 0.8 * (t / d), sr);
  return D.finalize([L, R], sr);
}

export function pew(sr: number): Float32Array[] {
  const d = 0.3;
  const f = (t: number) => 220 + 1700 * Math.exp(-t * 16);
  const s = D.add(D.osc(sr, d, f, 'pulse', { width: 0.3 }), D.osc(sr, d, f, 'sine'), 0.8);
  D.mul(s, D.decayEnv(sr, d, 0.001, 0.09));
  return D.finalize([D.echo(s, sr, 0.075, 0.3, 0.3, 0.3)], sr);
}

export function scratch(sr: number): Float32Array[] {
  const d = 0.48;
  const rng = new D.Rng(66);
  const vel = (t: number) => Math.sin(D.TAU * 4.6 * t);
  const tone = D.osc(sr, d, (t) => 200 * (0.25 + 1.3 * Math.abs(vel(t))), 'saw');
  const grit = D.highpass(D.noise(sr, d, rng), sr, 1800);
  const mix = D.add(D.bandpass(tone, sr, 1300, 0.7), grit, 0.35);
  D.mul(mix, (t) => Math.pow(Math.abs(vel(t)), 0.7) * Math.min(1, (d - t) / 0.04), sr);
  return D.finalize([mix], sr);
}

export const memeSounds = {
  bruh,
  wow,
  bonk,
  boom,
  airhorn,
  laugh,
  wrong,
  dramatic,
  sadTrombone,
  rimshot,
  boing,
  crickets,
  tada,
  whoosh,
  pew,
  scratch,
} satisfies Record<string, (sr: number) => Float32Array[]>;
