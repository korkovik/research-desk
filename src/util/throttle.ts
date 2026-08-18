/**
 * A single-lane queue with a minimum gap between departures.
 *
 * Semantic Scholar allows one request per second (§4.2), and the spec is
 * explicit that calls must be sequential with a sleep, not parallel. This
 * enforces that in one place so no caller can accidentally fan out.
 */
export class Throttle {
  private last = 0;

  constructor(
    private readonly minGapMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Waits until at least `minGapMs` has passed since the previous departure. */
  async take(): Promise<void> {
    const elapsed = this.now() - this.last;
    const wait = this.minGapMs - elapsed;
    if (this.last !== 0 && wait > 0) await this.sleep(wait);
    this.last = this.now();
  }
}
