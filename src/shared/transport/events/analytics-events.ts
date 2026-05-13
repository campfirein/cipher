import {z} from 'zod'

import {CliRequestBaseSchema} from '../../analytics/cli-metadata-schema.js'
import {StoredAnalyticsRecordSchema} from '../../analytics/stored-record.js'

export const AnalyticsEvents = {
  LIST: 'analytics:list',
  TRACK: 'analytics:track',
} as const

/**
 * Wire-level validation for `analytics:track` payloads. Identity and super
 * properties are stamped daemon-side on receipt; per-event property schemas
 * (cli_invocation, mcp_tool_called, ...) are designed in M2.8.
 *
 * Single source of truth for the wire shape: callers (emitAnalytics) and the
 * daemon handler (AnalyticsHandler) both use the inferred type so they cannot
 * drift independently.
 */
export const AnalyticsTrackPayloadSchema = z.object({
  event: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
})

export type AnalyticsTrackPayload = z.infer<typeof AnalyticsTrackPayloadSchema>

/**
 * Request schema for `analytics:list` (M11.1). Pagination is offset/limit;
 * filters by `eventName` (free-form) and `status` (M9.1 enum).
 *
 * Bounds (`limit 1..200`, `offset >= 0`) protect the daemon from accidental
 * mass reads and align with the M9.2 store's read-mostly use case.
 */
export const AnalyticsListRequestSchema = z
  .object({
    eventName: z.string().optional(),
    limit: z.number().int().min(1).max(200),
    offset: z.number().int().min(0),
    status: z.enum(['pending', 'sent', 'failed']).optional(),
  })
  .merge(CliRequestBaseSchema)

export type AnalyticsListRequest = z.infer<typeof AnalyticsListRequestSchema>

/**
 * Response schema for `analytics:list`. Reuses M9.1's
 * `StoredAnalyticsRecordSchema` directly — no separate "wire" variant —
 * so a single source of truth covers both the daemon-side store and the
 * webui consumer (M11.2's handler enforces this schema on the way out).
 *
 * `total` is the post-filter row count (NOT total file rows) so a UI can
 * render "showing X-Y of total" correctly.
 */
export const AnalyticsListResponseSchema = z.object({
  rows: z.array(StoredAnalyticsRecordSchema),
  total: z.number().int().min(0),
})

export type AnalyticsListResponse = z.infer<typeof AnalyticsListResponseSchema>
