import type {AnalyticsEventWithIdentity} from '../../domain/analytics/batch.js'

/**
 * In-memory queue contract for identity-stamped analytics events.
 * Implementations enforce a configurable cap with drop-oldest semantics
 * and track a cumulative dropped count for later observability.
 */
export interface IAnalyticsQueue {
  /**
   * Drains the queue and returns the events in FIFO order. Caller takes
   * ownership; the queue is empty afterwards. `droppedCount()` is NOT
   * reset by this call.
   */
  drain: () => AnalyticsEventWithIdentity[]

  /**
   * Returns the cumulative number of events dropped due to the cap
   * across the queue's lifetime. Never reset.
   */
  droppedCount: () => number

  /**
   * Pushes an event onto the queue. If the queue is at capacity, the
   * oldest event is dropped to make room and `droppedCount()` is
   * incremented.
   */
  push: (event: AnalyticsEventWithIdentity) => void

  /**
   * Returns the current number of events in the queue.
   */
  size: () => number
}
