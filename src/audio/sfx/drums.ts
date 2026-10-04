import * as D from './dsp';

/** Drum voices (mono unless noted). Parameterised so other banks can reuse them. */

export function kick(sr: number, { low = 46, high = 165, decay = 0.3, length = 0.55, click = 0.5 } = {}): Float32Array {
  const body = D.osc(sr, length, (t) => low + (high - low) * Math.exp(-t * 26), 'sine');
  D.mul(body, D.decayEnv(sr, length, 0.0015, decay));
  const knock = D.mul(D.osc(sr, length, (t) => 110 + 300 * Math.exp(-t * 60), 'sine'), D.decayEnv(sr, length, 0.0005, 0.02));
  const tick = D.mul(D.highpass(D.noise(sr, length, new D.Rng(41)), sr, 2500), D.decayEnv(sr, length, 0.0003, 0.004));
  D.add(body, knock, 0.35);
  D.add(body, tick, click);
  return D.drive(body, 1.4);
}

export function snare(sr: number, { tone = 190, decay = 0.16, seed = 7 } = {}): Float32Array {
  const len = 0.45;
  const t1 = D.mul(D.osc(sr, len, (t) => tone * (1 + 0.25 * Math.exp(-t * 50)), 'triangle'), D.decayEnv(sr, len, 0.001, 0.06));
  const t2 = D.mul(D.osc(sr, len, tone * 1.72, 'sine'), D.decayEnv(sr, len, 0.001, 0.04));
  let nz = D.noise(sr, len, new D.Rng(seed));
  nz = D.highpass(D.biquad(nz, sr, 'peak', 5000, 0.8, 4), sr, 1200);
  D.mul(nz, D.decayEnv(sr, len, 0.0008, decay));
  const out = D.add(D.add(new Float32Array(t1.length), t1, 0.6), t2, 0.25);
  return D.add(out, nz, 0.75);
}

export function clap(sr: number): Float32Array {
  const len = 0.5;
  const nz = D.bandpass(D.noise(sr, len, new D.Rng(17)), sr, 1250, 0.9);
  const e = new Float32Array(nz.length);
  for (const [delay, gain] of [[0, 1], [0.011, 0.9], [0.022, 0.85]] as const) D.add(e, D.decayEnv(sr, len, 0.0005, 0.006, delay), gain);
  D.add(e, D.decayEnv(sr, len, 0.002, 0.11, 0.03), 0.75);
  D.mul(nz, e);
  return D.reverb(nz, sr, { size: 0.35, mix: 0.12, tail: 0.25 })[0];
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

export function hat(sr: number, decay = 0.045, length = 0.25): Float32Array {
  let m = D.metallic(sr, length, HAT_FREQS.map((f) => f * 1.7));
  m = D.add(m, D.noise(sr, length, new D.Rng(23)), 0.6);
  m = D.highpass(D.bandpass(m, sr, 10000, 0.6), sr, 7000);
  return D.mul(m, D.decayEnv(sr, length, 0.0008, decay));
}

export function tom(sr: number, f0: number): Float32Array {
  const len = 0.7;
  const body = D.mul(D.osc(sr, len, (t) => f0 * (1 + 0.55 * Math.exp(-t * 22)), 'sine'), D.decayEnv(sr, len, 0.001, 0.22));
  const skin = D.mul(D.lowpass(D.noise(sr, len, new D.Rng(5)), sr, 2500), D.decayEnv(sr, len, 0.0005, 0.02));
  return D.add(body, skin, 0.35);
}

export function rim(sr: number): Float32Array {
  const len = 0.15;
  const a = D.mul(D.osc(sr, len, 1700, 'sine'), D.decayEnv(sr, len, 0.0003, 0.018));
  const b = D.mul(D.osc(sr, len, 480, 'triangle'), D.decayEnv(sr, len, 0.0003, 0.025));
  const c = D.mul(D.bandpass(D.noise(sr, len, new D.Rng(9)), sr, 3200, 2), D.decayEnv(sr, len, 0.0002, 0.008));
  return D.add(D.add(a, b, 0.7), c, 0.6);
}

export function cowbell(sr: number): Float32Array {
  const len = 0.6;
  const m = D.add(D.osc(sr, len, 562, 'square'), D.osc(sr, len, 845, 'square'), 0.8);
  const bp = D.bandpass(m, sr, 1400, 1.3);
  const e = D.add(D.decayEnv(sr, len, 0.0005, 0.02), D.decayEnv(sr, len, 0.001, 0.2), 0.6);
  return D.mul(bp, e);
}

export function crash(sr: number, decay = 1.3): D.Stereo {
  const len = decay * 3;
  const rng = new D.Rng(31);
  const mk = (seed: number) => {
    let s = D.add(D.metallic(sr, len, HAT_FREQS.map((f) => f * (2.3 + seed * 0.07))), D.noise(sr, len, rng), 0.9);
    s = D.highpass(s, sr, 3200);
    s = D.biquad(s, sr, 'peak', 6000, 0.7, 5);
    const e = D.add(D.decayEnv(sr, len, 0.001, 0.05), D.decayEnv(sr, len, 0.004, decay), 1);
    return D.mul(s, e);
  };
  return [mk(0), mk(1)];
}

export function ride(sr: number): D.Stereo {
  const len = 2.2;
  const ping = D.mul(D.metallic(sr, len, [3100, 3740, 4320, 5130, 6020]), D.decayEnv(sr, len, 0.0008, 0.5));
  const wash = D.mul(D.highpass(D.noise(sr, len, new D.Rng(77)), sr, 5000), D.decayEnv(sr, len, 0.002, 0.7));
  const mono = D.add(D.bandpass(ping, sr, 4200, 0.7), wash, 0.25);
  return D.reverb(mono, sr, { size: 0.5, mix: 0.12, tail: 0.3 });
}

export function shaker(sr: number): Float32Array {
  const len = 0.3;
  const nz = D.bandpass(D.noise(sr, len, new D.Rng(51)), sr, 6500, 1.1);
  const e = D.env(sr, len, [[0, 0], [0.02, 0.6], [0.05, 0.25], [0.07, 1], [0.16, 0]]);
  return D.mul(nz, e);
}

export function sub808(sr: number, note = 33): Float32Array {
  const len = 1.6;
  const f = D.midiHz(note);
  const s = D.osc(sr, len, (t) => f * (1 + 0.35 * Math.exp(-t * 30)), 'sine');
  D.mul(s, D.env(sr, len, [[0, 0], [0.004, 1], [0.15, 0.9], [1.5, 0]]));
  return D.drive(s, 1.8);
}

export function snap(sr: number): D.Stereo {
  const len = 0.25;
  const nz = D.mul(D.bandpass(D.noise(sr, len, new D.Rng(61)), sr, 2300, 1.4), D.decayEnv(sr, len, 0.0004, 0.022));
  const tone = D.mul(D.osc(sr, len, 1850, 'sine'), D.decayEnv(sr, len, 0.0004, 0.012));
  return D.reverb(D.add(nz, tone, 0.3), sr, { size: 0.4, mix: 0.18, tail: 0.25 });
}

export function conga(sr: number, f0 = 240): Float32Array {
  const len = 0.5;
  const body = D.mul(D.osc(sr, len, (t) => f0 * (1 + 0.18 * Math.exp(-t * 35)), 'sine'), D.decayEnv(sr, len, 0.001, 0.13));
  const slap = D.mul(D.bandpass(D.noise(sr, len, new D.Rng(91)), sr, 1800, 1.5), D.decayEnv(sr, len, 0.0004, 0.01));
  const over = D.mul(D.osc(sr, len, f0 * 2.4, 'sine'), D.decayEnv(sr, len, 0.0005, 0.03));
  return D.add(D.add(body, slap, 0.5), over, 0.2);
}

const fin = (channels: Float32Array[], sr: number) => D.finalize(channels, sr, { maxRms: 0.24 });

export const drumSounds = {
  kick: (sr: number) => fin([kick(sr)], sr),
  snare: (sr: number) => fin([snare(sr)], sr),
  clap: (sr: number) => fin([clap(sr)], sr),
  hat: (sr: number) => fin([hat(sr)], sr),
  openhat: (sr: number) => fin([hat(sr, 0.32, 0.9)], sr),
  tomlow: (sr: number) => fin([tom(sr, 92)], sr),
  tommid: (sr: number) => fin([tom(sr, 128)], sr),
  tomhigh: (sr: number) => fin([tom(sr, 172)], sr),
  rim: (sr: number) => fin([rim(sr)], sr),
  cowbell: (sr: number) => fin([cowbell(sr)], sr),
  crash: (sr: number) => fin(crash(sr), sr),
  ride: (sr: number) => fin(ride(sr), sr),
  shaker: (sr: number) => fin([shaker(sr)], sr),
  sub: (sr: number) => fin([sub808(sr)], sr),
  snap: (sr: number) => fin(snap(sr), sr),
  conga: (sr: number) => fin([conga(sr)], sr),
} satisfies Record<string, (sr: number) => Float32Array[]>;
