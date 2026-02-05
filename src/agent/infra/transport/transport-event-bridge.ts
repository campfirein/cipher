/**
 * TransportEventBridge - Forwards AgentEventBus events to ITransportClient.
 *
 * Bridges the agent's internal event system with the transport layer,
 * allowing agent child processes to stream LLM events directly to the
 * daemon's transport server via Socket.IO.
 *
 * Per-task event forwarding:
 * - setupForTask(taskId) registers listeners filtered by taskId
 * - cleanup() returned by setupForTask removes those listeners
 * - dispose() removes ALL active listeners across all tasks
 *
 * Consumed by:
 * - agent-process.ts: creates bridge after CipherAgent.start(), sets up
 *   forwarding for each incoming task:execute
 */

import type {ITransportClient} from '@campfirein/brv-transport-client'

import type {AgentEventBus} from '../events/event-emitter.js'

/**
 * LLM events forwarded from agent to transport server.
 * Must match TransportLlmEventList in core/domain/transport/schemas.ts.
 */
const FORWARDED_EVENT_NAMES: readonly string[] = [
  'llmservice:thinking',
  'llmservice:chunk',
  'llmservice:response',
  'llmservice:toolCall',
  'llmservice:toolResult',
  'llmservice:error',
  'llmservice:unsupportedInput',
] as const

type TransportEventBridgeOptions = {
  eventBus: AgentEventBus
  transport: ITransportClient
}

export class TransportEventBridge {
  private readonly activeCleanups: Map<string, () => void> = new Map()
  private readonly eventBus: AgentEventBus
  private readonly transport: ITransportClient

  constructor(options: TransportEventBridgeOptions) {
    this.eventBus = options.eventBus
    this.transport = options.transport
  }

  /**
   * Remove all active event listeners across all tasks.
   * Called during agent process shutdown.
   */
  dispose(): void {
    for (const cleanup of this.activeCleanups.values()) {
      cleanup()
    }

    this.activeCleanups.clear()
  }

  /**
   * Register event listeners for a specific task.
   * Only events matching the given taskId are forwarded to transport.
   *
   * @param taskId - Task ID to filter events by
   * @returns Cleanup function that removes all listeners for this task
   */
  setupForTask(taskId: string): () => void {
    const handlers: Array<{event: string; handler: (data?: unknown) => void}> = []

    for (const eventName of FORWARDED_EVENT_NAMES) {
      const handler = (payload?: unknown): void => {
        if (!isPayloadForTask(payload, taskId)) return
        this.transport.request(eventName, payload)
      }

      // Use the untyped overload of on() (accepts string event name)
      // to avoid type narrowing issues when iterating over event names.
      const name: string = eventName
      this.eventBus.on(name, handler)
      handlers.push({event: name, handler})
    }

    const cleanup = (): void => {
      for (const {event, handler} of handlers) {
        this.eventBus.off(event, handler)
      }

      handlers.length = 0
      this.activeCleanups.delete(taskId)
    }

    this.activeCleanups.set(taskId, cleanup)
    return cleanup
  }
}

/**
 * Type guard: checks if payload is an object with a matching taskId.
 * All forwardable LLM events include taskId?: string in their payload.
 */
function isPayloadForTask(payload: unknown, taskId: string): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  if (!('taskId' in payload)) return false
  return payload.taskId === taskId
}
