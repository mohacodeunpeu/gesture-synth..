import { GESTURES, LM, type GestureId, type GestureOrNone, type Vec3 } from './gestureTypes';

/**
 * Stateless hand-pose classifier.
 *
 * Works on the 21 normalised MediaPipe landmarks (x, y in 0..1, z relative depth). Coordinates are
 * made isotropic with the video aspect ratio, then every finger gets an "extension" score in 0..1 from
 * its joint angles (PIP/DIP) and fingertip distance. Gestures are templates over those scores
 * (extended / curled / don't care); a template's score is its weakest finger, so half-bent,
 * in-between poses naturally get a low confidence instead of a wrong label.
 *
 * Calibrated against real HandLandmarker output (see __fixtures__/real-hands.json).
 */

export interface HandFeatures {
  /** extension per finger: thumb, index, middle, ring, pinky (0 = curled, 1 = extended) */
  ext: [number, number, number, number, number];
  /** thumb tip ↔ index tip distance divided by palm size */
  pinchDist: number;
  /** 0..1 "fingers touching" strength used for the PINCH / OK gestures */
  pinchClose: number;
  /** 0..1 continuous pinch amount (0 = wide open, 1 = touching), for effect control */
  pinchAmount: number;
  thumbUp: number;
  thumbDown: number;
  /** wrist → middle-finger knuckle distance, in video-height units (bigger = closer) */
  palmSize: number;
  /** palm centre, normalised display coordinates */
  cx: number;
  cy: number;
  /** radians, 0 = fingers up, positive = tilted clockwise on screen */
  rotation: number;
  /** mean extension of the four fingers */
  openness: number;
  /** index tip ↔ pinky tip distance divided by palm size */
  spread: number;
}

export interface Classification {
  gesture: GestureOrNone;
  confidence: number;
  scores: Record<GestureId, number>;
  features: HandFeatures;
}

type P3 = [number, number, number];

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const dist = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** angle between two vectors, degrees */
function angleDeg(u: P3, v: P3): number {
  const d = norm(u) * norm(v);
  if (d < 1e-9) return 0;
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / d;
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

/** Isotropic copy of the landmarks (units = video height). */
export function toIsotropic(lm: readonly Vec3[], aspect: number): P3[] {
  return lm.map((p) => [p.x * aspect, p.y, p.z * aspect]);
}

const FINGER_JOINTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
];

function fingerExtension(P: P3[], finger: number, palm: number): number {
  const [mcp, pip, dip, tip] = FINGER_JOINTS[finger];
  const pipBend = angleDeg(sub(P[pip], P[mcp]), sub(P[dip], P[pip]));
  const dipBend = angleDeg(sub(P[dip], P[pip]), sub(P[tip], P[dip]));
  const angleScore = 1 - smoothstep(35, 100, pipBend + 0.5 * dipBend);
  const tipReach = dist(P[tip], P[LM.WRIST]) / palm;
  const isPinky = finger === 3;
  const reachScore = isPinky ? smoothstep(1.0, 1.35, tipReach) : smoothstep(1.1, 1.5, tipReach);
  return 0.6 * angleScore + 0.4 * reachScore;
}

function thumbExtension(P: P3[], palm: number): number {
  const toPinkyBase = dist(P[LM.THUMB_TIP], P[LM.PINKY_MCP]) / palm;
  const toMiddleBase = dist(P[LM.THUMB_TIP], P[LM.MIDDLE_MCP]) / palm;
  return 0.5 * smoothstep(0.9, 1.25, toPinkyBase) + 0.5 * smoothstep(0.6, 0.9, toMiddleBase);
}

export function extractFeatures(lm: readonly Vec3[], aspect: number): HandFeatures {
  const P = toIsotropic(lm, aspect);
  const palm = Math.max(1e-6, dist(P[LM.WRIST], P[LM.MIDDLE_MCP]));

  const ext: HandFeatures['ext'] = [
    thumbExtension(P, palm),
    fingerExtension(P, 0, palm),
    fingerExtension(P, 1, palm),
    fingerExtension(P, 2, palm),
    fingerExtension(P, 3, palm),
  ];

  const pinchDist = dist(P[LM.THUMB_TIP], P[LM.INDEX_TIP]) / palm;
  // In a fist the thumb also rests near the (curled) index tip: only count a pinch when the
  // index finger is reaching out, not rolled into the palm.
  const indexReach = dist(P[LM.INDEX_TIP], P[LM.WRIST]) / palm;
  const pinchClose = (1 - smoothstep(0.22, 0.42, pinchDist)) * smoothstep(0.95, 1.2, indexReach);
  const pinchAmount = 1 - smoothstep(0.18, 0.95, pinchDist);

  // Thumb direction on screen (y grows downward).
  const tdx = P[LM.THUMB_TIP][0] - P[LM.THUMB_MCP][0];
  const tdy = P[LM.THUMB_TIP][1] - P[LM.THUMB_MCP][1];
  const tlen = Math.hypot(tdx, tdy) || 1;
  const up = -tdy / tlen;
  const tipY = P[LM.THUMB_TIP][1];
  let minOther = Infinity;
  let maxOther = -Infinity;
  for (const i of [5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20]) {
    minOther = Math.min(minOther, P[i][1]);
    maxOther = Math.max(maxOther, P[i][1]);
  }
  const thumbUp = Math.min(smoothstep(0.4, 0.75, up), smoothstep(-0.05, 0.12, (minOther - tipY) / palm));
  const thumbDown = Math.min(smoothstep(0.4, 0.75, -up), smoothstep(-0.05, 0.12, (tipY - maxOther) / palm));

  let cx = 0;
  let cy = 0;
  for (const i of [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]) {
    cx += lm[i].x;
    cy += lm[i].y;
  }
  cx /= 5;
  cy /= 5;

  const rdx = P[LM.MIDDLE_MCP][0] - P[LM.WRIST][0];
  const rdy = P[LM.MIDDLE_MCP][1] - P[LM.WRIST][1];
  const rotation = Math.atan2(rdx, -rdy);

  return {
    ext,
    pinchDist,
    pinchClose,
    pinchAmount,
    thumbUp,
    thumbDown,
    palmSize: palm,
    cx,
    cy,
    rotation,
    openness: (ext[1] + ext[2] + ext[3] + ext[4]) / 4,
    spread: dist(P[LM.INDEX_TIP], P[LM.PINKY_TIP]) / palm,
  };
}

export function scoreGestures(f: HandFeatures): Record<GestureId, number> {
  const [t, i, m, r, p] = f.ext;
  const T = 1 - t;
  const I = 1 - i;
  const M = 1 - m;
  const R = 1 - r;
  const Pc = 1 - p;
  const fingersCurled = Math.min(I, M, R, Pc);
  const thumbUpPose = Math.min(t, f.thumbUp);
  const thumbDownPose = Math.min(t, f.thumbDown);
  const notPinching = 1 - f.pinchClose;
  const minOf = Math.min;

  return {
    OPEN_PALM: minOf(t, i, m, r, p, notPinching),
    FOUR: minOf(T, i, m, r, p, notPinching),
    THREE: minOf(i, m, r, Pc, notPinching),
    PEACE: minOf(i, m, R, Pc),
    POINT: minOf(i, M, R, Pc, notPinching),
    ROCK: minOf(i, M, R, p),
    CALL: minOf(t, I, M, R, p),
    THUMBS_UP: minOf(fingersCurled, thumbUpPose),
    THUMBS_DOWN: minOf(fingersCurled, thumbDownPose),
    FIST: minOf(fingersCurled, 1 - Math.max(thumbUpPose, thumbDownPose), notPinching),
    OK: minOf(f.pinchClose, m, r, p),
    PINCH: minOf(f.pinchClose, 1 - minOf(m, r, p)),
  };
}

export function classifyHand(lm: readonly Vec3[], aspect: number, minConfidence = 0.55): Classification {
  const features = extractFeatures(lm, aspect);
  const scores = scoreGestures(features);
  let best: GestureId = GESTURES[0];
  for (const g of GESTURES) if (scores[g] > scores[best]) best = g;
  const confidence = scores[best];
  return {
    gesture: confidence >= minConfidence ? best : 'NONE',
    confidence,
    scores,
    features,
  };
}
