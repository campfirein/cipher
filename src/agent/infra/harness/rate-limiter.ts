import {HarnessModeCError} from './harness-mode-c-errors.js'

/**
 * Sliding-window rate limiter. Process-wide — a runaway harness
 * spawning sessions cannot bypass a per-session cap, so the right
 * scope is the daemon process.
 *
 * Current v1.0 consumer: reserved for `tools.curation.mapExtract()`
 * when that surface lands on `HarnessContextTools` (out of scope for
 * v1.0 per Phase 4 Task 4.3 scope narrowing). Shipped now so the
 * wiring is a one-liner when mapExtract joins the surface.
 */
export const RATE_CAP_DEFAULT = 30
export const RATE_WINDOW_MS_DEFAULT = 60_000

export class RateLimiter {
  private readonly cap: number
  private readonly timestamps: number[] = []
  private readonly windowMs: number

  constructor(cap: number = RATE_CAP_DEFAULT, windowMs: number = RATE_WINDOW_MS_DEFAULT) {
    this.cap = cap
    this.windowMs = windowMs
  }

  /**
   * Test-only helper — clears the in-flight window so tests don't
   * leak rate state between cases. Production code must not call
   * this; the `_` prefix flags it as internal.
   *
   * @internal
   */
  _resetForTests(): void {
    this.timestamps.length = 0
  }

  /**
   * Record one call against the limit. Throws `HarnessModeCError`
   * with code `'RATE_CAP_THROTTLED'` if the `cap + 1`-th call would
   * land inside the current rolling window.
   */
  checkAndRecord(): void {
    const now = Date.now()
    const cutoff = now - this.windowMs
    // Expire stale entries. At cap = 30, shift cost is negligible.
    while (this.timestamps.length > 0 && this.timestamps[0] !== undefined && this.timestamps[0] < cutoff) {
      this.timestamps.shift()
    }

    if (this.timestamps.length >= this.cap) {
      throw new HarnessModeCError(
        `Harness Mode C rate cap throttled: ${this.timestamps.length + 1} > ${this.cap} calls in ${this.windowMs}ms`,
        'RATE_CAP_THROTTLED',
        {cap: this.cap, count: this.timestamps.length + 1, windowMs: this.windowMs},
      )
    }

    this.timestamps.push(now)
  }
}

/**
 * Process-wide singleton. Imported by `SandboxService` when the
 * rate-limited tool surface comes online. Tests exercise the class
 * directly; this singleton exists so production wiring can be added
 * as a single `GLOBAL_RATE_LIMITER.checkAndRecord()` call at the
 * wrapper site.
 */
export const GLOBAL_RATE_LIMITER = new RateLimiter()
