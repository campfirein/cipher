import type {AgentExecutionState} from '../../core/interfaces/i-cipher-agent.js'
import type {AgentEventBus} from '../events/event-emitter.js'

/**
 * Termination reason type for agent execution.
 */
export type TerminationReason = 'ABORTED' | 'ERROR' | 'GOAL' | 'MAX_TURNS' | 'PROTOCOL_VIOLATION' | 'TIMEOUT'

/**
 * Agent execution context with enhanced state tracking.
 */
export interface AgentExecutionContext {
  currentIteration: number
  durationMs?: number
  endTime?: Date
  executionState: AgentExecutionState
  startTime?: Date
  terminationReason?: TerminationReason
  toolCallsExecuted: number
}

/**
 * Agent event subscriber interface.
 * Objects implementing this can be registered for event subscription.
 * Follows DextoAgent's AgentEventSubscriber pattern.
 */
export interface AgentEventSubscriber {
  /**
   * Subscribe to events on the agent event bus.
   * Called when the agent starts and after restart.
   */
  subscribe(eventBus: AgentEventBus): void

  /**
   * Optional cleanup method called when unsubscribing.
   */
  unsubscribe?(): void
}

// Re-export schema types for convenience
export type {
  AgentConfig,
  BlobStorageConfig,
  FileSystemConfig,
  LLMConfig,
  LLMUpdates,
  SessionConfig,
  ValidatedAgentConfig,
  ValidatedBlobStorageConfig,
  ValidatedFileSystemConfig,
  ValidatedLLMConfig,
  ValidatedSessionConfig,
} from './agent-schemas.js'
