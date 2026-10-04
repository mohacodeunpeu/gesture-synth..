import * as D from './dsp';

/** Sound-design FX and 8-bit game sounds, all synthesised. */

export function riser(sr: number): Float32Array[] {
  const d = 3.2;
  const x = (t: number) => Math.min(1, t / d);
  const nz = D.highpass(D.noise(sr, d, new D.Rng(2), 'white'), sr, (t) => 200 + 7500 * Math.pow(x(t), 2), 0.9);
  const tone = D.osc(sr, d, (t) => 90 + 700 * Math.pow(x(t), 2), 'saw');
  const out = D.add(D.mul(nz, (t) => Math.pow(x(t), 1.6), sr), D.mul(D.lowpass(tone, sr, 2500), (t) => 0.4 * Math.pow(x(t), 2), sr), 1);
  return D.finalize(D.reverb(out, sr, { size: 0.6, mix: 0.15, tail: 0.15 }), sr);
}

export function downlifter(sr: number): Float32Array[] {
  const d = 2.2;
  const x = (t: number) => Math.min(1, t / d);
  const nz = D.lowpass(D.noise(sr, d, new D.Rng(3)), sr, (t) => 9000 * Math.pow(1 - x(t), 2) + 150);
  const tone = D.osc(sr, d, (t) => 600 * Math.pow(1 - x(t), 1.5) + 40, 'sine');
  const out = D.add(nz, tone, 0.5);
  D.mul(out, (t) => Math.pow(1 - x(t), 1.3), sr);
  return D.finalize(D.reverb(out, sr, { size: 0.7, mix: 0.2, tail: 0.6 }), sr);
}

export function impact(sr: number): Float32Array[] {
  const d = 2;
  const out = new Float32Array(D.samples(sr, d));
  D.add(out, D.mul(D.osc(sr, d, (t) => 40 + 110 * Math.exp(-t * 12), 'sine'), D.decayEnv(sr, d, 0.002, 0.5)), 1);
  D.add(out, D.mul(D.lowpass(D.noise(sr, d, new D.Rng(5)), sr, 3000), D.decayEnv(sr, d, 0.001, 0.12)), 0.7);
  D.add(out, D.mul(D.metallic(sr, d, [287, 431, 523, 709]), D.decayEnv(sr, d, 0.001, 0.35)), 0.25);
  D.drive(out, 1.8);
  return D.finalize(D.reverb(out, sr, { size: 0.9, mix: 0.3, tail: 1.2 }), sr, { maxRms: 0.25 });
}

export function laser(sr: number): Float32Array[] {
  const out = new Float32Array(D.samples(sr, 0.7));
  [0, 0.12, 0.24].forEach((t0, i) => {
    const d = 0.18;
    const s = D.mul(D.osc(sr, d, (t) => 2400 * Math.exp(-t * 14) + 300 - i * 40, 'square'), D.decayEnv(sr, d, 0.001, 0.06));
    D.place(out, D.lowpass(s, sr, 5000), sr, t0, 0.8);
  });
  return D.finalize([D.echo(out, sr, 0.09, 0.25, 0.25, 0.3)], sr);
}

function chip(sr: number, notes: ReadonlyArray<readonly [number, number]>, wave: D.Wave = 'square', decay = 0): Float32Array {
  const total = notes.reduce((a, [, len]) => a + len, 0);
  const out = new Float32Array(D.samples(sr, total + 0.05));
  let t0 = 0;
  for (const [midi, len] of notes) {
    const s = D.osc(sr, len, D.midiHz(midi), wave);
    D.mul(s, decay > 0 ? D.decayEnv(sr, len, 0.002, decay) : D.env(sr, len, [[0, 0], [0.003, 1], [len - 0.006, 1], [len, 0]]));
    D.place(out, s, sr, t0);
    t0 += len;
  }
  return out;
}

export function coin(sr: number): Float32Array[] {
  const out = chip(sr, [[81, 0.07], [86, 0.42]], 'square', 0);
  D.mul(out, (t) => (t < 0.07 ? 1 : Math.exp(-(t - 0.07) / 0.14)), sr);
  return D.finalize([out], sr, { maxRms: 0.18 });
}

export function powerUp(sr: number): Float32Array[] {
  const seq: Array<[number, number]> = [];
  for (const base of [60, 64, 67, 72]) for (const o of [0, 4, 7]) seq.push([base + o, 0.035]);
  return D.finalize([chip(sr, seq, 'square')], sr, { maxRms: 0.18 });
}

export function explosion(sr: number): Float32Array[] {
  const d = 2.4;
  const rng = new D.Rng(19);
  const out = new Float32Array(D.samples(sr, d));
  D.add(out, D.mul(D.lowpass(D.noise(sr, d, rng, 'brown'), sr, (t) => 3000 * Math.exp(-t * 3) + 150), D.decayEnv(sr, d, 0.002, 0.6)), 1.2);
  D.add(out, D.mul(D.noise(sr, d, rng), D.decayEnv(sr, d, 0.0005, 0.02)), 0.6);
  D.add(out, D.mul(D.osc(sr, d, (t) => 45 + 60 * Math.exp(-t * 8), 'sine'), D.decayEnv(sr, d, 0.003, 0.5)), 0.8);
  for (let i = 0; i < 40; i++) {
    const t = rng.range(0.05, 1.4);
    const c = D.mul(D.highpass(D.noise(sr, 0.01, rng), sr, 3000), D.decayEnv(sr, 0.01, 0.0002, 0.002));
    D.place(out, c, sr, t, 0.3 * Math.exp(-t * 1.5));
  }
  D.drive(out, 1.6);
  return D.finalize(D.reverb(out, sr, { size: 0.85, mix: 0.2, tail: 0.8 }), sr, { maxRms: 0.25 });
}

export function siren(sr: number): Float32Array[] {
  const d = 2.4;
  const f = (t: number) => 750 + 450 * Math.sin(D.TAU * 0.8 * t - Math.PI / 2);
  const s = D.add(D.osc(sr, d, f, 'triangle'), D.osc(sr, d, (t) => f(t) * 2, 'sine'), 0.25);
  D.mul(s, D.env(sr, d, [[0, 0], [0.05, 1], [d - 0.1, 1], [d, 0]]));
  return D.finalize(D.reverb(s, sr, { size: 0.5, mix: 0.1, tail: 0.3 }), sr, { maxRms: 0.18 });
}

export function zap(sr: number): Float32Array[] {
  const d = 0.35;
  const s = D.fm(sr, d, (t) => 900 * Math.exp(-t * 5) + 200, 0.71, (t) => 9 * Math.exp(-t * 12));
  D.mul(s, D.decayEnv(sr, d, 0.001, 0.09));
  return D.finalize([s], sr);
}

export function bubbles(sr: number): Float32Array[] {
  const rng = new D.Rng(27);
  const out = new Float32Array(D.samples(sr, 0.7));
  for (let i = 0; i < 6; i++) {
    const f0 = rng.range(380, 900);
    const d = 0.08;
    const s = D.mul(D.osc(sr, d, (t) => f0 * (1 + 2.2 * (t / d)), 'sine'), D.env(sr, d, [[0, 0], [0.004, 1], [d, 0]]));
    D.place(out, s, sr, i * 0.09 + rng.range(0, 0.02), 0.8);
  }
  return D.finalize([out], sr);
}

export function alarm(sr: number): Float32Array[] {
  const out = new Float32Array(D.samples(sr, 0.75));
  for (let i = 0; i < 4; i++) {
    const s = D.add(D.osc(sr, 0.1, 880, 'square'), D.osc(sr, 0.1, 1320, 'square'), 0.3);
    D.mul(s, D.env(sr, 0.1, [[0, 0], [0.004, 1], [0.094, 1], [0.1, 0]]));
    D.place(out, D.lowpass(s, sr, 4000), sr, i * 0.17);
  }
  return D.finalize([out], sr, { maxRms: 0.18 });
}

export function glitch(sr: number): Float32Array[] {
  const rng = new D.Rng(99);
  const out = new Float32Array(D.samples(sr, 0.8));
  let t = 0;
  while (t < 0.72) {
    const len = rng.range(0.02, 0.07);
    const kind = rng.next();
    let s: Float32Array;
    if (kind < 0.4) s = D.osc(sr, len, rng.range(150, 2500), 'square');
    else if (kind < 0.7) s = D.noise(sr, len, rng);
    else s = D.osc(sr, len, (x) => rng.range(200, 400) * (1 + 6 * x / len), 'saw');
    D.crush(s, 4, rng.range(1, 8));
    D.mul(s, D.env(sr, len, [[0, 0], [0.002, 1], [len - 0.004, 1], [len, 0]]));
    D.place(out, s, sr, t, rng.range(0.4, 0.9));
    t += len + (rng.next() < 0.3 ? 0.02 : 0);
  }
  return D.finalize([out], sr, { maxRms: 0.2 });
}

export function ufo(sr: number): Float32Array[] {
  const d = 2;
  const f = (t: number) => (600 + 250 * Math.sin(D.TAU * 0.6 * t)) * (1 + 0.12 * Math.sin(D.TAU * 9 * t));
  const s = D.add(D.osc(sr, d, f, 'sine'), D.osc(sr, d, (t) => f(t) * 1.5, 'sine'), 0.3);
  D.mul(s, D.env(sr, d, [[0, 0], [0.2, 1], [d - 0.3, 1], [d, 0]]));
  return D.finalize(D.reverb(s, sr, { size: 0.7, mix: 0.2, tail: 0.5 }), sr, { maxRms: 0.18 });
}

export function sweep(sr: number): Float32Array[] {
  const d = 1.2;
  const nz = D.noise(sr, d, new D.Rng(33));
  const s = D.bandpass(nz, sr, (t) => 200 * Math.pow(40, Math.sin((Math.PI * t) / d)), 4);
  D.mul(s, (t) => Math.sin((Math.PI * Math.min(t, d)) / d), sr);
  return D.finalize(D.reverb(s, sr, { size: 0.6, mix: 0.2, tail: 0.4 }), sr);
}

export function jump(sr: number): Float32Array[] {
  const d = 0.22;
  const s = D.osc(sr, d, (t) => 260 + 900 * (t / d), 'pulse', { width: 0.25 });
  D.mul(s, D.env(sr, d, [[0, 0], [0.004, 1], [d * 0.7, 0.8], [d, 0]]));
  return D.finalize([D.lowpass(s, sr, 6000)], sr, { maxRms: 0.18 });
}

export function gameOver(sr: number): Float32Array[] {
  const notes: Array<[number, number]> = [[67, 0.16], [66, 0.16], [65, 0.16], [64, 0.55]];
  const s = chip(sr, notes, 'triangle');
  const sq = chip(sr, notes.map(([n, l]) => [n - 12, l] as [number, number]), 'square');
  D.add(s, sq, 0.25);
  return D.finalize([D.echo(s, sr, 0.15, 0.2, 0.2, 0.4)], sr, { maxRms: 0.2 });
}

export const fxSounds = {
  riser,
  downlifter,
  impact,
  laser,
  coin,
  powerUp,
  explosion,
  siren,
  zap,
  bubbles,
  alarm,
  glitch,
  ufo,
  sweep,
  jump,
  gameOver,
} satisfies Record<string, (sr: number) => Float32Array[]>;
