import type {ITransportClient} from '@campfirein/brv-transport-client'

import {AnalyticsEvents, type AnalyticsTrackPayload} from '../transport/events/analytics-events.js'

/**
 * Fire-and-forget analytics emission for non-forked daemon clients
 * (TUI, oclif, MCP, webui). Uses `client.request` (no ack) so the caller
 * never waits on the daemon.
 *
 * NEVER throws. If the client is not connected or `request` throws for
 * any reason, the error is swallowed: analytics MUST NOT crash the caller.
 */
export function emitAnalytics(
  client: ITransportClient,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const payload: AnalyticsTrackPayload = {event, properties}
  try {
    client.request(AnalyticsEvents.TRACK, payload)
  } catch {
    // Intentional: analytics must not crash consumers.
  }
}
