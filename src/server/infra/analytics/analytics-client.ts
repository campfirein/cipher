import {randomUUID} from 'node:crypto'

import type {AnalyticsEventName} from '../../../shared/analytics/event-names.js'
import type {PropsArg, PropsForEvent} from '../../../shared/analytics/events/index.js'
import type {StoredAnalyticsRecord} from '../../../shared/analytics/stored-record.js'
import type {IAnalyticsClient} from '../../core/interfaces/analytics/i-analytics-client.js'
import type {IAnalyticsQueue} from '../../core/interfaces/analytics/i-analytics-queue.js'
import type {IAnalyticsSender, SendResult} from '../../core/interfaces/analytics/i-analytics-sender.js'
import type {IIdentityResolver} from '../../core/interfaces/analytics/i-identity-resolver.js'
import type {IJsonlAnalyticsStore} from '../../core/interfaces/analytics/i-jsonl-analytics-store.js'
import type {ISuperPropertiesResolver} from '../../core/interfaces/analytics/i-super-properties-resolver.js'

import {toWireEvent} from '../../../shared/analytics/stored-record.js'
import {AnalyticsBatch} from '../../core/domain/analytics/batch.js'

export interface AnalyticsClientDeps {
  identityResolver: IIdentityResolver
  isEnabled: () => boolean
  jsonlStore: IJsonlAnalyticsStore
  /**
   * Optional structured log sink for operational visibility. Used by
   * `onAuthTransition` to surface a `clear()` failure that would
   * otherwise silently leave prior-session events on disk. Defaults to
   * a no-op when omitted so existing callers don't have to wire it.
   */
  log?: (message: string) => void
  queue: IAnalyticsQueue
  sender: IAnalyticsSender
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
  // Single-flight slot for an in-flight `flush()`. Concurrent callers join the
  // existing promise instead of starting a second read-then-decide cycle —
  // without this, two parallel flushes would both `loadPending()` the same set,
  // both invoke `sender.send`, and both mirror `updateStatus(_, 'failed')` into
  // the write chain (which serializes the WRITES but not the READ-decisions),
  // double-incrementing `attempts` per cycle and tripping the M9.2 retry cap
  // in MAX_ATTEMPTS/2 cycles instead of MAX_ATTEMPTS.
  private pendingFlush?: Promise<AnalyticsBatch>
  // M4.1 in-flight tracking. Each `trackAsync` registers its promise here
  // so `onAuthTransition` can await every track that started BEFORE the
  // transition before issuing `clear()`. Without this barrier:
  //   - a track that resolved old identity but hasn't appended yet may
  //     enqueue its append AFTER clear → record persists with stale
  //     identity → backend rejects on mismatch.
  //   - a track that already enqueued append BEFORE clear is correctly
  //     nuked by clear (intentional — pre-transition events drop).
  // The barrier removes the first failure mode; the second is the
  // designed behavior.
  private readonly pendingTracks = new Set<Promise<void>>()

  public constructor(deps: AnalyticsClientDeps) {
    this.deps = deps
  }

  /**
   * Reads pending rows from JSONL (NOT from the in-memory queue), invokes
   * the registered sender, and mirrors the per-record outcome back to JSONL
   * via `updateStatus`. The queue is intentionally bypassed: it can drop
   * oldest entries on burst overflow (>maxSize), and a queue-based flush
   * would miss those rows even though JSONL still has them.
   *
   * Returns an `AnalyticsBatch` of wire-shape events (id/attempts/status
   * stripped via `toWireEvent`) so a future caller can inspect what was
   * shipped on this tick. `flush()` itself does NOT transmit — the sender
   * does. The returned batch reflects the input snapshot, not the per-record
   * succeeded/failed split.
   *
   * A sender that throws is treated as `{succeeded: [], failed: <all ids>}`
   * — analytics MUST NOT crash the daemon. M9.2's `updateStatus(_, 'failed')`
   * owns the retry-cap policy: rows stay at `'pending'` until
   * `attempts >= MAX_ATTEMPTS`, then transition to terminal `'failed'`.
   * `flush()` is a thin caller — it does not inspect attempts.
   */
  public async flush(): Promise<AnalyticsBatch> {
    // Single-flight: if a flush is already running, hand its promise to the
    // joining caller so both observe the same loadPending snapshot, the same
    // sender invocation, and the same mirror writes.
    if (this.pendingFlush !== undefined) return this.pendingFlush

    this.pendingFlush = this.runFlush()
    try {
      return await this.pendingFlush
    } finally {
      this.pendingFlush = undefined
    }
  }

  public async onAuthTransition(): Promise<void> {
    // Snapshot in-flight tracks then wait for them to settle. Any
    // `trackAsync` that started before this point may still be between
    // identity-resolve and `jsonlStore.append` / `queue.push`; awaiting
    // it guarantees its append has either landed in the write chain (so
    // the clear enqueued below nukes it — correct, those identities are
    // stale) or failed (so there is nothing to nuke). New `track()`
    // calls that arrive after this snapshot resolve identity from the
    // post-transition cached token and are NOT included in the barrier.
    //
    // `Promise.allSettled` rather than `all` because individual track
    // promises may already swallow-and-resolve on error; we just need
    // the settled signal, not the result.
    if (this.pendingTracks.size > 0) {
      await Promise.allSettled(this.pendingTracks)
    }

    // Drain the in-memory mirror AFTER the barrier so any push that the
    // completing track did is also wiped. Draining before the barrier
    // would leave a window where the late-completing track pushes back
    // into a fresh queue → prior-session record stays visible to webui.
    this.deps.queue.drain()

    try {
      await this.deps.jsonlStore.clear()
    } catch (error) {
      // Analytics MUST NOT crash the consumer. Surface the failure
      // through the optional log sink so operators see why a flush
      // after transition would ship prior-session events.
      this.deps.log?.(
        `analytics.onAuthTransition: clear failed (${error instanceof Error ? error.message : String(error)})`,
      )
    }
  }

  public track<E extends AnalyticsEventName>(event: E, ...rest: PropsArg<E>): void {
    if (!this.deps.isEnabled()) return
    // Capture the timestamp synchronously at call-site so it reflects WHEN the
    // user action happened, not when the async resolver chain settled. Under
    // burst load (many tracks queued before the first resolver completes) this
    // preserves the inter-event durations downstream consumers care about.
    const timestamp = Date.now()
    const [properties] = rest
    const pending = this.trackAsync(event, properties, timestamp)
    this.pendingTracks.add(pending)
    // Remove from the in-flight set once the track settles either way.
    // `void` keeps `track()` synchronous per the IAnalyticsClient contract.
    // eslint-disable-next-line no-void
    void pending.finally(() => {
      this.pendingTracks.delete(pending)
    })
  }

  private async runFlush(): Promise<AnalyticsBatch> {
    const records = await this.deps.jsonlStore.loadPending()

    let result: SendResult
    try {
      result = await this.deps.sender.send(records)
    } catch {
      result = {failed: records.map((r) => r.id), succeeded: []}
    }

    await this.deps.jsonlStore.updateStatus(result.succeeded, 'sent')
    await this.deps.jsonlStore.updateStatus(result.failed, 'failed')

    return AnalyticsBatch.create(records.map((r) => toWireEvent(r)))
  }

  private async trackAsync<E extends AnalyticsEventName>(
    event: E,
    properties: PropsForEvent<E> | undefined,
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

      // Persist to JSONL FIRST. If `append` throws — disk error, or
      // `JsonlCapFullError` when the file-size cap is saturated with non-sent
      // rows — the outer catch silently drops and queue.push is skipped. This
      // preserves the "JSONL is source of truth" invariant: no record reaches
      // the in-memory mirror queue without a durable on-disk row.
      await this.deps.jsonlStore.append(record)
      this.deps.queue.push(record)
    } catch {
      // Analytics MUST NOT crash the consumer. Errors silently dropped.
    }
  }
}
