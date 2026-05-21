import type {IAnalyticsClient} from '../../core/interfaces/analytics/i-analytics-client.js'
import type {IAnalyticsQueue} from '../../core/interfaces/analytics/i-analytics-queue.js'
import type {IJsonlAnalyticsStore} from '../../core/interfaces/analytics/i-jsonl-analytics-store.js'

import {AnalyticsFlushScheduler} from '../analytics/analytics-flush-scheduler.js'

export type AnalyticsFlushSchedulerWiring = {
  analyticsClient: IAnalyticsClient
  /** Override the 30s interval (default) for tests / dev experiments. */
  intervalMs?: number
  isEnabled: () => boolean
  /**
   * JSONL store used to count pending rows for the empty-skip gate. The
   * scheduler uses `loadPending().length` (NOT `queue.size()`) because
   * the in-memory queue mirror never decrements after a successful flush,
   * which would make the interval timer fire 30s indefinitely with
   * nothing left to ship.
   */
  jsonlStore: IJsonlAnalyticsStore
  queue: IAnalyticsQueue
  /** Override the 20-event threshold (default) for tests / dev experiments. */
  thresholdCount?: number
}

/**
 * Compose the M4.3 flush scheduler.
 *
 * The scheduler is the orchestrator that decides WHEN to flush; it
 * delegates the actual flush work to `IAnalyticsClient.flush()`. Two
 * triggers (whichever first):
 *   - 30s interval timer
 *   - 20-event queue depth
 *
 * Returned `AnalyticsFlushScheduler` is owned by the composition root:
 *   - call `start()` after the AnalyticsClient is wired (so the first
 *     tick has a working sender).
 *   - call `stop()` in the shutdown sequence before `flushFinal()` so
 *     no new ticks fire mid-shutdown.
 *
 * Extracted from `feature-handlers.ts` so the wiring is testable in
 * isolation — mirrors the M4.1 / M4.2 wiring helper pattern.
 */
export function wireAnalyticsFlushScheduler(
  wiring: AnalyticsFlushSchedulerWiring,
): AnalyticsFlushScheduler {
  return new AnalyticsFlushScheduler({
    flush: () => wiring.analyticsClient.flush(),
    ...(wiring.intervalMs === undefined ? {} : {intervalMs: wiring.intervalMs}),
    isEnabled: wiring.isEnabled,
    pendingCount: async () => (await wiring.jsonlStore.loadPending()).length,
    queueSize: () => wiring.queue.size(),
    ...(wiring.thresholdCount === undefined ? {} : {thresholdCount: wiring.thresholdCount}),
  })
}
