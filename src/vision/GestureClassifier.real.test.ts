import { describe, expect, it } from 'vitest';
import { classifyHand } from './GestureClassifier';
import type { GestureId, Vec3 } from './gestureTypes';
import realHands from './__fixtures__/real-hands.json';

interface FixtureHand { label: string; landmarks: number[][] }
interface FixtureImage { width: number; height: number; hands: FixtureHand[] }
const fixtures = realHands as Record<string, FixtureImage>;

const EXPECTED: Record<string, GestureId> = {
  'fist.jpg': 'FIST',
  'fist_flop.jpg': 'FIST',
  'left_hands.jpg': 'OPEN_PALM',
  'left_hands_flop.jpg': 'OPEN_PALM',
  'right_hands.jpg': 'OPEN_PALM',
  'pointing_up.jpg': 'POINT',
  'pointing_up_flop.jpg': 'POINT',
  'pointing_up_rotated.jpg': 'POINT',
  'pointing_up_rotated_flop.jpg': 'POINT',
  'thumb_up.jpg': 'THUMBS_UP',
  'thumb_up_flop.jpg': 'THUMBS_UP',
  'thumb_down_synth.jpg': 'THUMBS_DOWN',
  'victory.jpg': 'PEACE',
  'victory_flop.jpg': 'PEACE',
};

const toVec = (l: number[][]): Vec3[] => l.map(([x, y, z]) => ({ x, y, z }));

describe('GestureClassifier on real MediaPipe landmarks', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} → ${expected}`, () => {
      const img = fixtures[name];
      expect(img, `fixture ${name}`).toBeDefined();
      expect(img.hands.length).toBeGreaterThan(0);
      for (const hand of img.hands) {
        const c = classifyHand(toVec(hand.landmarks), img.width / img.height);
        const top = Object.entries(c.scores).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([g, s]) => `${g}:${s.toFixed(2)}`).join(' ');
        expect(c.gesture, `${name}: ${top} ext=${c.features.ext.map((e) => e.toFixed(2))}`).toBe(expected);
        expect(c.confidence).toBeGreaterThan(0.7);
      }
    });
  }
});
