import type { AxisId, GestureId, HandSelector, MotionId } from '../vision/gestureTypes';

export const MODES = ['memes', 'drums', 'synth', 'fx', 'custom'] as const;
export type ModeId = (typeof MODES)[number];

export const MODE_EMOJI: Record<ModeId, string> = {
  memes: '😂',
  drums: '🥁',
  synth: '🎹',
  fx: '🎛️',
  custom: '⚙️',
};

export type TriggerDef =
  | { kind: 'gesture'; hand: HandSelector; gesture: GestureId }
  | { kind: 'motion'; hand: HandSelector; motion: MotionId };

export const HOLD_FX = ['stutter', 'tapeStop'] as const;
export type HoldFx = (typeof HOLD_FX)[number];
export const TOGGLE_FX = ['filter', 'delay', 'reverb'] as const;
export type ToggleFx = (typeof TOGGLE_FX)[number];

export type ActionDef =
  | { type: 'pad'; pad: number }
  | { type: 'stopAll' }
  | { type: 'mute' }
  | { type: 'bankPrev' }
  | { type: 'bankNext' }
  | { type: 'loopRecord' }
  | { type: 'loopPlay' }
  | { type: 'undo' }
  | { type: 'fxHold'; fx: HoldFx }
  | { type: 'fxToggle'; fx: ToggleFx }
  | { type: 'videoRecord' };

export type ActionType = ActionDef['type'];
export const ACTION_TYPES: ActionType[] = [
  'pad',
  'stopAll',
  'mute',
  'bankPrev',
  'bankNext',
  'loopPlay',
  'loopRecord',
  'undo',
  'fxHold',
  'fxToggle',
  'videoRecord',
];

export interface DiscreteRule {
  id: string;
  trigger: TriggerDef;
  action: ActionDef;
}

export const CONTINUOUS_TARGETS = [
  'filter',
  'resonance',
  'delayMix',
  'delayFeedback',
  'reverbMix',
  'pitch',
  'stutterRate',
  'volume',
  'pan',
] as const;
export type ContinuousTarget = (typeof CONTINUOUS_TARGETS)[number];

export interface ContinuousRule {
  id: string;
  hand: HandSelector;
  axis: AxisId;
  target: ContinuousTarget;
  invert: boolean;
  /** only active while this pose is held by the same hand; null = whenever the hand is visible */
  whileGesture: GestureId | null;
}

export interface MappingSet {
  discrete: DiscreteRule[];
  continuous: ContinuousRule[];
}

export type Mappings = Record<ModeId, MappingSet>;
