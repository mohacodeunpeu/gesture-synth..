import type { MotionId } from './gestureTypes';

export interface MotionConfig {
  /** minimum travel (fraction of the screen) for a swipe */
  swipeMinDistance: number;
  /** the travel must happen within this window (ms) */
  swipeWindowMs: number;
  /** the dominant axis must be this many times larger than the other one */
  swipeStraightness: number;
  swipeCooldownMs: number;
  /** swipes only count with a flat, open hand (avoids accidental bank changes) */
  swipeMinOpenness: number;
  /** downward speed (screen heights / s) that counts as a drum hit */
  strikeSpeed: number;
  /** speed under which the strike detector re-arms */
  strikeRearmSpeed: number;
  strikeCooldownMs: number;
  /** frames ignored after a hand appears (positions jump when it enters the frame) */
  warmupFrames: number;
}

export const DEFAULT_MOTION: MotionConfig = {
  swipeMinDistance: 0.2,
  swipeWindowMs: 320,
  swipeStraightness: 1.8,
  swipeCooldownMs: 750,
  swipeMinOpenness: 0.6,
  strikeSpeed: 1.5,
  strikeRearmSpeed: 0.35,
  strikeCooldownMs: 130,
  warmupFrames: 3,
};

export interface MotionEvent {
  motion: MotionId;
  t: number;
  /** 0..1 intensity (strike velocity) */
  intensity: number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

/**
 * Detects swipes and drum "strikes" from the palm trajectory (display coordinates, y down).
 * Also exposes a smoothed velocity for continuous use.
 */
export class MotionAnalyzer {
  config: MotionConfig;
  vx = 0;
  vy = 0;
  private hist: Sample[] = [];
  private frames = 0;
  private strikeArmed = true;
  private lastStrike = -Infinity;
  private lastSwipe = -Infinity;

  constructor(config: MotionConfig = DEFAULT_MOTION) {
    this.config = config;
  }

  update(t: number, x: number, y: number, openness: number): MotionEvent[] {
    const c = this.config;
    const events: MotionEvent[] = [];
    this.frames++;
    this.hist.push({ t, x, y });
    while (this.hist.length > 2 && t - this.hist[0].t > c.swipeWindowMs) this.hist.shift();

    // velocity over ~60 ms (2 frames at 30 fps) for responsiveness
    let ref = this.hist[0];
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (t - this.hist[i].t >= 55) {
        ref = this.hist[i];
        break;
      }
    }
    const dt = (t - ref.t) / 1000;
    if (dt > 0) {
      this.vx = (x - ref.x) / dt;
      this.vy = (y - ref.y) / dt;
    }
    if (this.frames <= c.warmupFrames) return events;

    // --- strikes (fast downward hit) ---
    if (this.strikeArmed && this.vy > c.strikeSpeed && t - this.lastStrike >= c.strikeCooldownMs) {
      this.strikeArmed = false;
      this.lastStrike = t;
      const intensity = Math.min(1, 0.55 + (this.vy - c.strikeSpeed) / (2.5 * c.strikeSpeed));
      events.push({ motion: 'STRIKE', t, intensity });
    } else if (!this.strikeArmed && this.vy < c.strikeRearmSpeed) {
      this.strikeArmed = true;
    }

    // --- swipes ---
    if (t - this.lastSwipe >= c.swipeCooldownMs && openness >= c.swipeMinOpenness && this.hist.length >= 3) {
      const first = this.hist[0];
      const dx = x - first.x;
      const dy = y - first.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      let motion: MotionId | null = null;
      if (adx >= c.swipeMinDistance && adx >= c.swipeStraightness * ady) motion = dx > 0 ? 'SWIPE_RIGHT' : 'SWIPE_LEFT';
      else if (ady >= c.swipeMinDistance && ady >= c.swipeStraightness * adx) motion = dy > 0 ? 'SWIPE_DOWN' : 'SWIPE_UP';
      if (motion) {
        this.lastSwipe = t;
        this.hist = [{ t, x, y }];
        events.push({ motion, t, intensity: Math.min(1, Math.max(adx, ady) / 0.5) });
      }
    }
    return events;
  }

  reset(): void {
    this.hist = [];
    this.frames = 0;
    this.vx = 0;
    this.vy = 0;
    this.strikeArmed = true;
  }
}
