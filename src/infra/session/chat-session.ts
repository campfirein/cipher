import type {Message} from '../../core/domain/session/types.js'
import type {IChatSession} from '../../core/interfaces/i-chat-session.js'
import type {ILLMService} from '../../core/interfaces/i-llm-service.js'

import {LLMError, SessionCancelledError} from '../../core/domain/errors/session-error.js'

/**
 * Chat session implementation.
 *
 * Simplified session that delegates to the LLM service.
 * The service handles:
 * - Message history (via ContextManager)
 * - Agentic loop
 * - Tool execution
 *
 * This session provides:
 * - Session isolation
 * - Cancellation support
 * - Simple interface for the application layer
 */
export class ChatSession implements IChatSession {
  public readonly id: string
  private currentController?: AbortController
  private readonly llmService: ILLMService

  /**
   * Creates a new chat session
   *
   * @param id - Unique session identifier
   * @param llmService - LLM service for generating responses
   */
  public constructor(id: string, llmService: ILLMService) {
    this.id = id
    this.llmService = llmService
  }

  /**
   * Cancel the current operation.
   */
  public cancel(): void {
    if (this.currentController) {
      this.currentController.abort()
    }
  }

  /**
   * Get the conversation history.
   */
  public getHistory(): Message[] {
    // Get history from service's context manager
    const contextManager = this.llmService.getContextManager()
    const internalMessages = contextManager.getMessages()

    // Convert to session Message format
    return internalMessages.map((msg) => ({
      content: typeof msg.content === 'string' ? msg.content : '',
      role: msg.role,
      timestamp: Date.now(), // Internal messages don't have timestamps
      toolCallId: msg.toolCallId,
      toolCalls: msg.toolCalls?.map((tc) => ({
        arguments: JSON.parse(tc.function.arguments),
        id: tc.id,
        name: tc.function.name,
      })),
      toolName: msg.name,
    }))
  }

  /**
   * Get the number of messages in the conversation.
   */
  public getMessageCount(): number {
    const contextManager = this.llmService.getContextManager()
    return contextManager.getMessages().length
  }

  /**
   * Reset the conversation history.
   */
  public reset(): void {
    const contextManager = this.llmService.getContextManager()
    contextManager.clearHistory()
  }

  /**
   * Send a message and get a response.
   * Delegates to the LLM service which handles the agentic loop.
   */
  public async run(input: string): Promise<string> {
    // Create abort controller for cancellation
    this.currentController = new AbortController()

    try {
      // Delegate to service - it handles everything
      const response = await this.llmService.completeTask(input, {
        signal: this.currentController.signal,
      })

      return response
    } catch (error) {
      // Check if cancelled
      if (this.currentController.signal.aborted) {
        throw new SessionCancelledError(this.id)
      }

      // Wrap other errors
      throw new LLMError((error as Error).message, this.id)
    } finally {
      this.currentController = undefined
    }
  }
}
