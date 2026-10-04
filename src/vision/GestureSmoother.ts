import type { GestureId, GestureOrNone } from './gestureTypes';

export interface SmootherConfig {
  /** a new gesture must be seen for this long (ms) before it fires */
  dwellMs: number;
  /** …and for at least this many consecutive tracking frames */
  minFrames: number;
  /** a confirmed gesture survives drop-outs shorter than this (ms) before it is released */
  releaseMs: number;
  /** the same gesture cannot fire again on the same hand within this window (ms) */
  cooldownMs: number;
  /** score needed to start a gesture */
  enterThreshold: number;
  /** lower score that keeps an already-confirmed gesture alive (hysteresis) */
  holdThreshold: number;
}

export const DEFAULT_SMOOTHER: SmootherConfig = {
  dwellMs: 90,
  minFrames: 2,
  releaseMs: 140,
  cooldownMs: 200,
  enterThreshold: 0.55,
  holdThreshold: 0.35,
};

export interface SmootherEvent {
  type: 'start' | 'end';
  gesture: GestureId;
  t: number;
}

/**
 * Turns noisy per-frame classifications into clean edge events.
 *
 * A gesture STARTS once it has been the best candidate for `dwellMs` and `minFrames`, ENDS once it
 * has not been seen (above the lower hold threshold) for `releaseMs`, and cannot re-fire within
 * `cooldownMs`. Holding a pose never re-triggers: events are edges, not levels.
 */
export class GestureSmoother {
  config: SmootherConfig;
  stable: GestureOrNone = 'NONE';
  stableSince = 0;
  private suppressed = false;
  private lastSeenStable = 0;
  private pending: GestureOrNone = 'NONE';
  private pendingSince = 0;
  private pendingFrames = 0;
  private pendingLastSeen = 0;
  private lastFired = new Map<GestureId, number>();

  constructor(config: SmootherConfig = DEFAULT_SMOOTHER) {
    this.config = config;
  }

  update(scores: Readonly<Record<GestureId, number>>, best: GestureOrNone, t: number): SmootherEvent[] {
    const c = this.config;
    const events: SmootherEvent[] = [];

    if (this.stable !== 'NONE' && scores[this.stable] >= c.holdThreshold) this.lastSeenStable = t;

    const candidate: GestureOrNone = best !== 'NONE' && scores[best] >= c.enterThreshold ? best : 'NONE';

    if (candidate !== 'NONE' && candidate !== this.stable) {
      if (candidate === this.pending) {
        this.pendingFrames++;
      } else {
        this.pending = candidate;
        this.pendingSince = t;
        this.pendingFrames = 1;
      }
      this.pendingLastSeen = t;
      if (t - this.pendingSince >= c.dwellMs && this.pendingFrames >= c.minFrames) {
        this.endStable(t, events);
        this.startStable(candidate, t, events);
      }
    } else if (candidate === this.stable) {
      this.clearPending();
    } else if (this.pending !== 'NONE' && t - this.pendingLastSeen > c.releaseMs / 2) {
      // the pending pose vanished before it was confirmed
      this.clearPending();
    }

    if (this.stable !== 'NONE' && t - this.lastSeenStable >= c.releaseMs) this.endStable(t, events);
    return events;
  }

  /** The hand disappeared: release whatever was held. */
  reset(t: number): SmootherEvent[] {
    const events: SmootherEvent[] = [];
    this.endStable(t, events);
    this.clearPending();
    return events;
  }

  /** how long the current stable gesture has been held (ms), 0 if none */
  heldFor(t: number): number {
    return this.stable === 'NONE' ? 0 : t - this.stableSince;
  }

  private startStable(g: GestureId, t: number, events: SmootherEvent[]) {
    this.stable = g;
    this.stableSince = t;
    this.lastSeenStable = t;
    this.clearPending();
    const last = this.lastFired.get(g) ?? -Infinity;
    if (t - last >= this.config.cooldownMs) {
      this.suppressed = false;
      this.lastFired.set(g, t);
      events.push({ type: 'start', gesture: g, t });
    } else {
      this.suppressed = true;
    }
  }

  private endStable(t: number, events: SmootherEvent[]) {
    if (this.stable === 'NONE') return;
    if (!this.suppressed) events.push({ type: 'end', gesture: this.stable, t });
    this.stable = 'NONE';
    this.suppressed = false;
  }

  private clearPending() {
    this.pending = 'NONE';
    this.pendingFrames = 0;
  }
}
