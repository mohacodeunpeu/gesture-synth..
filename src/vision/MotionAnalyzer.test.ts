import { describe, expect, it } from 'vitest';
import { MotionAnalyzer, type MotionEvent } from './MotionAnalyzer';
import { OneEuroFilter } from './OneEuroFilter';

const FRAME = 1000 / 30;

function feed(m: MotionAnalyzer, path: Array<[number, number]>, openness = 1, t0 = 0): MotionEvent[] {
  const out: MotionEvent[] = [];
  path.forEach(([x, y], i) => out.push(...m.update(t0 + i * FRAME, x, y, openness)));
  return out;
}

const still = (x: number, y: number, n: number): Array<[number, number]> => Array.from({ length: n }, () => [x, y]);
const line = (from: [number, number], to: [number, number], n: number): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [from[0] + ((to[0] - from[0]) * (i + 1)) / n, from[1] + ((to[1] - from[1]) * (i + 1)) / n]);

describe('MotionAnalyzer', () => {
  it('detects a fast horizontal swipe with an open hand', () => {
    const m = new MotionAnalyzer();
    const ev = feed(m, [...still(0.3, 0.5, 6), ...line([0.3, 0.5], [0.7, 0.52], 6), ...still(0.7, 0.52, 6)]);
    expect(ev.map((e) => e.motion)).toEqual(['SWIPE_RIGHT']);
  });

  it('detects swipe left and up', () => {
    expect(feed(new MotionAnalyzer(), [...still(0.7, 0.5, 6), ...line([0.7, 0.5], [0.3, 0.5], 6)]).map((e) => e.motion)).toEqual(['SWIPE_LEFT']);
    expect(feed(new MotionAnalyzer(), [...still(0.5, 0.8, 6), ...line([0.5, 0.8], [0.5, 0.35], 6)]).map((e) => e.motion)).toEqual(['SWIPE_UP']);
  });

  it('ignores slow drifts and swipes with a closed hand', () => {
    expect(feed(new MotionAnalyzer(), [...still(0.3, 0.5, 4), ...line([0.3, 0.5], [0.7, 0.5], 60)])).toEqual([]);
    expect(feed(new MotionAnalyzer(), [...still(0.3, 0.5, 6), ...line([0.3, 0.5], [0.7, 0.5], 6)], 0.2)).toEqual([]);
  });

  it('ignores the jump when a hand enters the frame', () => {
    const m = new MotionAnalyzer();
    expect(feed(m, [[0.1, 0.9], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]])).toEqual([]);
  });

  it('detects one strike per downward hit and re-arms after the hand stops', () => {
    const m = new MotionAnalyzer();
    const hit = (y0: number): Array<[number, number]> => [...still(0.5, y0, 5), ...line([0.5, y0], [0.5, y0 + 0.25], 3), ...still(0.5, y0 + 0.25, 5)];
    const ev = feed(m, [...hit(0.3), ...line([0.5, 0.55], [0.5, 0.3], 8), ...hit(0.3)]);
    const strikes = ev.filter((e) => e.motion === 'STRIKE');
    expect(strikes).toHaveLength(2);
    for (const s of strikes) expect(s.intensity).toBeGreaterThan(0.5);
  });

  it('a slow downward move is not a strike', () => {
    const ev = feed(new MotionAnalyzer(), [...still(0.5, 0.3, 4), ...line([0.5, 0.3], [0.5, 0.6], 40)]);
    expect(ev.filter((e) => e.motion === 'STRIKE')).toEqual([]);
  });
});

describe('OneEuroFilter', () => {
  it('smooths jitter when still and follows fast moves', () => {
    const f = new OneEuroFilter(1.2, 0.05);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * FRAME);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.006);
    for (let i = 60; i < 75; i++) out = f.filter(0.9, i * FRAME);
    expect(out).toBeGreaterThan(0.85);
  });
});
