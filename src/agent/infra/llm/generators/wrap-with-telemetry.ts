import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'

import {AgentEventBus, SessionEventBus} from '../../events/event-emitter.js'
import {DEFAULT_RETRY_POLICY} from '../retry/retry-policy.js'
import {LoggingContentGenerator} from './logging-content-generator.js'
import {RetryableContentGenerator} from './retryable-content-generator.js'

/**
 * Synthetic sessionId used to tag background-path usage events. Background
 * abstract-queue calls have no real session context — the agent bus payload
 * shape requires a sessionId, so we tag with this constant for filterability.
 */
export const BACKGROUND_TELEMETRY_SESSION_ID = 'background:abstract-queue'

/**
 * Wrap a content generator for the abstract-queue background path so its LLM
 * calls emit `llmservice:usage` events that the daemon's UsageLogger captures.
 *
 * Foreground generators are constructed inside session services (each session
 * has a SessionEventBus that the SessionEventForwarder routes onto the agent
 * bus). Background generators have no session context, so this helper wires a
 * one-shot SessionEventBus that forwards `llmservice:usage` directly onto the
 * supplied agent bus.
 *
 * The retry decorator wraps the logging decorator so each successful attempt
 * emits exactly one usage event.
 */
export function wrapBackgroundGeneratorWithTelemetry(
  generator: IContentGenerator,
  agentBus: AgentEventBus,
  sessionId: string = BACKGROUND_TELEMETRY_SESSION_ID,
): RetryableContentGenerator {
  const sessionBus = new SessionEventBus()
  sessionBus.on('llmservice:usage', (payload) => {
    agentBus.emit('llmservice:usage', {...payload, sessionId})
  })
  const logging = new LoggingContentGenerator(generator, sessionBus)
  return new RetryableContentGenerator(logging, {policy: DEFAULT_RETRY_POLICY})
}
