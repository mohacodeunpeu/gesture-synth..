import { describe, expect, it } from 'vitest';
import { BUILTIN_BANKS, allBuiltinRefs, findBuiltin } from './index';
import { peak, rms } from './dsp';

const SR = 48000;
/** sounds that intentionally fade in */
const SWELLS = new Set(['fx/riser', 'fx/sweep', 'fx/ufo', 'memes/whoosh']);

const timings: Array<[string, number]> = [];

describe('built-in procedural sounds', () => {
  it('has four banks of 16 unique sounds', () => {
    expect(BUILTIN_BANKS).toHaveLength(4);
    for (const bank of BUILTIN_BANKS) expect(bank.sounds).toHaveLength(16);
    const refs = allBuiltinRefs();
    expect(new Set(refs).size).toBe(64);
    expect(findBuiltin('builtin:memes/airhorn')?.name).toBe('AIRHORN');
  });

  for (const bank of BUILTIN_BANKS) {
    it(`${bank.id}: every sound is audible, finite, unclipped and reasonably short`, () => {
      for (const sound of bank.sounds) {
        const t0 = performance.now();
        const channels = sound.generate(SR);
        const ms = performance.now() - t0;
        const label = `${bank.id}/${sound.id}`;
        expect(channels.length, label).toBeGreaterThanOrEqual(1);
        expect(channels.length, label).toBeLessThanOrEqual(2);
        const len = channels[0].length;
        for (const ch of channels) {
          expect(ch.length, label).toBe(len);
          for (let i = 0; i < ch.length; i += 97) expect(Number.isFinite(ch[i]), label).toBe(true);
        }
        const p = Math.max(...channels.map(peak));
        const r = Math.max(...channels.map(rms));
        expect(p, `${label} peak`).toBeLessThanOrEqual(0.9);
        expect(p, `${label} peak`).toBeGreaterThan(0.2);
        expect(r, `${label} rms`).toBeGreaterThan(0.01);
        expect(len / SR, `${label} duration`).toBeGreaterThan(0.05);
        expect(len / SR, `${label} duration`).toBeLessThan(4.5);
        // must start (almost) immediately: meme timing matters
        const first = channels[0].findIndex((x) => Math.abs(x) > 0.02);
        if (!SWELLS.has(label)) expect(first / SR, `${label} onset`).toBeLessThan(0.08);
        expect(ms, `${label} generation time`).toBeLessThan(250);
        timings.push([label, ms]);
      }
    });
  }

  it('generates the whole library quickly enough to run in a worker at startup', () => {
    const total = timings.reduce((a, [, ms]) => a + ms, 0);
    const slowest = [...timings].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, ms]) => `${l}:${ms.toFixed(0)}ms`);
    console.info(`[sfx] total ${total.toFixed(0)} ms, slowest: ${slowest.join(' ')}`);
    expect(total).toBeLessThan(3000);
  });

  it('is deterministic', () => {
    const a = findBuiltin('builtin:fx/glitch')!.generate(SR)[0];
    const b = findBuiltin('builtin:fx/glitch')!.generate(SR)[0];
    expect(a).toEqual(b);
  });
});
