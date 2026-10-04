import { describe, expect, it } from 'vitest';
import {
  assignTrigger,
  defaultMappings,
  evaluateContinuous,
  matchDiscrete,
  targetValue,
  triggersForPad,
  type HandSnapshot,
} from './GestureMapper';
import { MODES, type ContinuousRule, type MappingSet } from './mappingTypes';
import { AXES, type AxisId } from '../vision/gestureTypes';

const axes = (over: Partial<Record<AxisId, number>> = {}): Record<AxisId, number> => ({
  ...(Object.fromEntries(AXES.map((a) => [a, 0.5])) as Record<AxisId, number>),
  ...over,
});

describe('GestureMapper', () => {
  const maps = defaultMappings();

  it('every mode has a rule set and memes covers all 16 pads', () => {
    for (const mode of MODES) expect(maps[mode]).toBeDefined();
    for (let p = 0; p < 16; p++) expect(triggersForPad(maps.memes, p).length, `pad ${p}`).toBeGreaterThan(0);
  });

  it('no two default rules share the same trigger inside a mode', () => {
    for (const mode of MODES) {
      const keys = maps[mode].discrete.map((r) => JSON.stringify(r.trigger));
      expect(new Set(keys).size, mode).toBe(keys.length);
    }
  });

  it('matches gestures by hand, and "Any" matches both hands', () => {
    const peaceRight = matchDiscrete(maps.memes.discrete, { kind: 'gesture', hand: 'Right', gesture: 'PEACE' });
    expect(peaceRight.map((r) => r.action)).toEqual([{ type: 'pad', pad: 4 }]);
    const peaceLeft = matchDiscrete(maps.memes.discrete, { kind: 'gesture', hand: 'Left', gesture: 'PEACE' });
    expect(peaceLeft.map((r) => r.action)).toEqual([{ type: 'pad', pad: 10 }]);
    for (const hand of ['Left', 'Right'] as const) {
      const swipe = matchDiscrete(maps.memes.discrete, { kind: 'motion', hand, motion: 'SWIPE_RIGHT' });
      expect(swipe.map((r) => r.action.type)).toEqual(['bankNext']);
    }
    expect(matchDiscrete(maps.memes.discrete, { kind: 'gesture', hand: 'Right', gesture: 'OPEN_PALM' })).toEqual([]);
  });

  it('maps normalised values onto target ranges', () => {
    expect(targetValue('filter', 0)).toBe(-1);
    expect(targetValue('filter', 1)).toBe(1);
    expect(targetValue('pitch', 0.5)).toBe(0);
    expect(targetValue('stutterRate', 0)).toBe(0);
    expect(targetValue('stutterRate', 0.99)).toBe(3);
    expect(targetValue('stutterRate', 1)).toBe(3);
    expect(targetValue('volume', 2)).toBe(1);
  });

  it('continuous rules only apply while their gating pose is held', () => {
    const rules: ContinuousRule[] = maps.fx.continuous;
    const pinching: HandSnapshot = { stable: 'PINCH', axes: axes({ x: 1 }) };
    const open: HandSnapshot = { stable: 'OPEN_PALM', axes: axes({ x: 1, y: 0.8 }) };
    let out = evaluateContinuous(rules, { Right: pinching });
    expect(out.get('filter')?.value).toBe(1);
    out = evaluateContinuous(rules, { Right: open });
    expect(out.has('filter')).toBe(false);
    out = evaluateContinuous(rules, { Left: open });
    expect(out.get('reverbMix')?.value).toBeCloseTo(0.8);
    expect(evaluateContinuous(rules, {}).size).toBe(0);
  });

  it('invert flips the axis', () => {
    const rule: ContinuousRule = { id: 'x', hand: 'Any', axis: 'y', target: 'volume', invert: true, whileGesture: null };
    const out = evaluateContinuous([rule], { Left: { stable: 'NONE', axes: axes({ y: 0.2 }) } });
    expect(out.get('volume')?.value).toBeCloseTo(0.8);
    expect(out.get('volume')?.hand).toBe('Left');
  });

  it('learn gesture replaces conflicting rules', () => {
    let n = 0;
    const id = () => `new-${++n}`;
    const base: MappingSet = defaultMappings().memes;
    // assign right PEACE (currently pad 4) to pad 0 (currently right POINT)
    const next = assignTrigger(base, { kind: 'gesture', hand: 'Right', gesture: 'PEACE' }, { type: 'pad', pad: 0 }, id);
    expect(triggersForPad(next, 0)).toEqual([{ kind: 'gesture', hand: 'Right', gesture: 'PEACE' }]);
    expect(triggersForPad(next, 4)).toEqual([]);
    expect(next.discrete.length).toBe(base.discrete.length - 1);
    // the original set is not mutated
    expect(triggersForPad(base, 4).length).toBe(1);
  });
});
