import { classifyHand, smoothstep, type HandFeatures } from './GestureClassifier';
import { DEFAULT_SMOOTHER, GestureSmoother, type SmootherConfig } from './GestureSmoother';
import { DEFAULT_MOTION, MotionAnalyzer, type MotionConfig } from './MotionAnalyzer';
import { OneEuroFilter } from './OneEuroFilter';
import { AXES, type AxisId, type GestureId, type GestureOrNone, type HandObservation, type HandSide, type MotionId, type TrackFrame, type Vec3 } from './gestureTypes';

export interface HandState {
  side: HandSide;
  present: boolean;
  lastSeen: number;
  /** display-space landmarks of the latest frame */
  landmarks: Vec3[];
  /** raw per-frame classification */
  raw: GestureOrNone;
  confidence: number;
  /** debounced gesture (what actually triggers things) */
  stable: GestureOrNone;
  stableSince: number;
  /** smoothed continuous controls, 0..1 */
  axes: Record<AxisId, number>;
  vx: number;
  vy: number;
  features: HandFeatures | null;
}

export type GestureEvent =
  | { kind: 'gesture'; phase: 'start' | 'end'; hand: HandSide; gesture: GestureId; t: number; x: number; y: number }
  | { kind: 'motion'; hand: HandSide; motion: MotionId; t: number; intensity: number; x: number; y: number };

const LOST_MS = 200;
const RELABEL_FRAMES = 12;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function emptyAxes(): Record<AxisId, number> {
  return Object.fromEntries(AXES.map((a) => [a, a === 'pinch' ? 0 : 0.5])) as Record<AxisId, number>;
}

function newHand(side: HandSide): HandState {
  return { side, present: false, lastSeen: 0, landmarks: [], raw: 'NONE', confidence: 0, stable: 'NONE', stableSince: 0, axes: emptyAxes(), vx: 0, vy: 0, features: null };
}

function palmCentre(lm: readonly Vec3[]): [number, number] {
  const idx = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of idx) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return [x / idx.length, y / idx.length];
}

/**
 * Per-hand pipeline: classify → debounce (smoother) → continuous axes (One-Euro) → motions.
 * Emits clean start/end gesture events and motion events. Also keeps hand identity stable when
 * MediaPipe briefly flips a hand's left/right label.
 */
export class GestureEngine {
  readonly hands: Record<HandSide, HandState> = { Left: newHand('Left'), Right: newHand('Right') };
  onEvent: ((e: GestureEvent) => void) | null = null;
  /** called after every processed frame (hands state is up to date) */
  onFrame: ((t: number) => void) | null = null;
  private smoothers: Record<HandSide, GestureSmoother>;
  private motions: Record<HandSide, MotionAnalyzer>;
  private filters: Record<HandSide, Record<'x' | 'y' | 'pinch', OneEuroFilter>>;
  private disagree: Record<HandSide, number> = { Left: 0, Right: 0 };
  /** frames processed, for diagnostics */
  frames = 0;

  constructor(smoother: SmootherConfig = DEFAULT_SMOOTHER, motion: MotionConfig = DEFAULT_MOTION) {
    this.smoothers = { Left: new GestureSmoother({ ...smoother }), Right: new GestureSmoother({ ...smoother }) };
    this.motions = { Left: new MotionAnalyzer({ ...motion }), Right: new MotionAnalyzer({ ...motion }) };
    const f = () => ({ x: new OneEuroFilter(1.4, 0.03), y: new OneEuroFilter(1.4, 0.03), pinch: new OneEuroFilter(2, 0.05) });
    this.filters = { Left: f(), Right: f() };
  }

  setSmootherConfig(patch: Partial<SmootherConfig>): void {
    for (const s of Object.values(this.smoothers)) s.config = { ...s.config, ...patch };
  }

  get smootherConfig(): SmootherConfig {
    return this.smoothers.Right.config;
  }

  process(frame: TrackFrame): void {
    this.frames++;
    const t = frame.t;
    const seen = new Set<HandSide>();
    for (const { side, obs } of this.resolveSides(frame)) {
      if (seen.has(side)) continue;
      seen.add(side);
      this.updateHand(side, obs, frame.aspect, t);
    }
    for (const side of ['Left', 'Right'] as const) {
      const h = this.hands[side];
      if (h.present && !seen.has(side) && t - h.lastSeen > LOST_MS) this.lose(side, t);
    }
    this.onFrame?.(t);
  }

  /** Camera stopped / tracking paused: release everything. */
  reset(t = performance.now()): void {
    for (const side of ['Left', 'Right'] as const) if (this.hands[side].present) this.lose(side, t);
  }

  private resolveSides(frame: TrackFrame): Array<{ side: HandSide; obs: HandObservation }> {
    const items = frame.hands.map((obs) => {
      const [cx, cy] = palmCentre(obs.landmarks);
      return { obs, side: obs.side, cx, cy };
    });
    if (items.length >= 2 && items[0].side === items[1].side) {
      // the same label twice: decide by screen position (the right hand is on the right in a mirror view)
      items.sort((a, b) => a.cx - b.cx);
      items[0].side = frame.mirrored ? 'Left' : 'Right';
      items[1].side = frame.mirrored ? 'Right' : 'Left';
    } else if (items.length === 1) {
      const it = items[0];
      const other: HandSide = it.side === 'Left' ? 'Right' : 'Left';
      const prevOther = this.hands[other];
      const prevSame = this.hands[it.side];
      const [px, py] = prevOther.landmarks.length ? palmCentre(prevOther.landmarks) : [Infinity, Infinity];
      const close = Math.hypot(px - it.cx, py - it.cy) < 0.12;
      if (!prevSame.present && prevOther.present && close) {
        // MediaPipe flipped the label of the hand we were already tracking: keep identity…
        this.disagree[other]++;
        if (this.disagree[other] < RELABEL_FRAMES) it.side = other;
        else {
          // …unless the new label persists, then accept it
          this.disagree[other] = 0;
          this.lose(other, frame.t);
        }
      } else {
        this.disagree.Left = 0;
        this.disagree.Right = 0;
      }
    }
    return items.map(({ side, obs }) => ({ side, obs }));
  }

  private updateHand(side: HandSide, obs: HandObservation, aspect: number, t: number) {
    const h = this.hands[side];
    h.present = true;
    h.lastSeen = t;
    h.landmarks = obs.landmarks;
    const c = classifyHand(obs.landmarks, aspect, this.smoothers[side].config.enterThreshold);
    h.raw = c.gesture;
    h.confidence = c.confidence;
    h.features = c.features;
    const f = c.features;

    const smoother = this.smoothers[side];
    for (const e of smoother.update(c.scores, c.gesture, t)) {
      this.onEvent?.({ kind: 'gesture', phase: e.type, hand: side, gesture: e.gesture, t, x: f.cx, y: f.cy });
    }
    h.stable = smoother.stable;
    h.stableSince = smoother.stableSince;

    const flt = this.filters[side];
    h.axes.x = flt.x.filter(clamp01((f.cx - 0.1) / 0.8), t);
    h.axes.y = flt.y.filter(clamp01((1 - f.cy - 0.1) / 0.8), t);
    h.axes.pinch = clamp01(flt.pinch.filter(f.pinchAmount, t));
    h.axes.rotation = clamp01(0.5 + f.rotation / Math.PI);
    h.axes.openness = f.openness;
    h.axes.depth = smoothstep(0.08, 0.32, f.palmSize);
    h.axes.spread = smoothstep(0.4, 1.3, f.spread);

    const motion = this.motions[side];
    for (const m of motion.update(t, f.cx, f.cy, f.openness)) {
      this.onEvent?.({ kind: 'motion', hand: side, motion: m.motion, t, intensity: m.intensity, x: f.cx, y: f.cy });
    }
    h.vx = motion.vx;
    h.vy = motion.vy;
  }

  private lose(side: HandSide, t: number) {
    const h = this.hands[side];
    const [x, y] = h.landmarks.length ? palmCentre(h.landmarks) : [0.5, 0.5];
    for (const e of this.smoothers[side].reset(t)) this.onEvent?.({ kind: 'gesture', phase: e.type, hand: side, gesture: e.gesture, t, x, y });
    this.motions[side].reset();
    for (const flt of Object.values(this.filters[side])) flt.reset();
    this.hands[side] = newHand(side);
  }
}
