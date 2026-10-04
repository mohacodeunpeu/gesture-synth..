/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when the hand is still (kills landmark
 * jitter), little smoothing when it moves fast (keeps latency low).
 */
export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param tMs timestamp in milliseconds */
  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.lastT = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.lastT) / 1000);
    this.lastT = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuroFilter.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuroFilter.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  get value(): number | null {
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}
