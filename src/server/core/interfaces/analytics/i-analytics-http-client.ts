import type {AnalyticsBatch} from '../../domain/analytics/batch.js'

/**
 * Per-request headers stamped onto every analytics POST.
 *
 * `deviceId` is mandatory — the backend's IdentityResolverGuard rejects
 * anonymous batches without it. `sessionId` is the per-request session
 * token (M3.4 backwards-compat hint); the authoritative per-event identity
 * lives inside each event after M4.1.
 *
 * `userAgent` follows the `brv-cli/<version>` convention; the impl
 * stamps it so backend logs can correlate by CLI version.
 */
export type AnalyticsHttpHeaders = Readonly<{
  deviceId: string
  sessionId?: string
  userAgent: string
}>

/**
 * Outcome of a single send attempt. Tagged-union so the caller
 * (`HttpAnalyticsSender`) can classify the failure mode for the M4.5
 * backoff policy and the M4.6 status command without re-parsing
 * arbitrary error objects.
 *
 * Reasons:
 *   - `timeout`    — request exceeded the 5 second budget.
 *   - `http_4xx`   — backend rejected the payload (validation, auth, etc).
 *   - `http_5xx`   — backend error; eligible for backoff retry.
 *   - `network`    — connection refused / DNS / TLS / abort before response.
 *
 * `status` is populated only for `http_4xx` / `http_5xx` paths so the
 * caller can log the exact code.
 */
export type AnalyticsHttpSendResult =
  | Readonly<{
      ok: false
      reason: 'http_4xx' | 'http_5xx' | 'network' | 'timeout'
      status?: number
    }>
  | Readonly<{ok: true}>

/**
 * Daemon-side HTTP transport for analytics batches. Single attempt per
 * call, no retries (M4.5 owns retry/backoff); 5 second timeout.
 *
 * MUST NOT throw — every failure path returns a structured
 * `AnalyticsHttpSendResult`. Analytics MUST NOT crash the daemon.
 *
 * Implementations:
 *   - `AxiosAnalyticsHttpClient` — production transport over axios.
 *   - In-process fakes in unit tests for offline assertion.
 */
export interface IAnalyticsHttpClient {
  send: (batch: AnalyticsBatch, headers: AnalyticsHttpHeaders) => Promise<AnalyticsHttpSendResult>
}
