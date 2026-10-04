export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type HandSide = 'Left' | 'Right';
export type HandSelector = HandSide | 'Any';

/** Discrete hand poses recognised by the classifier. */
export const GESTURES = [
  'OPEN_PALM',
  'FIST',
  'POINT',
  'PEACE',
  'THREE',
  'FOUR',
  'THUMBS_UP',
  'THUMBS_DOWN',
  'ROCK',
  'CALL',
  'PINCH',
  'OK',
] as const;
export type GestureId = (typeof GESTURES)[number];
export type GestureOrNone = GestureId | 'NONE';

export const GESTURE_EMOJI: Record<GestureId, string> = {
  OPEN_PALM: '✋',
  FIST: '✊',
  POINT: '☝️',
  PEACE: '✌️',
  THREE: '3️⃣',
  FOUR: '4️⃣',
  THUMBS_UP: '👍',
  THUMBS_DOWN: '👎',
  ROCK: '🤘',
  CALL: '🤙',
  PINCH: '🤏',
  OK: '👌',
};

/** Hand movements detected over time (not poses). */
export const MOTIONS = ['SWIPE_LEFT', 'SWIPE_RIGHT', 'SWIPE_UP', 'SWIPE_DOWN', 'STRIKE'] as const;
export type MotionId = (typeof MOTIONS)[number];

export const MOTION_EMOJI: Record<MotionId, string> = {
  SWIPE_LEFT: '⬅️',
  SWIPE_RIGHT: '➡️',
  SWIPE_UP: '⬆️',
  SWIPE_DOWN: '⬇️',
  STRIKE: '🥁',
};

/** Continuous values extracted from a hand, all normalised to 0..1. */
export const AXES = ['x', 'y', 'pinch', 'rotation', 'openness', 'depth', 'spread'] as const;
export type AxisId = (typeof AXES)[number];

/** One hand as delivered by the tracker (already corrected for handedness + mirroring). */
export interface HandObservation {
  side: HandSide;
  /** MediaPipe handedness score 0..1 */
  score: number;
  /** 21 normalised landmarks in DISPLAY space (x mirrored when the view is mirrored). */
  landmarks: Vec3[];
}

export interface TrackFrame {
  /** performance.now() timestamp of the camera frame, ms */
  t: number;
  hands: HandObservation[];
  /** video width / height, used to make geometry isotropic */
  aspect: number;
  /** true when x is mirrored (selfie view): the user's right hand appears on the right */
  mirrored: boolean;
}

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];

/** MediaPipe hand landmark indices */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
