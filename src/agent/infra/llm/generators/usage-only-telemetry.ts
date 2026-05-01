/**
 * Usage-only telemetry wrapper for background content generators.
 *
 * Background paths (abstract-queue, compaction) deliberately bypass
 * `LoggingContentGenerator` to avoid `llmservice:thinking` spinner noise
 * and `llmservice:error` UI surfacing — but they still need
 * `llmservice:usage` to flow into the agent event bus so that
 * `UsageLogger` (and any other agent-bus consumers) can record
 * provider-reported token counts.
 *
 * This helper wraps a generator with a usage-only `LoggingContentGenerator`
 * over a fresh `SessionEventBus`, then bridges only the `llmservice:usage`
 * event from that bus to the supplied `AgentEventBus`, tagging payloads
 * with the caller-supplied sessionTag so log lines remain attributable.
 */

import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'

import {AgentEventBus, SessionEventBus} from '../../events/event-emitter.js'
import {LoggingContentGenerator} from './logging-content-generator.js'

/**
 * Parameters for {@link wrapWithUsageOnlyTelemetry}.
 */
export interface UsageOnlyTelemetryParams {
  /** Agent event bus to which `llmservice:usage` events should be forwarded. */
  agentEventBus: AgentEventBus
  /** Generator to wrap. */
  inner: IContentGenerator
  /** Session identifier attached to each forwarded usage event for attribution. */
  sessionTag: string
}

/**
 * Wrap a content generator so each LLM call emits a single
 * `llmservice:usage` event on the agent bus, tagged with the supplied
 * sessionTag. No other events surface — `thinking`, `error`, and chunks
 * are suppressed.
 */
export function wrapWithUsageOnlyTelemetry(params: UsageOnlyTelemetryParams): IContentGenerator {
  const {agentEventBus, inner, sessionTag} = params
  const sessionBus = new SessionEventBus()

  sessionBus.on('llmservice:usage', (payload) => {
    agentEventBus.emit('llmservice:usage', {
      ...payload,
      sessionId: sessionTag,
    })
  })

  return new LoggingContentGenerator(inner, sessionBus, {usageOnly: true})
}
