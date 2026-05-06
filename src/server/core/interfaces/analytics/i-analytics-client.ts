import type {AnalyticsBatch} from '../../domain/analytics/batch.js'

/**
 * Consumer-facing analytics tracking contract. Every consumer surface
 * (TUI, oclif commands, MCP server, webui, agent processes) ultimately
 * routes events into an implementation of this interface inside the
 * daemon. Implementations are responsible for identity resolution,
 * super-property stamping, and queueing; consumers just call `track()`.
 *
 * The interface is intentionally minimal so that consumers depend on a
 * stable contract while the implementation evolves (e.g. M2.1 ships a
 * no-op, M2.5 ships the real client, M4 adds network sends).
 */
export interface IAnalyticsClient {
  /**
   * Drains the queue and returns the events as a serializable batch.
   * Used by the network sender (M4) and by tests.
   */
  flush: () => Promise<AnalyticsBatch>

  /**
   * Records an analytics event. When the analytics flag is disabled the
   * call must be a true no-op (no allocations, no resolver calls).
   */
  track: (event: string, properties?: Record<string, unknown>) => void
}
