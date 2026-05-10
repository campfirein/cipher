import type {StoredAnalyticsRecord} from '../../domain/analytics/stored-record.js'

/**
 * Per-send outcome. Each input record's `id` is mirrored back in exactly
 * one of `succeeded` / `failed`; M10.2's flush wiring will then translate
 * those id arrays into `JsonlAnalyticsStore.updateStatus` calls.
 *
 * Both arrays empty is a valid result and is what `NoOpAnalyticsSender`
 * returns — it leaves JSONL state untouched ("nothing was processed").
 */
export type SendResult = Readonly<{
  failed: string[]
  succeeded: string[]
}>

/**
 * Daemon-side sender contract. M10.2's `AnalyticsClient.flush` invokes
 * `send()` with a snapshot of pending JSONL rows; the sender's only
 * responsibility is to attempt transmission and return the per-record
 * outcome as id arrays.
 *
 * Implementations:
 * - `NoOpAnalyticsSender` (this milestone): returns `{succeeded: [], failed: []}`
 *   — JSONL stays untouched until M4.2 wires the real HTTP sender.
 * - `HttpAnalyticsSender` (M4.2): serializes records to the wire format and
 *   POSTs the batch to the telemetry backend.
 */
export interface IAnalyticsSender {
  /**
   * Attempts to ship `records`. Returns the per-record outcome as id arrays.
   * MUST NOT throw — analytics MUST NOT crash the daemon. Implementations
   * that hit a transient error (network failure, 5xx) should classify
   * those records as `failed` and let M9.2's retry-cap policy handle them.
   */
  send: (records: readonly StoredAnalyticsRecord[]) => Promise<SendResult>
}
