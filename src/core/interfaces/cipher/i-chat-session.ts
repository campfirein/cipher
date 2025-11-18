import type {Message} from '../../domain/cipher/session/types.js'
import type {ILLMService} from './i-llm-service.js'

/**
 * Interface for a chat session.
 * Represents an isolated conversation context with message history.
 */
export interface IChatSession {
  /**
   * Cancel the current operation.
   * Aborts any ongoing LLM request.
   */
  cancel(): void

  /**
   * Dispose of the session and clean up resources.
   * Removes event listeners to prevent memory leaks.
   * Should be called when session is no longer needed.
   */
  dispose?(): void

  /**
   * Get the conversation history.
   *
   * @returns Array of messages in chronological order
   */
  getHistory(): Message[]

  /**
   * Get the LLM service for direct access to context manager.
   * Useful for pre-loading conversation history in JSON input mode.
   *
   * @returns The LLM service instance
   */
  getLLMService(): ILLMService

  /**
   * Get the number of messages in the conversation.
   *
   * @returns Message count
   */
  getMessageCount(): number

  /** Unique session identifier */
  readonly id: string

  /**
   * Reset the conversation history.
   * Clears all messages except the system prompt (if present).
   */
  reset(): void

  /**
   * Send a message and get a response.
   * Handles tool execution loop automatically.
   *
   * @param input - User message content
   * @param options - Optional execution options
   * @param options.mode - Optional mode for system prompt ('json-input' enables autonomous mode)
   * @returns Assistant response
   * @throws SessionCancelledError if operation is cancelled
   * @throws MaxIterationsExceededError if tool loop exceeds maximum iterations
   * @throws LLMError if LLM call fails
   */
  run(input: string, options?: {mode?: 'default' | 'json-input'}): Promise<string>
}