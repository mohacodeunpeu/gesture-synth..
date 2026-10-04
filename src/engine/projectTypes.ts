import type { Mappings, ModeId } from './mappingTypes';

export const PAD_COUNT = 16;
export const PAD_MODES = ['oneshot', 'gate', 'loop', 'retrigger'] as const;
export type PadMode = (typeof PAD_MODES)[number];

export interface PadConfig {
  /** 'builtin:<bank>/<id>' | 'user:<id>' | null (empty pad) */
  sample: string | null;
  name: string;
  emoji: string;
  /** index into the pad colour palette */
  color: number;
  mode: PadMode;
  /** linear gain 0..1.5 */
  volume: number;
  /** -1..1 */
  pan: number;
  /** semitones -24..24 (changes speed too, like a sampler) */
  pitch: number;
  /** seconds */
  trimStart: number;
  /** seconds, 0 = until the end */
  trimEnd: number;
  fadeIn: number;
  fadeOut: number;
  reverse: boolean;
  /** 0 = none, 1..4: pads in the same group cut each other */
  choke: number;
  /** max simultaneous voices of this pad */
  poly: number;
  /** KeyboardEvent.code, null = default for its position */
  key: string | null;
  /** id of an image stored locally, shown on the pad */
  image: string | null;
}

export interface Bank {
  id: string;
  name: string;
  emoji: string;
  pads: PadConfig[];
}

export interface Project {
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  mode: ModeId;
  bankId: string;
  banks: Bank[];
  mappings: Mappings;
}

/** Physical keys (layout independent): 1234 / QWER / ASDF / ZXCV on a QWERTY keyboard. */
export const DEFAULT_PAD_KEYS = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR',
  'KeyA', 'KeyS', 'KeyD', 'KeyF',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV',
] as const;

export const PAD_COLORS = [
  '#22e5ff', '#2dffb4', '#a78bfa', '#ff4fd8',
  '#ffb020', '#7cff4f', '#4f8bff', '#ff5a6e',
  '#00f0c8', '#c7ff3d', '#d17bff', '#ff8a3d',
  '#3df5ff', '#55ff9c', '#9d8cff', '#ff6fb5',
] as const;

export function padKeyCode(pad: PadConfig, index: number): string {
  return pad.key ?? DEFAULT_PAD_KEYS[index];
}

export function emptyPad(index: number): PadConfig {
  return {
    sample: null,
    name: '',
    emoji: '➕',
    color: index % PAD_COLORS.length,
    mode: 'oneshot',
    volume: 1,
    pan: 0,
    pitch: 0,
    trimStart: 0,
    trimEnd: 0,
    fadeIn: 0,
    fadeOut: 0,
    reverse: false,
    choke: 0,
    poly: 4,
    key: null,
    image: null,
  };
}
