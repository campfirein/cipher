const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_THRESHOLD_COUNT = 20

export interface AnalyticsFlushSchedulerDeps {
  /**
   * Async flush operation invoked when a trigger fires. MUST NOT throw —
   * the scheduler wraps every call in `.catch` so a flush failure cannot
   * crash the interval loop or shutdown sequence.
   */
  flush: () => Promise<unknown>
  /** Polling interval for the time-based trigger. Defaults to 30s. */
  intervalMs?: number
  /**
   * Lazy analytics-enabled gate. Re-checked on every trigger so a runtime
   * `brv analytics disable` (M1.4) immediately suspends scheduled flushes
   * without restarting the daemon.
   */
  isEnabled: () => boolean
  /**
   * Count of records pending shipment (JSONL `status='pending'` rows).
   * Used by the interval timer and `flushFinal()` to skip flushes when
   * there is nothing left to ship.
   *
   * MUST track JSONL state, NOT the in-memory queue mirror: the queue
   * never decrements after a successful flush (queue.drain only runs on
   * auth transitions), so using it here would make the scheduler fire
   * every 30s indefinitely and waste a no-op HTTP call each time.
   * `HttpAnalyticsSender` flips rows from `pending` to `sent` on 2xx, so
   * this counter shrinks as work completes.
   *
   * Async because reading the JSONL file is I/O; the cost is one read
   * per trigger (≤ once per `intervalMs` plus any threshold firings).
   */
  pendingCount: () => Promise<number>
  /**
   * Synchronous in-memory queue depth, read by the threshold trigger
   * inside `notifyPushed()`. Sync + cheap so `track()` stays on the
   * fast-path; correctness here only requires that the counter grows
   * monotonically across recent pushes, which the bounded queue
   * satisfies.
   */
  queueSize: () => number
  /** Queue depth that trips the threshold-based trigger. Defaults to 20. */
  thresholdCount?: number
}

export type FlushFinalOptions = {
  /** Hard cap on how long the shutdown flush is allowed to take. */
  timeoutMs: number
}

/**
 * Drives automatic flushes for the daemon-scoped analytics client.
 *
 * Two triggers (whichever fires first wins):
 *   - **Interval timer** (`intervalMs`, default 30s): every tick, if the
 *     queue is non-empty AND analytics is enabled, request a flush.
 *   - **Threshold notification** (`thresholdCount`, default 20): callers
 *     invoke `notifyPushed()` after enqueuing a record; if the queue is
 *     at or above the threshold, a flush is scheduled via `setImmediate`
 *     so `track()` stays synchronous from the consumer's view.
 *
 * Single-flight: while a flush is in flight, any new trigger is dropped
 * (NOT queued). The in-flight promise is exposed via `flushFinal()` so
 * shutdown can join it rather than starting a second send.
 *
 * `flushFinal({timeoutMs})` is the shutdown hook: races the in-flight or
 * fresh flush against a timeout and resolves either way, so the daemon
 * exit sequence cannot hang on a slow telemetry backend.
 *
 * Lifecycle owned by the composition root: `start()` after construction,
 * `stop()` during shutdown (before `flushFinal()` so no new ticks fire
 * mid-shutdown).
 *
 * Errors from `flush()` are swallowed at this layer. M4.5's backoff
 * policy will react to the structured failure reason later; for M4.3
 * the scheduler just needs to keep ticking.
 */
export class AnalyticsFlushScheduler {
  private readonly deps: Required<AnalyticsFlushSchedulerDeps>
  private intervalHandle: ReturnType<typeof setInterval> | undefined
  // Single-flight slot. Any trigger that arrives while this is set is
  // dropped; `flushFinal()` awaits it so shutdown joins rather than races.
  private pendingFlush: Promise<void> | undefined

  public constructor(deps: AnalyticsFlushSchedulerDeps) {
    this.deps = {
      flush: deps.flush,
      intervalMs: deps.intervalMs ?? DEFAULT_INTERVAL_MS,
      isEnabled: deps.isEnabled,
      pendingCount: deps.pendingCount,
      queueSize: deps.queueSize,
      thresholdCount: deps.thresholdCount ?? DEFAULT_THRESHOLD_COUNT,
    }
  }

  /**
   * Best-effort final flush for the daemon shutdown sequence. Races the
   * underlying flush against `timeoutMs` and resolves either way so the
   * caller cannot hang on a slow backend.
   *
   * Joins an in-flight flush (returns its promise) rather than starting
   * a second send. Skips the flush entirely when there is nothing in
   * JSONL pending (avoids a wasted no-op HTTP call during shutdown).
   */
  public async flushFinal(options: FlushFinalOptions): Promise<void> {
    if (!this.deps.isEnabled()) return

    // Snapshot the existing in-flight before checking pendingCount so a
    // concurrent flush we should join is honored even if pendingCount
    // reports zero at this exact moment (race-safe: an in-flight flush
    // implies records WERE pending when it started).
    if (this.pendingFlush !== undefined) {
      await this.race(this.pendingFlush, options.timeoutMs)
      return
    }

    if ((await this.deps.pendingCount()) === 0) return

    // Double-check the slot AFTER the pendingCount I/O. During that
    // await, a competing trigger (a queued setImmediate from
    // `notifyPushed`, or an interval tick still mid-flight when `stop()`
    // ran) may have called `startFlush` and claimed `pendingFlush`.
    // Without this re-check the next line would call `startFlush` again,
    // overwrite the slot with a second promise, and the backend would
    // ingest the same records twice. Join the in-flight flush instead.
    if (this.pendingFlush !== undefined) {
      await this.race(this.pendingFlush, options.timeoutMs)
      return
    }

    await this.race(this.startFlush(), options.timeoutMs)
  }

  /**
   * Called by `AnalyticsClient.track()` after enqueuing a record. Checks
   * the threshold (fast, in-memory queue size) and, if crossed, defers
   * the flush to `setImmediate` so the synchronous `track()` contract
   * holds. Threshold uses queueSize (not pendingCount) because: (a) it
   * runs on every track and must stay sync + cheap, and (b) the gate's
   * intent is "20 records pushed since startup" — the queue mirror is
   * exactly that.
   */
  public notifyPushed(): void {
    if (!this.deps.isEnabled()) return
    if (this.deps.queueSize() < this.deps.thresholdCount) return
    setImmediate(() => {
      // eslint-disable-next-line no-void
      void this.tryFlush()
    })
  }

  /**
   * Start the recurring interval timer. Idempotent: a second call while
   * already running is a no-op (does NOT install a second timer).
   */
  public start(): void {
    if (this.intervalHandle !== undefined) return
    this.intervalHandle = setInterval(() => {
      // Interval ticks are fire-and-forget; tryFlush handles its own
      // errors and the void prefix opts out of unhandled-rejection noise.
      // eslint-disable-next-line no-void
      void this.tryFlush()
    }, this.deps.intervalMs)
  }

  /**
   * Stop the recurring timer. Idempotent. Does NOT cancel an in-flight
   * flush — call `flushFinal()` for that.
   */
  public stop(): void {
    if (this.intervalHandle === undefined) return
    clearInterval(this.intervalHandle)
    this.intervalHandle = undefined
  }

  /**
   * Race the given flush promise against a timeout. Used by `flushFinal`
   * to enforce the shutdown budget without blocking on a slow backend.
   */
  private async race(flushPromise: Promise<void>, timeoutMs: number): Promise<void> {
    await Promise.race([
      flushPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs)
      }),
    ])
  }

  /**
   * Invoke the flush and own the single-flight slot for its lifetime.
   * Errors are swallowed at this layer — M4.5 owns retry/backoff.
   */
  private startFlush(): Promise<void> {
    const promise: Promise<void> = this.deps
      .flush()
      .then(
        () => {
          // Discard the flush return value; the scheduler only cares
          // about settlement, not the AnalyticsBatch payload.
        },
        () => {
          // Analytics MUST NOT crash the daemon. M4.5 will surface
          // failure reasons via a different channel.
        },
      )
      .finally(() => {
        if (this.pendingFlush === promise) {
          this.pendingFlush = undefined
        }
      })
    this.pendingFlush = promise
    return promise
  }

  /**
   * Common gate for interval and threshold triggers. Honors the
   * isEnabled gate, the empty-pending skip (JSONL-backed, not queue),
   * and single-flight; delegates to `startFlush` for the actual call.
   *
   * Async so the pendingCount I/O is awaited inside the gate rather
   * than fanned out as a fire-and-forget side effect. Errors are
   * swallowed by `startFlush`; this method itself never throws.
   */
  private async tryFlush(): Promise<void> {
    if (!this.deps.isEnabled()) return
    if (this.pendingFlush !== undefined) return
    if ((await this.deps.pendingCount()) === 0) return
    // pendingFlush may have been set by a competing trigger during the
    // pendingCount I/O — re-check before claiming the slot.
    if (this.pendingFlush !== undefined) return
    await this.startFlush()
  }
}
