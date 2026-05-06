import type {AnalyticsEventWithIdentity} from '../../core/domain/analytics/batch.js'
import type {IAnalyticsClient} from '../../core/interfaces/analytics/i-analytics-client.js'
import type {IAnalyticsQueue} from '../../core/interfaces/analytics/i-analytics-queue.js'
import type {IIdentityResolver} from '../../core/interfaces/analytics/i-identity-resolver.js'
import type {ISuperPropertiesResolver} from '../../core/interfaces/analytics/i-super-properties-resolver.js'

import {AnalyticsBatch} from '../../core/domain/analytics/batch.js'

export interface AnalyticsClientDeps {
  identityResolver: IIdentityResolver
  isEnabled: () => boolean
  queue: IAnalyticsQueue
  superPropsResolver: ISuperPropertiesResolver
}

/**
 * Daemon-scoped analytics client. Implements the M2.1 IAnalyticsClient
 * contract by composing M2.2 (queue), M2.3 (super-props), and M2.4
 * (identity).
 *
 * `track()` is sync per the M2.1 interface — when enabled, the actual
 * resolve+enqueue work is fire-and-forget via `void this.trackAsync()`,
 * matching the established `auth-state-store.ts` pattern. Errors during
 * the async work are silently swallowed: analytics MUST NOT crash the
 * consumer, and per ticket scope no error reporting surface exists yet.
 *
 * When disabled, `track()` is a true no-op: no resolver calls, no
 * allocations beyond the function call frame.
 */
export class AnalyticsClient implements IAnalyticsClient {
  private readonly deps: AnalyticsClientDeps

  public constructor(deps: AnalyticsClientDeps) {
    this.deps = deps
  }

  public async flush(): Promise<AnalyticsBatch> {
    return AnalyticsBatch.create(this.deps.queue.drain())
  }

  public track(event: string, properties?: Record<string, unknown>): void {
    if (!this.deps.isEnabled()) return
    // Capture the timestamp synchronously at call-site so it reflects WHEN the
    // user action happened, not when the async resolver chain settled. Under
    // burst load (many tracks queued before the first resolver completes) this
    // preserves the inter-event durations downstream consumers care about.
    const timestamp = Date.now()
    // eslint-disable-next-line no-void
    void this.trackAsync(event, properties, timestamp)
  }

  private async trackAsync(
    event: string,
    properties: Record<string, unknown> | undefined,
    timestamp: number,
  ): Promise<void> {
    try {
      const [identity, superProps] = await Promise.all([
        this.deps.identityResolver.resolve(),
        this.deps.superPropsResolver.resolve(),
      ])

      const stamped: AnalyticsEventWithIdentity = {
        identity,
        name: event,
        // Super-properties are authoritative: they overwrite any user-supplied
        // property with the same key. This guarantees a consistent envelope
        // (cli_version, device_id, environment, node_version, os) on every event.
        properties: {...properties, ...superProps},
        timestamp,
      }

      this.deps.queue.push(stamped)
    } catch {
      // Analytics MUST NOT crash the consumer. Errors silently dropped.
    }
  }
}
