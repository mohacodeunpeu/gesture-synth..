import { uid } from '../utils/id';
import type { AxisId, GestureId, GestureOrNone, HandSelector, HandSide, MotionId } from '../vision/gestureTypes';
import type {
  ActionDef,
  ContinuousRule,
  ContinuousTarget,
  DiscreteRule,
  MappingSet,
  Mappings,
  ModeId,
  TriggerDef,
} from './mappingTypes';

/** What the mapper needs to know about a visible hand. */
export interface HandSnapshot {
  stable: GestureOrNone;
  axes: Record<AxisId, number>;
}

export type InputEvent =
  | { kind: 'gesture'; hand: HandSide; gesture: GestureId }
  | { kind: 'motion'; hand: HandSide; motion: MotionId };

const handMatches = (sel: HandSelector, hand: HandSide) => sel === 'Any' || sel === hand;

export function triggerMatches(trigger: TriggerDef, ev: InputEvent): boolean {
  if (trigger.kind !== ev.kind || !handMatches(trigger.hand, ev.hand)) return false;
  return trigger.kind === 'gesture'
    ? ev.kind === 'gesture' && trigger.gesture === ev.gesture
    : ev.kind === 'motion' && trigger.motion === ev.motion;
}

export function matchDiscrete(rules: readonly DiscreteRule[], ev: InputEvent): DiscreteRule[] {
  return rules.filter((r) => triggerMatches(r.trigger, ev));
}

export interface TargetSpec {
  min: number;
  max: number;
  /** neutral value when no gesture controls the target */
  neutral: number;
  /** discrete steps (e.g. stutter divisions), 0 = continuous */
  steps: number;
}

export const TARGET_SPECS: Record<ContinuousTarget, TargetSpec> = {
  filter: { min: -1, max: 1, neutral: 0, steps: 0 },
  resonance: { min: 0, max: 1, neutral: 0.2, steps: 0 },
  delayMix: { min: 0, max: 0.85, neutral: 0, steps: 0 },
  delayFeedback: { min: 0, max: 0.85, neutral: 0.35, steps: 0 },
  reverbMix: { min: 0, max: 1, neutral: 0, steps: 0 },
  pitch: { min: -12, max: 12, neutral: 0, steps: 0 },
  stutterRate: { min: 0, max: 3, neutral: 1, steps: 4 },
  volume: { min: 0, max: 1, neutral: 0.9, steps: 0 },
  pan: { min: -1, max: 1, neutral: 0, steps: 0 },
};

/** Maps a normalised 0..1 control value onto the target's range. */
export function targetValue(target: ContinuousTarget, norm: number): number {
  const spec = TARGET_SPECS[target];
  const n = Math.min(1, Math.max(0, norm));
  if (spec.steps > 0) return Math.min(spec.steps - 1, Math.floor(n * spec.steps));
  return spec.min + (spec.max - spec.min) * n;
}

export function ruleIsActive(rule: ContinuousRule, hand: HandSnapshot | undefined): boolean {
  if (!hand) return false;
  return rule.whileGesture === null || hand.stable === rule.whileGesture;
}

/**
 * Evaluates every continuous rule against the visible hands. Returns target → value for the
 * rules that are currently active; targets not in the map fall back to their base value.
 */
export function evaluateContinuous(
  rules: readonly ContinuousRule[],
  hands: Partial<Record<HandSide, HandSnapshot>>,
): Map<ContinuousTarget, { value: number; norm: number; hand: HandSide; rule: ContinuousRule }> {
  const out = new Map<ContinuousTarget, { value: number; norm: number; hand: HandSide; rule: ContinuousRule }>();
  for (const rule of rules) {
    const sides: HandSide[] = rule.hand === 'Any' ? ['Right', 'Left'] : [rule.hand];
    for (const side of sides) {
      const hand = hands[side];
      if (!ruleIsActive(rule, hand)) continue;
      const raw = hand!.axes[rule.axis];
      const norm = rule.invert ? 1 - raw : raw;
      out.set(rule.target, { value: targetValue(rule.target, norm), norm, hand: side, rule });
      break;
    }
  }
  return out;
}

/** The trigger that fires a given pad in a mapping set (for badges on the pads). */
export function triggersForPad(set: MappingSet, pad: number): TriggerDef[] {
  return set.discrete.filter((r) => r.action.type === 'pad' && r.action.pad === pad).map((r) => r.trigger);
}

export function sameTrigger(a: TriggerDef, b: TriggerDef): boolean {
  if (a.kind !== b.kind || a.hand !== b.hand) return false;
  return a.kind === 'gesture' ? b.kind === 'gesture' && a.gesture === b.gesture : b.kind === 'motion' && a.motion === b.motion;
}

/**
 * "Learn gesture": assigns `trigger` to `action`, replacing any rule that already used the same
 * trigger (one pose = one action) and any other gesture previously assigned to that same pad.
 */
export function assignTrigger(set: MappingSet, trigger: TriggerDef, action: ActionDef, newId: () => string): MappingSet {
  const discrete = set.discrete.filter((r) => {
    if (sameTrigger(r.trigger, trigger)) return false;
    if (action.type === 'pad' && r.action.type === 'pad' && r.action.pad === action.pad && r.trigger.kind === 'gesture') return false;
    return true;
  });
  discrete.push({ id: newId(), trigger, action });
  return { ...set, discrete };
}

// ---------------------------------------------------------------------------------------------
// Default rule sets
// ---------------------------------------------------------------------------------------------

const rid = (prefix: string) => uid(prefix);

const g = (hand: HandSelector, gesture: GestureId, action: ActionDef): DiscreteRule => ({
  id: rid('d'),
  trigger: { kind: 'gesture', hand, gesture },
  action,
});
const m = (hand: HandSelector, motion: MotionId, action: ActionDef): DiscreteRule => ({
  id: rid('d'),
  trigger: { kind: 'motion', hand, motion },
  action,
});
const pad = (n: number): ActionDef => ({ type: 'pad', pad: n });
const c = (hand: HandSelector, axis: AxisId, target: ContinuousTarget, whileGesture: GestureId | null, invert = false): ContinuousRule => ({
  id: rid('c'),
  hand,
  axis,
  target,
  invert,
  whileGesture,
});

/** Pad layout of the built-in MEMES bank (see audio/sfx). */
function memesSet(): MappingSet {
  return {
    discrete: [
      g('Right', 'POINT', pad(0)),
      g('Right', 'THUMBS_UP', pad(1)),
      g('Right', 'FIST', pad(2)),
      g('Right', 'ROCK', pad(3)),
      g('Right', 'PEACE', pad(4)),
      g('Right', 'CALL', pad(5)),
      g('Right', 'FOUR', pad(6)),
      g('Right', 'THREE', pad(7)),
      g('Right', 'THUMBS_DOWN', pad(8)),
      g('Left', 'FIST', pad(9)),
      g('Left', 'PEACE', pad(10)),
      g('Left', 'THUMBS_UP', pad(11)),
      g('Right', 'OK', pad(12)),
      g('Left', 'POINT', pad(13)),
      g('Right', 'PINCH', pad(14)),
      g('Left', 'ROCK', pad(15)),
      g('Left', 'OPEN_PALM', { type: 'stopAll' }),
      m('Any', 'SWIPE_LEFT', { type: 'bankPrev' }),
      m('Any', 'SWIPE_RIGHT', { type: 'bankNext' }),
    ],
    continuous: [],
  };
}

function drumsSet(): MappingSet {
  return {
    discrete: [
      m('Left', 'STRIKE', pad(0)),
      m('Right', 'STRIKE', pad(1)),
      g('Left', 'PINCH', pad(2)),
      g('Right', 'PINCH', pad(3)),
      g('Right', 'PEACE', pad(4)),
      g('Left', 'POINT', pad(5)),
      g('Right', 'POINT', pad(7)),
      g('Left', 'ROCK', pad(9)),
      g('Right', 'ROCK', pad(10)),
      g('Right', 'THUMBS_UP', pad(11)),
      g('Left', 'CALL', pad(13)),
      g('Left', 'PEACE', pad(14)),
      g('Right', 'CALL', pad(15)),
    ],
    continuous: [],
  };
}

function synthSet(): MappingSet {
  // Playing notes (pinch + height) is built into the synth mode; extra rules are optional.
  return { discrete: [], continuous: [] };
}

function fxSet(): MappingSet {
  return {
    discrete: [
      g('Right', 'FIST', { type: 'fxHold', fx: 'stutter' }),
      g('Left', 'FIST', { type: 'fxHold', fx: 'tapeStop' }),
    ],
    continuous: [
      c('Right', 'x', 'filter', 'PINCH'),
      c('Right', 'y', 'stutterRate', 'FIST'),
      c('Left', 'y', 'reverbMix', 'OPEN_PALM'),
      c('Left', 'y', 'delayMix', 'PEACE'),
      c('Right', 'y', 'pitch', 'POINT'),
    ],
  };
}

export function defaultMappingSet(mode: ModeId): MappingSet {
  switch (mode) {
    case 'memes':
      return memesSet();
    case 'drums':
      return drumsSet();
    case 'synth':
      return synthSet();
    case 'fx':
      return fxSet();
    case 'custom':
      return memesSet();
  }
}

export function defaultMappings(): Mappings {
  return {
    memes: defaultMappingSet('memes'),
    drums: defaultMappingSet('drums'),
    synth: defaultMappingSet('synth'),
    fx: defaultMappingSet('fx'),
    custom: defaultMappingSet('custom'),
  };
}
