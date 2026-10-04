import { describe, expect, it } from 'vitest';
import { GestureEngine, type GestureEvent } from './GestureEngine';
import type { HandObservation, HandSide, TrackFrame } from './gestureTypes';
import { POSE_LIBRARY, syntheticHand } from './testing/syntheticHand';

const FRAME = 1000 / 30;
const ASPECT = 16 / 9;

function hand(side: HandSide, pose: keyof typeof POSE_LIBRARY, cx = side === 'Right' ? 0.7 : 0.3): HandObservation {
  return { side, score: 0.95, landmarks: syntheticHand(POSE_LIBRARY[pose], { side, cx, aspect: ASPECT }) };
}

function frames(engine: GestureEngine, list: HandObservation[][], t0 = 0): number {
  list.forEach((hands, i) => {
    const f: TrackFrame = { t: t0 + i * FRAME, hands, aspect: ASPECT, mirrored: true };
    engine.process(f);
  });
  return t0 + list.length * FRAME;
}

const times = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

describe('GestureEngine', () => {
  it('turns a held pose into exactly one start event, and an end when the hand leaves', () => {
    const engine = new GestureEngine();
    const events: GestureEvent[] = [];
    engine.onEvent = (e) => events.push(e);
    const t = frames(engine, times(20, [hand('Right', 'PEACE')]));
    frames(engine, times(12, []), t);
    const g = events.filter((e) => e.kind === 'gesture');
    expect(g.map((e) => (e.kind === 'gesture' ? `${e.phase}:${e.hand}:${e.gesture}` : ''))).toEqual(['start:Right:PEACE', 'end:Right:PEACE']);
    expect(engine.hands.Right.present).toBe(false);
  });

  it('tracks two hands independently', () => {
    const engine = new GestureEngine();
    const events: string[] = [];
    engine.onEvent = (e) => e.kind === 'gesture' && e.phase === 'start' && events.push(`${e.hand}:${e.gesture}`);
    frames(engine, times(10, [hand('Right', 'FIST'), hand('Left', 'ROCK')]));
    expect(events.sort()).toEqual(['Left:ROCK', 'Right:FIST']);
    expect(engine.hands.Left.stable).toBe('ROCK');
    expect(engine.hands.Right.stable).toBe('FIST');
  });

  it('keeps hand identity when MediaPipe flips the label for a few frames', () => {
    const engine = new GestureEngine();
    const events: string[] = [];
    engine.onEvent = (e) => e.kind === 'gesture' && events.push(`${e.phase}:${e.hand}:${e.gesture}`);
    const right = hand('Right', 'POINT');
    const flipped: HandObservation = { ...right, side: 'Left' };
    frames(engine, [...times(8, [right]), ...times(4, [flipped]), ...times(8, [right])]);
    expect(events).toEqual(['start:Right:POINT']);
  });

  it('resolves duplicate labels by screen position', () => {
    const engine = new GestureEngine();
    frames(engine, times(6, [hand('Right', 'OPEN_PALM', 0.75), { ...hand('Left', 'FIST', 0.25), side: 'Right' }]));
    expect(engine.hands.Left.stable).toBe('FIST');
    expect(engine.hands.Right.stable).toBe('OPEN_PALM');
  });

  it('exposes smoothed axes in 0..1 with y up', () => {
    const engine = new GestureEngine();
    const high = { side: 'Right' as const, score: 1, landmarks: syntheticHand(POSE_LIBRARY.OPEN_PALM, { cx: 0.8, cy: 0.2, aspect: ASPECT }) };
    frames(engine, times(15, [high]));
    const a = engine.hands.Right.axes;
    expect(a.x).toBeGreaterThan(0.75);
    expect(a.y).toBeGreaterThan(0.7);
    for (const v of Object.values(a)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
