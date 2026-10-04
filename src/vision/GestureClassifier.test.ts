import { describe, expect, it } from 'vitest';
import { classifyHand, extractFeatures } from './GestureClassifier';
import type { GestureId, HandSide } from './gestureTypes';
import { POSE_LIBRARY, syntheticHand, type SyntheticOptions } from './testing/syntheticHand';

const ASPECT = 16 / 9;

const CASES: Array<[keyof typeof POSE_LIBRARY, GestureId]> = [
  ['OPEN_PALM', 'OPEN_PALM'],
  ['FOUR', 'FOUR'],
  ['THREE', 'THREE'],
  ['PEACE', 'PEACE'],
  ['POINT', 'POINT'],
  ['FIST', 'FIST'],
  ['ROCK', 'ROCK'],
  ['CALL', 'CALL'],
  ['OK', 'OK'],
  ['PINCH', 'PINCH'],
];

const variants: Array<{ name: string; opts: SyntheticOptions }> = [];
for (const side of ['Right', 'Left'] as HandSide[]) {
  for (const facing of ['palm', 'back'] as const) {
    for (const rotationDeg of [-40, 0, 35]) {
      variants.push({ name: `${side}/${facing}/${rotationDeg}°`, opts: { side, facing, rotationDeg, aspect: ASPECT } });
    }
  }
}

describe('GestureClassifier on synthetic hands', () => {
  for (const [pose, expected] of CASES) {
    it(`${pose} is recognised for both hands, both faces, rotated`, () => {
      for (const v of variants) {
        const c = classifyHand(syntheticHand(POSE_LIBRARY[pose], v.opts), ASPECT);
        expect(c.gesture, `${pose} ${v.name} conf=${c.confidence.toFixed(2)}`).toBe(expected);
        expect(c.confidence).toBeGreaterThan(0.75);
      }
    });
  }

  it('survives realistic landmark noise', () => {
    for (const [pose, expected] of CASES) {
      for (let seed = 1; seed <= 12; seed++) {
        const lm = syntheticHand(POSE_LIBRARY[pose], { aspect: ASPECT, noise: 0.0025, seed, rotationDeg: seed * 7 - 40 });
        expect(classifyHand(lm, ASPECT).gesture, `${pose} seed ${seed}`).toBe(expected);
      }
    }
  });

  it('distinguishes thumbs up from thumbs down from a fist', () => {
    const up = classifyHand(syntheticHand(POSE_LIBRARY.THUMB, { rotationDeg: -60, aspect: ASPECT }), ASPECT);
    expect(up.gesture).toBe('THUMBS_UP');
    const upLeft = classifyHand(syntheticHand(POSE_LIBRARY.THUMB, { side: 'Left', rotationDeg: 60, aspect: ASPECT }), ASPECT);
    expect(upLeft.gesture).toBe('THUMBS_UP');
    const down = classifyHand(syntheticHand(POSE_LIBRARY.THUMB, { rotationDeg: 120, aspect: ASPECT }), ASPECT);
    expect(down.gesture).toBe('THUMBS_DOWN');
    // thumb out sideways is neither: it should not fire a thumbs gesture
    const side = classifyHand(syntheticHand(POSE_LIBRARY.THUMB, { rotationDeg: 40, aspect: ASPECT }), ASPECT);
    expect(['THUMBS_UP', 'THUMBS_DOWN']).not.toContain(side.gesture);
  });

  it('returns NONE for an ambiguous half-closed hand', () => {
    const c = classifyHand(syntheticHand(POSE_LIBRARY.HALF, { aspect: ASPECT }), ASPECT);
    expect(c.gesture).toBe('NONE');
    expect(c.confidence).toBeLessThan(0.55);
  });

  it('is independent of where the hand is and how big it is', () => {
    for (const [cx, cy, scale] of [[0.2, 0.3, 0.15], [0.8, 0.7, 0.3], [0.5, 0.5, 0.1]]) {
      const c = classifyHand(syntheticHand(POSE_LIBRARY.ROCK, { cx, cy, scale, aspect: ASPECT }), ASPECT);
      expect(c.gesture).toBe('ROCK');
    }
  });

  it('extracts continuous features', () => {
    const f = extractFeatures(syntheticHand(POSE_LIBRARY.OPEN_PALM, { cx: 0.25, cy: 0.6, aspect: ASPECT }), ASPECT);
    expect(f.cx).toBeCloseTo(0.25, 1);
    expect(f.cy).toBeGreaterThan(0.45);
    expect(f.openness).toBeGreaterThan(0.95);
    expect(Math.abs(f.rotation)).toBeLessThan(0.2);
    const tilted = extractFeatures(syntheticHand(POSE_LIBRARY.OPEN_PALM, { rotationDeg: 45, aspect: ASPECT }), ASPECT);
    expect(tilted.rotation).toBeGreaterThan(0.6);
    const pinch = extractFeatures(syntheticHand(POSE_LIBRARY.PINCH, { aspect: ASPECT }), ASPECT);
    expect(pinch.pinchAmount).toBeGreaterThan(0.9);
    expect(f.pinchAmount).toBeLessThan(0.3);
  });
});
