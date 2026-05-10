import type {StoredAnalyticsRecord} from '../../core/domain/analytics/stored-record.js'
import type {IAnalyticsSender, SendResult} from '../../core/interfaces/analytics/i-analytics-sender.js'

/**
 * Default sender used until M4.2 wires the real HTTP sender. `send()` is
 * semantically inert: it returns both arrays empty, so when M10.2's flush
 * mirrors the result back to JSONL via `updateStatus(succeeded, 'sent')`
 * and `updateStatus(failed, 'failed')`, both calls receive empty input
 * and become no-ops. Pending JSONL rows stay at `status='pending'` and
 * the next flush tick (after the real sender plugs in) ships them.
 *
 * Returning empty arrays — rather than echoing every input id as
 * `failed` — eliminates the data-loss hazard that would otherwise appear
 * if M4.3 (the flush scheduler) lands before M4.2 (the HTTP sender):
 * scheduled ticks remain observable but non-destructive.
 */
export class NoOpAnalyticsSender implements IAnalyticsSender {
  public async send(_records: readonly StoredAnalyticsRecord[]): Promise<SendResult> {
    return {failed: [], succeeded: []}
  }
}
