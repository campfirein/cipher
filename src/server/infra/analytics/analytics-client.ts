import {randomUUID} from 'node:crypto'

import type {StoredAnalyticsRecord} from '../../core/domain/analytics/stored-record.js'
import type {IAnalyticsClient} from '../../core/interfaces/analytics/i-analytics-client.js'
import type {IAnalyticsQueue} from '../../core/interfaces/analytics/i-analytics-queue.js'
import type {IIdentityResolver} from '../../core/interfaces/analytics/i-identity-resolver.js'
import type {IJsonlAnalyticsStore} from '../../core/interfaces/analytics/i-jsonl-analytics-store.js'
import type {ISuperPropertiesResolver} from '../../core/interfaces/analytics/i-super-properties-resolver.js'

import {AnalyticsBatch} from '../../core/domain/analytics/batch.js'

export interface AnalyticsClientDeps {
  identityResolver: IIdentityResolver
  isEnabled: () => boolean
  jsonlStore: IJsonlAnalyticsStore
  queue: IAnalyticsQueue
  superPropsResolver: ISuperPropertiesResolver
}

/**
 * Daemon-scoped analytics client. Implements the M2.1 IAnalyticsClient
 * contract by composing M2.2 (queue), M2.3 (super-props), and M2.4
 * (identity).
 *
 * `track()` is sync per the M2.1 interface — when enabled, the actual
 * resolve+enqueue work is fire-and-forget via the async trackAsync,
 * matching the established `auth-state-store.ts` pattern. Errors during
 * the async work (resolver rejection, queue push failure) are silently
 * swallowed: analytics MUST NOT crash a correctly-configured consumer,
 * and per ticket scope no error reporting surface exists yet.
 *
 * The no-crash guarantee covers ASYNC errors only. The sync `isEnabled()`
 * callback is called directly; if it throws, the throw propagates to the
 * caller. This is intentional: `isEnabled` is wired to
 * GlobalConfigHandler.getCachedAnalytics(), which throws when invoked
 * before `refreshCache()` has populated the cache. That throw surfaces
 * a bootstrap-misconfiguration bug loudly rather than silently miscounting.
 * Callers MUST ensure the cache is populated before the first `track()`.
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

      // M9.3: compose a StoredAnalyticsRecord — JSONL is the durable source of
      // truth (M10.2's flush reads from JSONL, not the queue). The queue is a
      // fast in-memory mirror for status display / future webui hot path.
      const record: StoredAnalyticsRecord = {
        attempts: 0,
        id: randomUUID(),
        identity,
        name: event,
        // Super-properties are authoritative: they overwrite any user-supplied
        // property with the same key. This guarantees a consistent envelope
        // (cli_version, device_id, environment, node_version, os) on every event.
        properties: {...properties, ...superProps},
        status: 'pending',
        timestamp,
      }

      // Persist to JSONL FIRST. If this throws, the catch silently drops and the
      // queue is NOT pushed — preserves the "JSONL is source of truth" invariant
      // (no events visible to status display that aren't durably stored).
      await this.deps.jsonlStore.append(record)
      this.deps.queue.push(record)
    } catch {
      // Analytics MUST NOT crash the consumer. Errors silently dropped.
    }
  }
}
