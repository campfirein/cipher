import type {SessionMetadata} from '../../domain/cipher/storage/history-types.js'
import type {ConversationMetadata} from '../../domain/cipher/system-prompt/types.js'

/**
 * Execution context for the agent
 * Contains runtime information about how the agent is being executed
 */
export interface ExecutionContext {
  /** Metadata about the conversation (for JSON input mode) */
  conversationMetadata?: ConversationMetadata

  /** Whether running in JSON input mode (headless with conversation history) */
  isJsonInputMode?: boolean
}

/**
 * Agent state information
 */
export interface AgentState {
  currentIteration: number
  executionHistory: string[]
}

/**
 * Interface for the CipherAgent
 * Provides an agentic execution layer on top of the LLM service
 */
export interface ICipherAgent {
  /**
   * Delete a session completely (memory + history)
   * @param sessionId - Session ID to delete
   * @returns True if session existed and was deleted
   */
  deleteSession(sessionId: string): Promise<boolean>

  /**
   * Execute the agent with user input
   * @param input - User input string
   * @param sessionId - Optional session ID
   * @returns Agent response
   */
  execute(input: string, sessionId?: string): Promise<string>

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
}
