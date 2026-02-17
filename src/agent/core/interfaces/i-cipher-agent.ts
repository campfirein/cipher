import type {TerminationReason} from '../domain/agent/agent-state.js'
import type {SessionMetadata} from '../domain/storage/history-types.js'
import type {GenerateResponse, StreamingEvent, StreamOptions} from '../domain/streaming/types.js'
import type {ConversationMetadata} from '../domain/system-prompt/types.js'

/**
 * Execution context for the agent
 * Contains runtime information about how the agent is being executed
 */
export interface ExecutionContext {
  /** Clear conversation history before execution (RLM mode — prevents accumulation across calls) */
  clearHistory?: boolean

  /** Command type that initiated the execution (for command-specific prompt loading) */
  commandType?: 'chat' | 'curate' | 'query'

  /** Metadata about the conversation (for JSON input mode) */
  conversationMetadata?: ConversationMetadata

  /** File reference instructions for agent to read files (for curate command with --files flag) */
  fileReferenceInstructions?: string

  /** Whether running in JSON input mode (headless with conversation history) */
  isJsonInputMode?: boolean

  /** Override maxIterations for this execution (e.g., 2 for queries with pre-fetched context) */
  maxIterations?: number

  /** Override maxTokens for this execution (e.g., 1024 for queries) */
  maxTokens?: number

  /** Override temperature for this execution (e.g., 0.3 for factual queries) */
  temperature?: number
}

/**
 * Agent execution state (string union for external consumers).
 */
export type AgentExecutionState = 'aborted' | 'complete' | 'error' | 'executing' | 'idle' | 'tool_calling'

/**
 * Agent state information.
 *
 * Enhanced to include execution state, termination reason, timing,
 * and tool metrics. Maintains backward compatibility with legacy fields.
 */
export interface AgentState {
  /** Current iteration/turn count */
  currentIteration: number

  /** Execution duration in milliseconds (if available) */
  durationMs?: number

  /** End time of execution (if complete) */
  endTime?: Date

  /** Legacy: execution history records */
  executionHistory: string[]

  /** Current execution state */
  executionState: AgentExecutionState

  /** Start time of execution (if started) */
  startTime?: Date

  /** Why the execution terminated (if complete) */
  terminationReason?: TerminationReason

  /** Number of tool calls executed */
  toolCallsExecuted: number
}

/**
 * Interface for the CipherAgent
 * Provides an agentic execution layer on top of the LLM service
 */
export interface ICipherAgent {
  /**
   * Cancels the currently running turn for the agent's default session.
   * Safe to call even if no run is in progress.
   *
   * @returns true if a run was in progress and was signaled to abort; false otherwise
   */
  cancel(): Promise<boolean>

  /**
   * Delete a session completely (memory + history)
   * @param sessionId - Session ID to delete
   * @returns True if session existed and was deleted
   */
  deleteSession(sessionId: string): Promise<boolean>

  /**
   * Execute the agent with user input.
   * Uses the agent's default session (created during start()).
   *
   * @param input - User input string
   * @param options - Optional execution options
   * @param options.executionContext - Optional context for command-specific behavior (curate/query/chat)
   * @param options.taskId - Optional task ID for event routing (required for concurrent task isolation)
   * @returns Agent response
   */
  execute(
    input: string,
    options?: {executionContext?: ExecutionContext; taskId?: string},
  ): Promise<string>

  /**
   * Generate a complete response (waits for full completion).
   * Wrapper around stream() that collects all events and returns final result.
   * Uses the agent's default session (created during start()).
   *
   * @param input - User message
   * @param options - Optional configuration (signal for cancellation, taskId for billing)
   * @returns Complete response with content, usage, and tool calls
   */
  generate(input: string, options?: StreamOptions): Promise<GenerateResponse>

  /**
   * Get session metadata without loading full history
   * @param sessionId - Session ID
   * @returns Session metadata or undefined if not found
   */
  getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined>

  /**
   * Get current agent state
   * @returns Current state information
   */
  getState(): AgentState

  /**
   * List all persisted session IDs from history storage
   * @returns Array of session IDs
   */
  listPersistedSessions(): Promise<string[]>

  /**
   * Reset the agent to initial state
   * Clears execution history and resets iteration counter
   */
  reset(): void

  /**
   * Start the agent - initializes all services asynchronously
   * Must be called before execute()
   */
  start(): Promise<void>

  /**
   * Stream a response (yields events as they arrive).
   * This is the recommended method for real-time streaming UI updates.
   * Uses the agent's default session (created during start()).
   *
   * @param input - User message
   * @param options - Optional configuration (signal for cancellation, taskId for billing)
   * @returns AsyncIterator that yields StreamingEvent objects
   */
  stream(input: string, options?: StreamOptions): Promise<AsyncIterableIterator<StreamingEvent>>
}
