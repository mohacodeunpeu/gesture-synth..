import { describe, expect, it } from 'vitest';
import { DEFAULT_SMOOTHER, GestureSmoother, type SmootherEvent } from './GestureSmoother';
import { GESTURES, type GestureId, type GestureOrNone } from './gestureTypes';

const FRAME = 1000 / 30;

function scoresFor(g: GestureOrNone, level = 0.9): Record<GestureId, number> {
  const s = Object.fromEntries(GESTURES.map((x) => [x, 0])) as Record<GestureId, number>;
  if (g !== 'NONE') s[g] = level;
  return s;
}

/** feeds a sequence of per-frame gestures at 30 fps and returns all events */
function run(seq: GestureOrNone[], smoother = new GestureSmoother(), t0 = 0): SmootherEvent[] {
  const events: SmootherEvent[] = [];
  seq.forEach((g, i) => events.push(...smoother.update(scoresFor(g), g, t0 + i * FRAME)));
  return events;
}

const repeat = (g: GestureOrNone, n: number) => Array<GestureOrNone>(n).fill(g);

describe('GestureSmoother', () => {
  it('fires once after the dwell time, not on the first frame', () => {
    const s = new GestureSmoother();
    expect(s.update(scoresFor('FIST'), 'FIST', 0)).toEqual([]);
    expect(s.update(scoresFor('FIST'), 'FIST', FRAME)).toEqual([]);
    const ev = run(repeat('FIST', 6), s, 2 * FRAME);
    expect(ev.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(ev[0].t).toBeGreaterThanOrEqual(DEFAULT_SMOOTHER.dwellMs);
  });

  it('holding a pose never re-triggers (edge, not level)', () => {
    const ev = run(repeat('PEACE', 120)); // 4 seconds
    expect(ev).toEqual([expect.objectContaining({ type: 'start', gesture: 'PEACE' })]);
  });

  it('ignores single-frame flickers between poses', () => {
    const seq: GestureOrNone[] = [...repeat('OPEN_PALM', 10), 'FIST', ...repeat('OPEN_PALM', 10), 'POINT', ...repeat('OPEN_PALM', 10)];
    const starts = run(seq).filter((e) => e.type === 'start').map((e) => e.gesture);
    expect(starts).toEqual(['OPEN_PALM']);
  });

  it('survives short tracking drop-outs without end/start spam (hysteresis)', () => {
    const seq: GestureOrNone[] = [
      ...repeat('ROCK', 8), 'NONE', ...repeat('ROCK', 5), 'NONE', 'NONE', ...repeat('ROCK', 5), 'NONE', ...repeat('ROCK', 8),
    ];
    const ev = run(seq);
    expect(ev.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'end')).toHaveLength(0);
  });

  it('keeps a confirmed gesture while its score dips between hold and enter thresholds', () => {
    const s = new GestureSmoother();
    const events: SmootherEvent[] = [];
    for (let i = 0; i < 6; i++) events.push(...s.update(scoresFor('PINCH'), 'PINCH', i * FRAME));
    for (let i = 6; i < 30; i++) events.push(...s.update(scoresFor('PINCH', 0.45), 'NONE', i * FRAME));
    expect(events.map((e) => e.type)).toEqual(['start']);
    expect(s.stable).toBe('PINCH');
  });

  it('releases after the release time and can fire the same gesture again', () => {
    const seq: GestureOrNone[] = [...repeat('FIST', 8), ...repeat('NONE', 12), ...repeat('FIST', 8)];
    const ev = run(seq).map((e) => `${e.type}:${e.gesture}`);
    expect(ev).toEqual(['start:FIST', 'end:FIST', 'start:FIST']);
  });

  it('switching poses emits end then start', () => {
    const ev = run([...repeat('FIST', 8), ...repeat('PEACE', 8)]).map((e) => `${e.type}:${e.gesture}`);
    expect(ev).toEqual(['start:FIST', 'end:FIST', 'start:PEACE']);
  });

  it('cooldown blocks a re-fire that comes too quickly, without a dangling end event', () => {
    const s = new GestureSmoother({ ...DEFAULT_SMOOTHER, cooldownMs: 1000, releaseMs: 60 });
    const ev = run([...repeat('FIST', 6), ...repeat('NONE', 4), ...repeat('FIST', 6), ...repeat('NONE', 6)], s)
      .map((e) => `${e.type}:${e.gesture}`);
    expect(ev).toEqual(['start:FIST', 'end:FIST']);
  });

  it('reset releases the held gesture', () => {
    const s = new GestureSmoother();
    run(repeat('OK', 8), s);
    expect(s.reset(1000).map((e) => `${e.type}:${e.gesture}`)).toEqual(['end:OK']);
    expect(s.stable).toBe('NONE');
  });

  it('reports how long the gesture has been held', () => {
    const s = new GestureSmoother();
    run(repeat('CALL', 30), s);
    expect(s.heldFor(29 * FRAME)).toBeGreaterThan(800);
  });
});
