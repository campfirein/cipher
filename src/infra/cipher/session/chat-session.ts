import type {Message} from '../../../core/domain/cipher/session/types.js'
import type {CipherAgentServices, SessionServices} from '../../../core/interfaces/cipher/cipher-services.js'
import type {IChatSession} from '../../../core/interfaces/cipher/i-chat-session.js'
import type {ExecutionContext} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {ILLMService} from '../../../core/interfaces/cipher/i-llm-service.js'

import {LLMError, SessionCancelledError} from '../../../core/domain/cipher/errors/session-error.js'
import {SessionEventBus} from '../events/event-emitter.js'

// List of all session events that should be forwarded to agent bus
const SESSION_EVENT_NAMES: readonly [
  'llmservice:thinking',
  'llmservice:chunk',
  'llmservice:response',
  'llmservice:toolCall',
  'llmservice:toolResult',
  'llmservice:error',
  'llmservice:unsupportedInput',
] = [
  'llmservice:thinking',
  'llmservice:chunk',
  'llmservice:response',
  'llmservice:toolCall',
  'llmservice:toolResult',
  'llmservice:error',
  'llmservice:unsupportedInput',
]

/**
 * Chat session implementation.
 *
 * Following Dexto's pattern: ChatSession owns session-specific services
 * (LLM, EventBus) and receives shared services (ToolManager, SystemPromptManager).
 *
 * The LLM service handles:
 * - Message history (via ContextManager)
 * - Agentic loop
 * - Tool execution
 *
 * This session provides:
 * - Session isolation
 * - Cancellation support
 * - Event forwarding to agent bus
 * - Proper cleanup/disposal
 */
export class ChatSession implements IChatSession {
  public readonly eventBus: SessionEventBus
  public readonly id: string
  private currentController?: AbortController
  private readonly forwarders = new Map<string, (payload?: unknown) => void>()
  private readonly llmService: ILLMService
  private readonly sharedServices: CipherAgentServices

  /**
   * Creates a new chat session
   *
   * @param id - Unique session identifier
   * @param sharedServices - Shared services from CipherAgent
   * @param sessionServices - Session-specific services (LLM, EventBus)
   */
  public constructor(id: string, sharedServices: CipherAgentServices, sessionServices: SessionServices) {
    this.id = id
    this.sharedServices = sharedServices
    this.eventBus = sessionServices.sessionEventBus
    this.llmService = sessionServices.llmService

    // Setup event forwarding from session bus to agent bus
    this.setupEventForwarding()
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
   * Dispose of the session and clean up resources.
   * Removes event listeners to prevent memory leaks.
   */
  public dispose(): void {
    // Remove all event forwarders
    for (const [eventName, forwarder] of this.forwarders.entries()) {
      this.eventBus.off(eventName as keyof typeof this.eventBus, forwarder)
    }

    this.forwarders.clear()
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
   * Get the LLM service for direct access to context manager.
   * Useful for pre-loading conversation history in JSON input mode.
   */
  public getLLMService(): ILLMService {
    return this.llmService
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

    // Emit conversation reset event
    this.sharedServices.agentEventBus.emit('cipher:conversationReset', {
      sessionId: this.id,
    })
  }

  /**
   * Send a message and get a response.
   * Delegates to the LLM service which handles the agentic loop.
   */
  public async run(
    input: string,
    options?: {executionContext?: ExecutionContext},
  ): Promise<string> {
    // Create abort controller for cancellation
    this.currentController = new AbortController()

    try {
      // Delegate to service - it handles everything
      const response = await this.llmService.completeTask(input, this.id, {
        executionContext: options?.executionContext,
        signal: this.currentController.signal,
      })

      return response
    } catch (error) {
      // Check if cancelled
      if (this.currentController.signal.aborted) {
        throw new SessionCancelledError(this.id)
      }

      // Wrap other errors - pass message as-is since it's already formatted
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new LLMError(errorMessage, this.id)
    } finally {
      this.currentController = undefined
    }
  }

  /**
   * Setup automatic event forwarding from SessionEventBus to AgentEventBus.
   * All session events are forwarded with sessionId added to the payload.
   *
   * Following Dexto's pattern: event forwarding is built into the session.
   */
  private setupEventForwarding(): void {
    for (const eventName of SESSION_EVENT_NAMES) {
      const forwarder = (payload?: unknown) => {
        // Add sessionId to payload
        const payloadWithSession =
          payload && typeof payload === 'object' ? {...(payload as object), sessionId: this.id} : {sessionId: this.id}

        // Forward to agent bus - eventName is properly typed from SESSION_EVENT_NAMES
        this.sharedServices.agentEventBus.emit(eventName, payloadWithSession)
      }

      // Track forwarder for cleanup
      this.forwarders.set(eventName, forwarder)

      // Register listener on session bus - eventName is properly typed from SESSION_EVENT_NAMES
      this.eventBus.on(eventName, forwarder)
    }
  }
}
