import type {AnalyticsEventName} from '../../../../shared/analytics/event-names.js'
import type {PropsArg} from '../../../../shared/analytics/events/index.js'
import type {AnalyticsBatch} from '../../domain/analytics/batch.js'

/**
 * Consumer-facing analytics tracking contract. Every consumer surface
 * (TUI, oclif commands, MCP server, webui, agent processes) ultimately
 * routes events into an implementation of this interface inside the
 * daemon. Implementations are responsible for identity resolution,
 * super-property stamping, and queueing; consumers just call `track()`.
 *
 * `track()` is typed against the discriminated union catalog
 * (`AnyAnalyticsEvent` in `shared/analytics/events/index.ts`): magic-string
 * typos and wrong-shape payloads become compile errors. Adding a new event
 * requires registering it in the catalog first; emit sites then become
 * statically checked.
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
   *
   * The generic `<E extends AnalyticsEventName>` plus `PropsArg<E>` rest
   * tuple force callers to pick a registered event name and supply a
   * matching property shape. Events with no required properties (e.g.
   * `daemon_start`) allow the properties argument to be omitted.
   */
  track: <E extends AnalyticsEventName>(event: E, ...rest: PropsArg<E>) => void
}
