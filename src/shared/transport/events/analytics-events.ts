import {z} from 'zod'

export const AnalyticsEvents = {
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
