import type {IAnalyticsClient} from '../../../core/interfaces/analytics/i-analytics-client.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {AnalyticsEvents, type AnalyticsTrackRequest} from '../../../../shared/transport/events/analytics-events.js'
import {AnalyticsTrackPayloadSchema} from '../../../core/domain/transport/schemas.js'

export interface AnalyticsHandlerDeps {
  analyticsClient: IAnalyticsClient
  transport: ITransportServer
}

/**
 * Daemon-side handler for `analytics:track` (M2.6). Routes validated
 * payloads to the daemon-scoped AnalyticsClient (M2.5), which stamps
 * identity + super-properties and enqueues for later flush.
 *
 * Validation is wire-level only (event is non-empty string, properties
 * is record-or-undefined). Per-event property schemas (cli_invocation,
 * mcp_tool_called, …) are designed in M2.8.
 *
 * Malformed payloads and any throw from track() are silently dropped:
 * analytics MUST NOT crash the emitting client.
 */
export class AnalyticsHandler {
  private readonly analyticsClient: IAnalyticsClient
  private readonly transport: ITransportServer

  public constructor(deps: AnalyticsHandlerDeps) {
    this.analyticsClient = deps.analyticsClient
    this.transport = deps.transport
  }

  public setup(): void {
    this.transport.onRequest<AnalyticsTrackRequest, void>(AnalyticsEvents.TRACK, async (data: unknown) => {
      const parsed = AnalyticsTrackPayloadSchema.safeParse(data)
      if (!parsed.success) return

      try {
        this.analyticsClient.track(parsed.data.event, parsed.data.properties)
      } catch {
        // Defensive: never crash the emitter.
      }
    })
  }
}
