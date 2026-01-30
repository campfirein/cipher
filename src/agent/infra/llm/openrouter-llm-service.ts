import type {ChatCompletionMessageParam, ChatCompletionTool} from 'openai/resources'

import {OpenAI} from 'openai'

import type {JSONSchema7, ToolSet} from '../../core/domain/tools/types.js'
import type {ExecutionContext} from '../../core/interfaces/i-cipher-agent.js'
import type {IHistoryStorage} from '../../core/interfaces/i-history-storage.js'
import type {ILLMService} from '../../core/interfaces/i-llm-service.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {InternalMessage, ToolCall} from '../../core/interfaces/message-types.js'
import type {MemoryManager} from '../memory/memory-manager.js'
import type {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {getErrorMessage} from '../../../server/utils/error-helpers.js'
import {LlmGenerationError, LlmMaxIterationsError, LlmResponseParsingError} from '../../core/domain/errors/llm-error.js'
import {NoOpLogger} from '../../core/interfaces/i-logger.js'
import {SessionEventBus} from '../events/event-emitter.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {OpenRouterMessageFormatter} from './formatters/openrouter-formatter.js'
import {OpenRouterContentGenerator} from './generators/openrouter-content-generator.js'
import {createIdGenerator, StreamProcessor} from './stream-processor.js'
import {OpenRouterTokenizer} from './tokenizers/openrouter-tokenizer.js'
import {transformGenerateContentChunksToStreamEvents} from './transformers/openrouter-stream-transformer.js'

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
  private readonly contentGenerator: OpenRouterContentGenerator
  private readonly contextManager: ContextManager<ChatCompletionMessageParam>
  private readonly formatter: OpenRouterMessageFormatter
  private readonly logger: ILogger
  private readonly memoryManager?: MemoryManager
  private readonly sessionEventBus: SessionEventBus
  private readonly sessionId: string
  private readonly streamProcessor: StreamProcessor
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

    // Store sessionId for streaming context
    this.sessionId = sessionId

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

    // Initialize content generator for streaming support
    this.contentGenerator = new OpenRouterContentGenerator({
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      httpReferer: this.config.httpReferer,
      maxTokens: this.config.maxTokens,
      model: this.config.model,
      siteName: this.config.siteName,
      temperature: this.config.temperature,
      timeout: this.config.timeout,
    })

    // Initialize stream processor for handling streaming events
    this.streamProcessor = new StreamProcessor()

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
   * @param options.stream - Whether to stream response (emits llmservice:chunk events)
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
    // Extract options with defaults - include taskId for concurrent task isolation
    const {executionContext, fileData, imageData, signal, stream, taskId} = options ?? {}

    // Add user message to context
    await this.contextManager.addUserMessage(textInput, imageData, fileData)

    // Get filtered tools based on command type (e.g., only read-only tools for 'query')
    const toolSet = this.toolManager.getToolsForCommand(executionContext?.commandType)

    // Route to streaming or non-streaming execution
    if (stream) {
      return this.completeTaskStreaming(toolSet, executionContext, signal, taskId)
    }

    // Non-streaming path: Build tools array for OpenAI format
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
        const result = await this.executeAgenticIteration(iterationCount, tools, executionContext, taskId)

        if (result !== null) {
          return result
        }

        iterationCount++
      } catch (error) {
        this.handleLLMError(error, taskId)
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
   * Complete a task using streaming mode.
   *
   * Emits real-time llmservice:chunk events as tokens arrive.
   * Follows the OpenCode pattern of delta-based streaming.
   *
   * @param toolSet - Available tools for the task
   * @param executionContext - Optional execution context
   * @param signal - Optional abort signal for cancellation
   * @param taskId - Optional task ID for concurrent task isolation
   * @returns Final accumulated response
   */
  private async completeTaskStreaming(
    toolSet: ToolSet,
    executionContext: ExecutionContext | undefined,
    signal: AbortSignal | undefined,
    taskId: string | undefined,
  ): Promise<string> {
    let iterationCount = 0
    let finalResponse = ''

    // Streaming agentic loop
    while (iterationCount < this.config.maxIterations) {
      // Check if aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- Sequential iterations required for agentic loop
        const result = await this.executeAgenticIterationStreaming(
          iterationCount,
          toolSet,
          executionContext,
          taskId,
        )

        // If no tool calls, we're done - emit final response
        if (!result.hasToolCalls) {
          finalResponse = result.response

          // Emit response event
          this.sessionEventBus.emit('llmservice:response', {
            content: finalResponse,
            model: this.config.model,
            provider: 'openrouter',
            taskId: taskId || undefined,
          })

          // Add assistant message to context
          // eslint-disable-next-line no-await-in-loop -- Must complete before returning
          await this.contextManager.addAssistantMessage(finalResponse)

          return finalResponse
        }

        // Has tool calls - continue the loop
        iterationCount++
      } catch (error) {
        this.handleLLMError(error, taskId)
      }
    }

    // Max iterations exceeded
    throw new LlmMaxIterationsError(this.config.maxIterations, 'openrouter', this.config.model)
  }

  /**
   * Execute a single iteration of the agentic loop.
   *
   * @param iterationCount - Current iteration number
   * @param tools - Available tools for this iteration
   * @param executionContext - Optional execution context
   * @param taskId - Optional task ID for concurrent task isolation
   * @returns Final response string if complete, null if more iterations needed
   */
  private async executeAgenticIteration(
    iterationCount: number,
    tools: OpenAIToolDefinition[],
    executionContext: ExecutionContext | undefined,
    taskId?: string,
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

    // Emit thinking event with taskId for concurrent task isolation
    this.sessionEventBus.emit('llmservice:thinking', {taskId})

    // Call LLM and parse response
    const lastMessage = await this.callLLMAndParseResponse(tools, formattedMessages)

    // Check if there are tool calls
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return this.handleFinalResponse(lastMessage, taskId)
    }

    // Has tool calls - handle them
    await this.handleToolCalls(lastMessage, taskId)

    return null
  }

  /**
   * Execute a single iteration of the agentic loop with streaming.
   *
   * This method uses the ContentGenerator's streaming API to provide
   * real-time token-by-token output via the SessionEventBus.
   *
   * @param iterationCount - Current iteration number
   * @param toolSet - Available tools for this iteration
   * @param executionContext - Optional execution context
   * @param taskId - Optional task ID for concurrent task isolation
   * @returns Object with response text and whether tool calls were made
   */
  private async executeAgenticIterationStreaming(
    iterationCount: number,
    toolSet: ToolSet,
    executionContext: ExecutionContext | undefined,
    taskId?: string,
  ): Promise<{hasToolCalls: boolean; response: string}> {
    // Build system prompt using SystemPromptManager
    const availableTools = this.toolManager.getToolNamesForCommand(executionContext?.commandType)
    const markersSet = this.toolManager.getAvailableMarkers()

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

    // Get messages from context with compression
    const {tokensUsed} = await this.contextManager.getFormattedMessagesWithCompression(systemPrompt)

    if (this.config.verbose) {
      this.logger.debug('Streaming iteration', {
        iteration: `${iterationCount + 1}/${this.config.maxIterations}`,
        maxInputTokens: this.config.maxInputTokens,
        tokensUsed,
      })
    }

    // Emit thinking event
    this.sessionEventBus.emit('llmservice:thinking', {taskId})

    // Get internal messages for content generator
    const contents = this.contextManager.getMessages()

    // Generate streaming response using ContentGenerator
    const streamGenerator = this.contentGenerator.generateContentStream({
      config: {
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      },
      contents,
      executionContext,
      model: this.config.model,
      systemPrompt,
      taskId: taskId ?? `task-${Date.now()}`,
      tools: toolSet,
    })

    // Transform chunks to StreamEvents and process
    // Pass modelId for native reasoning extraction (OpenAI, Grok, Gemini)
    const streamEvents = transformGenerateContentChunksToStreamEvents(streamGenerator, {
      modelId: this.config.model,
      stepIndex: iterationCount,
    })

    // Process stream and accumulate state
    const generateId = createIdGenerator()
    const processorState = await this.streamProcessor.process(streamEvents, {
      eventBus: this.sessionEventBus,
      generateId,
      sessionId: this.sessionId,
      taskId,
    })

    // Extract accumulated text and tool calls
    const accumulatedText = processorState.textContent
    const toolParts = [...processorState.toolParts.values()]
    const hasToolCalls = toolParts.length > 0

    // If there are tool calls, extract and execute them
    if (hasToolCalls) {
      // Convert tool parts to ToolCall format
      const toolCalls: ToolCall[] = toolParts.map((part) => ({
        function: {
          arguments: JSON.stringify(part.state.status === 'pending' ? part.state.input : {}),
          name: part.toolName,
        },
        id: part.callId,
        type: 'function' as const,
      }))

      // Add assistant message with tool calls to context
      await this.contextManager.addAssistantMessage(accumulatedText, toolCalls)

      // Execute tool calls in parallel (matching internal service behavior)
      // This prevents long-running tools (e.g., subagent Tasks) from blocking others
      await Promise.allSettled(
        toolCalls.map((toolCall) => this.executeToolCall(toolCall, taskId)),
      )
    }

    return {
      hasToolCalls,
      response: accumulatedText,
    }
  }

  /**
   * Execute a single tool call.
   *
   * @param toolCall - Tool call to execute
   * @param taskId - Optional task ID for concurrent task isolation
   */
  private async executeToolCall(toolCall: ToolCall, taskId?: string): Promise<void> {
    try {
      const toolName = toolCall.function.name
      const toolArgs = JSON.parse(toolCall.function.arguments)

      // Emit tool call event with taskId for concurrent task isolation
      this.sessionEventBus.emit('llmservice:toolCall', {
        args: toolArgs,
        callId: toolCall.id,
        taskId: taskId || undefined,
        toolName,
      })

      // Execute tool via ToolManager (handles approval, routing, etc.)
      // Pass sessionId and taskId context for sub-agent event routing
      const result = await this.toolManager.executeTool(toolName, toolArgs, this.sessionId, {
        sessionId: this.sessionId,
        taskId,
      })

      // Extract content from ToolExecutionResult - the LLM needs the content string,
      // not the full result object (which would be JSON-stringified and confuse the model)
      const resultContent = result.content
      const isSuccess = result.success

      // Emit tool result event with taskId
      this.sessionEventBus.emit('llmservice:toolResult', {
        callId: toolCall.id,
        ...(isSuccess ? {result: resultContent} : {error: result.errorMessage ?? String(resultContent)}),
        errorType: result.errorType,
        success: isSuccess,
        taskId: taskId || undefined,
        toolName,
      })

      // Add tool result to context
      await this.contextManager.addToolResult(toolCall.id, toolName, resultContent, {
        errorType: result.errorType,
        success: isSuccess,
      })
    } catch (error) {
      // Add error result to context
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Emit tool result event (error) with taskId
      this.sessionEventBus.emit('llmservice:toolResult', {
        callId: toolCall.id,
        error: errorMessage,
        success: false,
        taskId: taskId || undefined,
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
   * @param taskId - Optional task ID for concurrent task isolation
   * @returns Final response content
   */
  private async handleFinalResponse(lastMessage: InternalMessage, taskId?: string): Promise<string> {
    const content = this.extractTextContent(lastMessage)

    // Emit response event with taskId for concurrent task isolation
    this.sessionEventBus.emit('llmservice:response', {
      content,
      model: this.config.model,
      provider: 'openrouter',
      taskId: taskId || undefined,
    })

    // Add assistant message to context
    await this.contextManager.addAssistantMessage(content)

    return content
  }

  /**
   * Handle LLM errors and re-throw or wrap appropriately.
   *
   * @param error - Error to handle
   * @param taskId - Optional task ID for concurrent task isolation
   */
  private handleLLMError(error: unknown, taskId?: string): never {
    // Emit error event with taskId for concurrent task isolation
    const errorMessage = error instanceof Error ? error.message : String(error)
    this.sessionEventBus.emit('llmservice:error', {
      error: errorMessage,
      taskId: taskId || undefined,
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
   * @param taskId - Optional task ID for concurrent task isolation
   */
  private async handleToolCalls(lastMessage: InternalMessage, taskId?: string): Promise<void> {
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return
    }

    // Has tool calls - add assistant message with tool calls
    const assistantContent = this.extractTextContent(lastMessage)
    await this.contextManager.addAssistantMessage(assistantContent, lastMessage.toolCalls)

    // Execute tool calls in parallel (matching internal service behavior)
    // This prevents long-running tools (e.g., subagent Tasks) from blocking others
    await Promise.allSettled(
      lastMessage.toolCalls.map((toolCall) => this.executeToolCall(toolCall, taskId)),
    )
  }
}
