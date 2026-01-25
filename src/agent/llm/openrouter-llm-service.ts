import type {ChatCompletionMessageParam, ChatCompletionTool} from 'openai/resources'

import {OpenAI} from 'openai'

import type {JSONSchema7, ToolSet} from '../types/tools/types.js'
import type {ExecutionContext} from '../interfaces/i-cipher-agent.js'
import type {IHistoryStorage} from '../interfaces/i-history-storage.js'
import type {ILLMService} from '../interfaces/i-llm-service.js'
import type {ILogger} from '../interfaces/i-logger.js'
import type {InternalMessage, ToolCall} from '../interfaces/message-types.js'
import type {MemoryManager} from '../memory/memory-manager.js'
import type {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmResponseParsingError,
} from '../types/errors/llm-error.js'
import {NoOpLogger} from '../interfaces/i-logger.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {SessionEventBus} from '../events/event-emitter.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {OpenRouterMessageFormatter} from './formatters/openrouter-formatter.js'
import {OpenRouterTokenizer} from './tokenizers/openrouter-tokenizer.js'

/**
 * Configuration for OpenRouter LLM service
 */
export interface OpenRouterServiceConfig {
  apiKey: string
  baseUrl?: string
  httpReferer?: string
  maxInputTokens?: number
  maxIterations?: number
  maxTokens?: number
  model?: string
  siteName?: string
  temperature?: number
  timeout?: number
  verbose?: boolean
}

/**
 * LLM service configuration response
 */
export interface LLMServiceConfig {
  configuredMaxInputTokens: number
  model: string
  modelMaxInputTokens: number
  provider: string
  router: string
}

/**
 * OpenAI-compatible tool definition for function calling
 */
interface OpenAIToolDefinition {
  function: {
    description: string
    name: string
    parameters: JSONSchema7
  }
  type: 'function'
}

/**
 * OpenRouter LLM Service.
 *
 * Orchestrates the agentic loop for tool calling with OpenRouter.
 * OpenRouter provides access to multiple LLM providers through an OpenAI-compatible API.
 *
 * Responsibilities:
 * - Manage conversation context via ContextManager
 * - Execute agentic loop (call LLM → execute tools → repeat)
 * - Delegate tool execution to ToolManager
 * - Format messages for OpenRouter API via formatter
 * - Handle errors and iteration limits
 *
 * Does NOT:
 * - Execute tools directly (uses ToolManager)
 * - Store persistent history (uses in-memory ContextManager)
 */
export class OpenRouterLLMService implements ILLMService {
  private readonly client: OpenAI
  private readonly config: Required<
    Omit<OpenRouterServiceConfig, 'httpReferer' | 'siteName' | 'timeout' | 'verbose'>
  > & {
    httpReferer?: string
    siteName?: string
    timeout?: number
    verbose?: boolean
  }
  private readonly contextManager: ContextManager<ChatCompletionMessageParam>
  private readonly formatter: OpenRouterMessageFormatter
  private readonly logger: ILogger
  private readonly memoryManager?: MemoryManager
  private readonly sessionEventBus: SessionEventBus
  private readonly systemPromptManager: SystemPromptManager
  private readonly tokenizer: OpenRouterTokenizer
  private readonly toolManager: ToolManager

  /**
   * Creates a new OpenRouter LLM service
   *
   * @param sessionId - Unique session identifier
   * @param config - Service configuration
   * @param options - Service dependencies
   * @param options.toolManager - Tool manager for tool execution
   * @param options.systemPromptManager - Simple prompt factory for building system prompts
   * @param options.sessionEventBus - Session event bus for emitting events
   * @param options.memoryManager - Optional memory manager for agent memories
   * @param options.historyStorage - Optional history storage for persistence
   * @param options.logger - Optional logger for structured logging
   */
  public constructor(
    sessionId: string,
    config: OpenRouterServiceConfig,
    options: {
      historyStorage?: IHistoryStorage
      logger?: ILogger
      memoryManager?: MemoryManager
      sessionEventBus: SessionEventBus
      systemPromptManager: SystemPromptManager
      toolManager: ToolManager
    },
  ) {
    this.toolManager = options.toolManager
    this.systemPromptManager = options.systemPromptManager
    this.memoryManager = options.memoryManager
    this.sessionEventBus = options.sessionEventBus
    this.logger = options.logger ?? new NoOpLogger()
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      httpReferer: config.httpReferer,
      maxInputTokens: config.maxInputTokens ?? 200_000,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'anthropic/claude-haiku-4.5',
      siteName: config.siteName,
      temperature: config.temperature ?? 0.7,
      timeout: config.timeout,
      verbose: config.verbose,
    }

    // Initialize OpenAI client with OpenRouter base URL
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      defaultHeaders: {
        ...(this.config.httpReferer && {'HTTP-Referer': this.config.httpReferer}),
        ...(this.config.siteName && {'X-Title': this.config.siteName}),
      },
      timeout: this.config.timeout,
    })

    // Initialize formatter and tokenizer
    this.formatter = new OpenRouterMessageFormatter()
    this.tokenizer = new OpenRouterTokenizer()

    // Initialize context manager with optional history storage
    this.contextManager = new ContextManager({
      formatter: this.formatter,
      historyStorage: options.historyStorage,
      maxInputTokens: this.config.maxInputTokens,
      sessionId,
      tokenizer: this.tokenizer,
    })
  }

  /**
   * Complete a task with tool calling support.
   *
   * This is the main entry point for the agentic loop.
   * It handles:
   * 1. Adding user message to context
   * 2. Looping: call LLM → check for tool calls → execute tools
   * 3. Returning final response when no more tool calls
   *
   * @param textInput - User input text
   * @param options - Execution options
   * @param options.signal - Optional abort signal for cancellation
   * @param options.imageData - Optional image data
   * @param options.fileData - Optional file data
   * @param options.stream - Whether to stream response (not implemented yet)
   * @param options.executionContext - Optional execution context (for JSON input mode, etc.)
   * @param options.taskId - Task ID for billing tracking
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    options?: {
      executionContext?: ExecutionContext
      fileData?: FileData
      imageData?: ImageData
      signal?: AbortSignal
      stream?: boolean
      taskId?: string
    },
  ): Promise<string> {
    // Extract options with defaults
    const {executionContext, fileData, imageData, signal} = options ?? {}

    // Add user message to context
    await this.contextManager.addUserMessage(textInput, imageData, fileData)

    // Get filtered tools based on command type (e.g., only read-only tools for 'query')
    const toolSet = this.toolManager.getToolsForCommand(executionContext?.commandType)
    const tools = Object.entries(toolSet).map(([name, schema]) => ({
      function: {
        description: schema.description ?? '',
        name,
        parameters: schema.parameters,
      },
      type: 'function' as const,
    }))

    let iterationCount = 0

    // Agentic loop
    while (iterationCount < this.config.maxIterations) {
      // Check if aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- Sequential iterations required for agentic loop
        const result = await this.executeAgenticIteration(iterationCount, tools, executionContext)

        if (result !== null) {
          return result
        }

        iterationCount++
      } catch (error) {
        this.handleLLMError(error)
      }
    }

    // Max iterations exceeded
    throw new LlmMaxIterationsError(this.config.maxIterations, 'openrouter', this.config.model)
  }

  /**
   * Get all available tools from ToolManager.
   */
  public async getAllTools(): Promise<ToolSet> {
    return this.toolManager.getAllTools()
  }

  /**
   * Get service configuration.
   */
  public getConfig(): LLMServiceConfig {
    return {
      configuredMaxInputTokens: this.config.maxInputTokens,
      model: this.config.model,
      modelMaxInputTokens: this.config.maxInputTokens,
      provider: 'openrouter',
      router: 'openrouter',
    }
  }

  /**
   * Get the context manager instance.
   */
  public getContextManager(): ContextManager<unknown> {
    return this.contextManager
  }

  /**
   * Initialize the LLM service by loading persisted history.
   * Should be called after construction to restore previous conversation.
   *
   * @returns True if history was loaded, false otherwise
   */
  public async initialize(): Promise<boolean> {
    return this.contextManager.initialize()
  }

  /**
   * Call LLM and parse the response.
   *
   * @param tools - Available tools for function calling
   * @param formattedMessages - Formatted messages to send
   * @returns Parsed message from LLM response
   */
  private async callLLMAndParseResponse(
    tools: OpenAIToolDefinition[],
    formattedMessages: ChatCompletionMessageParam[],
  ): Promise<InternalMessage> {
    // Call OpenRouter API via OpenAI client
    const response = await this.client.chat.completions.create({
      // eslint-disable-next-line camelcase
      max_tokens: this.config.maxTokens,
      messages: formattedMessages,
      model: this.config.model,
      temperature: this.config.temperature,
      ...(tools.length > 0 && {tools: tools as unknown as ChatCompletionTool[]}),
    })

    // Parse response to internal format
    const messages = this.formatter.parseResponse(response)
    if (messages.length === 0) {
      throw new LlmResponseParsingError('No messages returned from formatter', 'openrouter', this.config.model)
    }

    const lastMessage = messages.at(-1)
    if (!lastMessage) {
      throw new LlmResponseParsingError('Failed to get last message from response', 'openrouter', this.config.model)
    }

    return lastMessage
  }

  /**
   * Execute a single iteration of the agentic loop.
   *
   * @param iterationCount - Current iteration number
   * @param tools - Available tools for this iteration
   * @param executionContext - Optional execution context
   * @returns Final response string if complete, null if more iterations needed
   */
  private async executeAgenticIteration(
    iterationCount: number,
    tools: OpenAIToolDefinition[],
    executionContext: ExecutionContext | undefined,
  ): Promise<null | string> {
    // Build system prompt using SystemPromptManager (before compression for correct token accounting)
    // Use filtered tool names based on command type (e.g., only read-only tools for 'query')
    const availableTools = this.toolManager.getToolNamesForCommand(executionContext?.commandType)
    const markersSet = this.toolManager.getAvailableMarkers()

    // Convert Set<string> to Record<string, string> for SystemPromptManager
    const availableMarkers: Record<string, string> = {}
    for (const marker of markersSet) {
      availableMarkers[marker] = marker
    }

    const systemPrompt = await this.systemPromptManager.build({
      availableMarkers,
      availableTools,
      commandType: executionContext?.commandType,
      conversationMetadata: executionContext?.conversationMetadata,
      memoryManager: this.memoryManager,
    })

    // Verbose debug: Show complete system prompt
    if (this.config.verbose) {
      this.logger.debug('System prompt details', {
        first500Chars: systemPrompt.slice(0, 500),
        iteration: iterationCount + 1,
        last500Chars: systemPrompt.slice(-500),
        length: systemPrompt.length,
        lines: systemPrompt.split('\n').length,
      })
    }

    // Get formatted messages from context with compression (passing system prompt for token accounting)
    const {formattedMessages, tokensUsed} = await this.contextManager.getFormattedMessagesWithCompression(systemPrompt)

    // Verbose: Log formatted messages and token usage
    if (this.config.verbose) {
      this.logger.debug('Formatted messages for LLM', {
        formattedMessages,
        iteration: `${iterationCount + 1}/${this.config.maxIterations}`,
        maxInputTokens: this.config.maxInputTokens,
        tokensUsed,
      })
    }

    // Emit thinking event
    this.sessionEventBus.emit('llmservice:thinking')

    // Call LLM and parse response
    const lastMessage = await this.callLLMAndParseResponse(tools, formattedMessages)

    // Check if there are tool calls
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return this.handleFinalResponse(lastMessage)
    }

    // Has tool calls - handle them
    await this.handleToolCalls(lastMessage)

    return null
  }

  /**
   * Execute a single tool call.
   *
   * @param toolCall - Tool call to execute
   */
  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    try {
      const toolName = toolCall.function.name
      const toolArgs = JSON.parse(toolCall.function.arguments)

      // Emit tool call event
      this.sessionEventBus.emit('llmservice:toolCall', {
        args: toolArgs,
        callId: toolCall.id,
        toolName,
      })

      // Execute tool via ToolManager (handles approval, routing, etc.)
      const result = await this.toolManager.executeTool(toolName, toolArgs)

      // Emit tool result event (success)
      this.sessionEventBus.emit('llmservice:toolResult', {
        callId: toolCall.id,
        result,
        success: true,
        toolName,
      })

      // Add tool result to context
      await this.contextManager.addToolResult(toolCall.id, toolName, result, {success: true})
    } catch (error) {
      // Add error result to context
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Emit tool result event (error)
      this.sessionEventBus.emit('llmservice:toolResult', {
        callId: toolCall.id,
        error: errorMessage,
        success: false,
        toolName: toolCall.function.name,
      })

      await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, `Error: ${errorMessage}`, {
        success: false,
      })
    }
  }

  /**
   * Extract text content from an internal message.
   *
   * @param message - Internal message
   * @returns Text content as string
   */
  private extractTextContent(message: InternalMessage): string {
    if (typeof message.content === 'string') {
      return message.content
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => part.type === 'text')
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
    }

    return ''
  }

  /**
   * Handle final response when there are no tool calls.
   *
   * @param lastMessage - Last message from LLM
   * @returns Final response content
   */
  private async handleFinalResponse(lastMessage: InternalMessage): Promise<string> {
    const content = this.extractTextContent(lastMessage)

    // Emit response event
    this.sessionEventBus.emit('llmservice:response', {
      content,
      model: this.config.model,
      provider: 'openrouter',
    })

    // Add assistant message to context
    await this.contextManager.addAssistantMessage(content)

    return content
  }

  /**
   * Handle LLM errors and re-throw or wrap appropriately.
   *
   * @param error - Error to handle
   */
  private handleLLMError(error: unknown): never {
    // Emit error event
    const errorMessage = error instanceof Error ? error.message : String(error)
    this.sessionEventBus.emit('llmservice:error', {
      error: errorMessage,
    })

    // Re-throw LLM errors as-is
    if (
      error instanceof LlmResponseParsingError ||
      error instanceof LlmGenerationError ||
      error instanceof LlmMaxIterationsError
    ) {
      throw error
    }

    // Wrap other errors
    if (error && typeof error === 'object' && 'message' in error) {
      throw new LlmGenerationError(getErrorMessage(error), 'openrouter', this.config.model)
    }

    throw new LlmGenerationError(String(error), 'openrouter', this.config.model)
  }

  /**
   * Handle tool calls from LLM response.
   *
   * @param lastMessage - Last message containing tool calls
   */
  private async handleToolCalls(lastMessage: InternalMessage): Promise<void> {
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return
    }

    // Has tool calls - add assistant message with tool calls
    const assistantContent = this.extractTextContent(lastMessage)
    await this.contextManager.addAssistantMessage(assistantContent, lastMessage.toolCalls)

    // Execute tool calls via ToolManager
    for (const toolCall of lastMessage.toolCalls) {
      // eslint-disable-next-line no-await-in-loop -- Sequential tool execution required
      await this.executeToolCall(toolCall)
    }
  }
}
