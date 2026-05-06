import type {AnalyticsEventWithIdentity} from '../../core/domain/analytics/batch.js'
import type {IAnalyticsQueue} from '../../core/interfaces/analytics/i-analytics-queue.js'

const DEFAULT_MAX_SIZE = 1000

/**
 * In-memory bounded queue with drop-oldest semantics. Newest pushes
 * always succeed; if the queue is at capacity, the oldest event is
 * removed first. `droppedCount` is cumulative across the queue's
 * lifetime — neither `drain` nor any other method resets it.
 *
 * Backing store is a plain Array; at the default `maxSize` of 1000 the
 * O(n) cost of `Array.prototype.shift()` on overflow is negligible.
 */
export class BoundedQueue implements IAnalyticsQueue {
  private dropped = 0
  private events: AnalyticsEventWithIdentity[] = []
  private readonly maxSize: number

  public constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    if (!Number.isInteger(maxSize) || maxSize < 0) {
      throw new Error(`BoundedQueue maxSize must be a non-negative integer; got ${maxSize}`)
    }

    this.maxSize = maxSize
  }

  public drain(): AnalyticsEventWithIdentity[] {
    const drained = this.events
    this.events = []
    return drained
  }

  public droppedCount(): number {
    return this.dropped
  }

  public push(event: AnalyticsEventWithIdentity): void {
    this.events.push(event)
    while (this.events.length > this.maxSize) {
      this.events.shift()
      this.dropped++
    }
  }

  public size(): number {
    return this.events.length
  }
}
