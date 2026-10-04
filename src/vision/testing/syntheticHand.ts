import type { HandSide, Vec3 } from '../gestureTypes';

/**
 * Test helper: builds 21 MediaPipe-style normalised landmarks from a simple kinematic hand model,
 * so classifier tests can cover poses we have no photos for (ROCK, CALL, OK, PINCH…), at any
 * rotation, for both hands, palm or back facing the camera, with optional landmark noise.
 */

export type FingerPose = 'ext' | 'curl' | 'half' | 'pinch' | readonly [number, number, number];
export type ThumbPose = 'out' | 'folded' | 'touchIndex';

export interface HandPose {
  thumb: ThumbPose;
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
}

export interface SyntheticOptions {
  side?: HandSide;
  facing?: 'palm' | 'back';
  /** clockwise on-screen rotation, degrees */
  rotationDeg?: number;
  /** palm centre in normalised coordinates */
  cx?: number;
  cy?: number;
  /** wrist → middle knuckle length in video-height units */
  scale?: number;
  aspect?: number;
  /** landmark noise standard deviation (video-height units) */
  noise?: number;
  seed?: number;
}

type V = [number, number, number]; // (u = across palm toward thumb, v = toward fingers, n = out of palm)

const MCP: Record<'index' | 'middle' | 'ring' | 'pinky', V> = {
  index: [0.32, 0.92, 0],
  middle: [0.08, 1.0, 0],
  ring: [-0.15, 0.95, 0],
  pinky: [-0.36, 0.84, 0],
};
const SEGMENTS: Record<'index' | 'middle' | 'ring' | 'pinky', V> = {
  index: [0.45, 0.27, 0.22],
  middle: [0.5, 0.3, 0.24],
  ring: [0.47, 0.28, 0.23],
  pinky: [0.36, 0.21, 0.19],
};
const SPLAY_DEG = { index: 6, middle: 0, ring: -5, pinky: -12 };

const POSES: Record<'ext' | 'curl' | 'half' | 'pinch', readonly [number, number, number]> = {
  ext: [4, 3, 2],
  curl: [88, 100, 62],
  half: [45, 55, 35],
  pinch: [35, 45, 25],
};

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const normalize = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function fingerChain(name: keyof typeof MCP, pose: FingerPose): V[] {
  const angles = typeof pose === 'string' ? POSES[pose] : pose;
  const splay = rad(SPLAY_DEG[name]);
  const pts: V[] = [MCP[name]];
  let theta = 0;
  for (let j = 0; j < 3; j++) {
    theta += rad(angles[j]);
    const dir: V = [Math.sin(-splay) * Math.cos(theta), Math.cos(splay) * Math.cos(theta), Math.sin(theta)];
    pts.push(add(pts[j], scale(dir, SEGMENTS[name][j])));
  }
  return pts;
}

function thumbChain(pose: ThumbPose, indexTip: V): V[] {
  const cmc: V = [0.22, 0.22, 0.05];
  if (pose === 'touchIndex') {
    const mcp = add(cmc, scale(normalize([0.55, 0.6, 0.6]), 0.35));
    const tip: V = add(indexTip, [0.03, -0.02, 0.02]);
    const mid: V = scale(add(mcp, tip), 0.5);
    const ip = add(mid, [0.06, -0.02, 0.03]);
    return [cmc, mcp, ip, tip];
  }
  const dirs: V[] =
    pose === 'out'
      ? [normalize([0.85, 0.45, 0.2]), normalize([0.8, 0.55, 0.1]), normalize([0.75, 0.65, 0.05])]
      : [normalize([0.4, 0.75, 0.5]), normalize([-0.5, 0.5, 0.7]), normalize([-0.8, 0.2, 0.55])];
  const lens = [0.35, 0.3, 0.25];
  const pts: V[] = [cmc];
  for (let j = 0; j < 3; j++) pts.push(add(pts[j], scale(dirs[j], lens[j])));
  return pts;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticHand(pose: HandPose, opts: SyntheticOptions = {}): Vec3[] {
  const {
    side = 'Right',
    facing = 'palm',
    rotationDeg = 0,
    cx = 0.5,
    cy = 0.5,
    scale: s = 0.22,
    aspect = 16 / 9,
    noise = 0,
    seed = 7,
  } = opts;

  const index = fingerChain('index', pose.index);
  const middle = fingerChain('middle', pose.middle);
  const ring = fingerChain('ring', pose.ring);
  const pinky = fingerChain('pinky', pose.pinky);
  const thumb = thumbChain(pose.thumb, index[3]);
  const handPts: V[] = [[0, 0, 0], ...thumb.slice(0), ...index, ...middle, ...ring, ...pinky];
  // thumbChain returns [cmc, mcp, ip, tip] → indices 1..4 ✓, fingers → 5..20 ✓

  // Hand frame → camera frame (X right, Y down, Z away from camera), right hand palm facing camera:
  // u → +X, v → −Y, n → −Z. Back facing: thumb side flips and the palm normal points away.
  const flipU = facing === 'back' ? -1 : 1;
  const flipN = facing === 'back' ? 1 : -1;
  const mirror = side === 'Left' ? -1 : 1;
  const phi = rad(rotationDeg);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const rand = rng(seed);
  const gauss = () => {
    let a = 0;
    for (let k = 0; k < 6; k++) a += rand();
    return (a - 3) / Math.sqrt(0.5);
  };

  // place the palm centre (≈ v = 0.55) at (cx, cy)
  const centre: V = [0, 0.55, 0];
  return handPts.map((p) => {
    const q: V = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    let X = q[0] * flipU * mirror * s;
    let Y = -q[1] * s;
    const Z = q[2] * flipN * s;
    const rx = X * cos - Y * sin;
    const ry = X * sin + Y * cos;
    X = rx + cx * aspect + (noise ? gauss() * noise : 0);
    Y = ry + cy + (noise ? gauss() * noise : 0);
    const Zn = Z + (noise ? gauss() * noise * 2 : 0);
    return { x: X / aspect, y: Y, z: Zn / aspect };
  });
}

export const POSE_LIBRARY = {
  OPEN_PALM: { thumb: 'out', index: 'ext', middle: 'ext', ring: 'ext', pinky: 'ext' },
  FOUR: { thumb: 'folded', index: 'ext', middle: 'ext', ring: 'ext', pinky: 'ext' },
  THREE: { thumb: 'folded', index: 'ext', middle: 'ext', ring: 'ext', pinky: 'curl' },
  PEACE: { thumb: 'folded', index: 'ext', middle: 'ext', ring: 'curl', pinky: 'curl' },
  POINT: { thumb: 'folded', index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl' },
  FIST: { thumb: 'folded', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' },
  ROCK: { thumb: 'folded', index: 'ext', middle: 'curl', ring: 'curl', pinky: 'ext' },
  CALL: { thumb: 'out', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'ext' },
  OK: { thumb: 'touchIndex', index: 'pinch', middle: 'ext', ring: 'ext', pinky: 'ext' },
  PINCH: { thumb: 'touchIndex', index: 'pinch', middle: 'curl', ring: 'curl', pinky: 'curl' },
  THUMB: { thumb: 'out', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' },
  HALF: { thumb: 'folded', index: 'half', middle: 'half', ring: 'half', pinky: 'half' },
} as const satisfies Record<string, HandPose>;
