// @ts-expect-error - Internal SDK path not exported in package.json, but exists and works at runtime
import type {RequestOptions} from '@anthropic-ai/sdk/internal/request-options'
import type {
  Tool as ClaudeTool,
  MessageCreateParamsNonStreaming,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages'
import type {Content, GenerateContentConfig} from '@google/genai'

import type {ToolExecutionResult} from '../../../core/domain/cipher/tools/tool-error.js'
import type {JSONSchema7, ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {ExecutionContext} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {IHistoryStorage} from '../../../core/interfaces/cipher/i-history-storage.js'
import type {ILLMService} from '../../../core/interfaces/cipher/i-llm-service.js'
import type {ILogger} from '../../../core/interfaces/cipher/i-logger.js'
import type {IMessageFormatter} from '../../../core/interfaces/cipher/i-message-formatter.js'
import type {ITokenizer} from '../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage, ToolCall} from '../../../core/interfaces/cipher/message-types.js'
import type {MemoryManager} from '../memory/memory-manager.js'
import type {SimplePromptFactory} from '../system-prompt/simple-prompt-factory.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmResponseParsingError,
} from '../../../core/domain/cipher/errors/llm-error.js'
import {NoOpLogger} from '../../../core/interfaces/cipher/i-logger.js'
import {SessionEventBus} from '../events/event-emitter.js'
import {ByteRoverLlmGrpcService} from '../grpc/internal-llm-grpc-service.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {ClaudeMessageFormatter} from './formatters/claude-formatter.js'
import {GeminiMessageFormatter} from './formatters/gemini-formatter.js'
import {
  DEFAULT_RETRY_CONFIG,
  type ResponseValidationError,
  ResponseValidator,
  type RetryConfig,
  RetryHelper,
} from './response-validator.js'
import {type ThinkingConfig, ThinkingConfigManager, ThoughtParser} from './thought-parser.js'
import {ClaudeTokenizer} from './tokenizers/claude-tokenizer.js'
import {GeminiTokenizer} from './tokenizers/gemini-tokenizer.js'
import {ToolOutputProcessor, type TruncationConfig} from './tool-output-processor.js'

/**
 * Configuration for ByteRover LLM service (using gRPC)
 */
export interface ByteRoverLLMServiceConfig {
  maxInputTokens?: number
  maxIterations?: number
  maxTokens?: number
  model: string
  temperature?: number
  /**
   * Thinking configuration for Gemini models (optional).
   * If not provided, will be auto-configured based on model version.
   */
  thinkingConfig?: ThinkingConfig
  timeout?: number
  /**
   * Truncation configuration for tool outputs (optional).
   * If not provided, will use default truncation settings.
   */
  truncationConfig?: TruncationConfig
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
 * Simplified tool definition for function declarations
 */
interface ToolDefinition {
  description: string
  name: string
  parameters: JSONSchema7
}

/**
 * ByteRover LLM Service.
 *
 * Orchestrates the agentic loop using ByteRover gRPC provider.
 * Responsibilities:
 * - Manage conversation context via ContextManager
 * - Execute agentic loop (call LLM → execute tools → repeat)
 * - Delegate tool execution to ToolManager
 * - Format messages for ByteRover gRPC API via formatter (Gemini or Claude)
 * - Handle errors and iteration limits
 *
 * Does NOT:
 * - Execute tools directly (uses ToolManager)
 * - Store persistent history (uses in-memory ContextManager)
 * - Initialize the gRPC provider (injected as dependency)
 */
export class ByteRoverLLMService implements ILLMService {
  private readonly config: {
    maxInputTokens: number
    maxIterations: number
    maxTokens: number
    model: string
    temperature: number
    thinkingConfig?: ThinkingConfig
    timeout?: number
    verbose: boolean
  }
  private readonly contextManager: ContextManager<Content | MessageParam>
  private readonly formatter: IMessageFormatter<Content | MessageParam>
  private readonly logger: ILogger
  private readonly memoryManager?: MemoryManager
  private readonly outputProcessor: ToolOutputProcessor
  private readonly promptFactory: SimplePromptFactory
  private readonly provider: ByteRoverLlmGrpcService
  private readonly providerType: 'claude' | 'gemini'
  private readonly sessionEventBus: SessionEventBus
  private readonly tokenizer: ITokenizer
  private readonly toolManager: ToolManager

  /**
   * Initialize a new ByteRover LLM service instance.
   *
   * Sets up the service with all required dependencies and initializes:
   * - Context manager for conversation history
   * - Message formatter (Gemini or Claude format based on model)
   * - Token counter/tokenizer for the selected model
   * - Configuration with sensible defaults
   *
   * Each service instance maintains isolated conversation context,
   * allowing multiple concurrent sessions with separate histories.
   *
   * @param sessionId - Unique identifier for this session
   * @param provider - Configured gRPC provider for LLM API calls
   * @param config - LLM service configuration (model, tokens, temperature)
   * @param options - Service dependencies
   * @param options.toolManager - Tool manager for executing agent tools
   * @param options.promptFactory - Simple prompt factory for building system prompts
   * @param options.memoryManager - Memory manager for agent memories
   * @param options.sessionEventBus - Event bus for session lifecycle events
   * @param options.historyStorage - Optional history storage for persistence
   * @param options.logger - Optional logger for structured logging
   */
  public constructor(
    sessionId: string,
    provider: ByteRoverLlmGrpcService,
    config: ByteRoverLLMServiceConfig,
    options: {
      historyStorage?: IHistoryStorage
      logger?: ILogger
      memoryManager?: MemoryManager
      promptFactory: SimplePromptFactory
      sessionEventBus: SessionEventBus
      toolManager: ToolManager
    },
  ) {
    this.provider = provider
    this.toolManager = options.toolManager
    this.promptFactory = options.promptFactory
    this.memoryManager = options.memoryManager
    this.sessionEventBus = options.sessionEventBus
    this.logger = options.logger ?? new NoOpLogger()
    this.outputProcessor = new ToolOutputProcessor(config.truncationConfig)
    this.config = {
      maxInputTokens: config.maxInputTokens ?? 1_000_000,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'claude-haiku-4-5@20251001',
      temperature: config.temperature ?? 0.7,
      thinkingConfig: config.thinkingConfig,
      timeout: config.timeout,
      verbose: config.verbose ?? false,
    }

    // Detect provider type from model name
    this.providerType = this.detectProviderType(this.config.model)

    // Initialize formatter and tokenizer based on provider type
    if (this.providerType === 'claude') {
      this.formatter = new ClaudeMessageFormatter()
      this.tokenizer = new ClaudeTokenizer(this.config.model)
    } else {
      this.formatter = new GeminiMessageFormatter()
      this.tokenizer = new GeminiTokenizer(this.config.model)
    }

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
   * @param options.executionContext - Optional execution context
   * @param options.signal - Optional abort signal for cancellation
   * @param options.imageData - Optional image data
   * @param options.fileData - Optional file data
   * @param options.stream - Whether to stream response (not implemented yet)
   * @param options.mode - Optional mode for system prompt ('autonomous' enables autonomous mode)
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    options?: {
      executionContext?: ExecutionContext
      fileData?: FileData
      imageData?: ImageData
      mode?: 'autonomous' | 'default' | 'query'
      signal?: AbortSignal
      stream?: boolean
    },
  ): Promise<string> {
    // Extract options with defaults
    const {executionContext, fileData, imageData, mode, signal} = options ?? {}

    // Add user message to context
    await this.contextManager.addUserMessage(textInput, imageData, fileData)

    // Get all available tools
    const toolSet = this.toolManager.getAllTools()
    const tools = Object.entries(toolSet).map(([name, schema]) => ({
      description: schema.description ?? '',
      name,
      parameters: schema.parameters,
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
        const result = await this.executeAgenticIteration(iterationCount, tools, mode, executionContext)

        if (result !== null) {
          return result
        }

        iterationCount++
      } catch (error) {
        this.handleLLMError(error)
      }
    }

    // Max iterations exceeded - emit warning and return partial response
    this.logger.warn('Reached maximum iterations without completion', {
      maxIterations: this.config.maxIterations,
    })

    this.sessionEventBus.emit('llmservice:warning', {
      message: `Maximum iterations (${this.config.maxIterations}) reached without completion`,
      model: this.config.model,
      provider: 'byterover',
    })

    // Get accumulated response from context
    const partialResponse = await this.getPartialResponse()

    this.sessionEventBus.emit('llmservice:response', {
      content: partialResponse,
      model: this.config.model,
      partial: true,
      provider: 'byterover',
    })

    return (
      partialResponse ||
      'Maximum iterations reached without completing the task. Please try breaking down the task into smaller steps.'
    )
  }

  /**
   * Get all available tools for the agent.
   *
   * Retrieves the current set of tools that can be used during task execution.
   * These tools are passed to the LLM to enable function calling capabilities.
   *
   * @returns Promise resolving to a map of tool names to their schemas
   */
  public async getAllTools(): Promise<ToolSet> {
    return this.toolManager.getAllTools()
  }

  /**
   * Get the service's runtime configuration.
   *
   * Returns metadata about the service including:
   * - Configured and model-specific token limits
   * - Selected LLM model
   * - Provider name (always 'byterover')
   * - Router type (always 'in-built')
   *
   * This is useful for introspecting service capabilities and limits
   * without needing access to the internal config object.
   *
   * @returns Service configuration object with model info and constraints
   */
  public getConfig(): LLMServiceConfig {
    return {
      configuredMaxInputTokens: this.config.maxInputTokens,
      model: this.config.model,
      modelMaxInputTokens: this.config.maxInputTokens,
      provider: 'byterover',
      router: 'in-built',
    }
  }

  /**
   * Get access to the conversation context manager.
   *
   * Provides access to the ContextManager instance that maintains:
   * - Conversation history (messages and responses)
   * - Token counting and compression
   * - Message formatting for the selected model
   *
   * Useful for:
   * - Inspecting conversation state
   * - Retrieving formatted messages
   * - Managing context during multi-turn interactions
   *
   * @returns The ContextManager instance managing conversation state
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
   * Build Claude-specific generation configuration.
   *
   * For Claude, the config includes BOTH messages and generation parameters
   * since Claude's SDK expects everything in the first parameter (MessageCreateParams).
   *
   * @param tools - Available tool definitions
   * @param systemPrompt - System prompt (passed in config.system)
   * @param messages - Formatted messages (included in config for Claude)
   * @returns Complete Claude API request body (MessageCreateParamsNonStreaming)
   */
  private buildClaudeConfig(
    tools: ToolDefinition[],
    systemPrompt: string,
    messages: MessageParam[],
  ): MessageCreateParamsNonStreaming {
    /* eslint-disable camelcase */
    const claudeTools: ClaudeTool[] = tools.map((tool) => ({
      input_schema: tool.parameters as ClaudeTool.InputSchema,
      name: tool.name,
      ...(tool.description && {description: tool.description}),
    }))

    return {
      max_tokens: this.config.maxTokens,
      messages, // Messages array is part of the config for Claude
      model: this.config.model, // Model is also part of the body
      system: systemPrompt,
      temperature: this.config.temperature,
      ...(claudeTools.length > 0 && {tools: claudeTools}),
    }
    /* eslint-enable camelcase */
  }

  /**
   * Build Gemini-specific generation configuration with thinking support.
   *
   * @param tools - Available tool definitions
   * @param systemPrompt - System prompt (passed in systemInstruction)
   * @returns Gemini API configuration object
   */
  private buildGeminiConfig(tools: ToolDefinition[], systemPrompt: string): GenerateContentConfig {
    const baseConfig: GenerateContentConfig = {
      maxOutputTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      topP: 1,
      ...(systemPrompt && {systemInstruction: {parts: [{text: systemPrompt}]}}),
      ...(tools.length > 0 && {
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              description: tool.description,
              name: tool.name,
              parameters: tool.parameters as Record<string, unknown>,
            })),
          },
        ],
      }),
    }

    // Add thinking configuration for Gemini models
    if (this.providerType === 'gemini') {
      // Get thinking config (user-provided or auto-configured based on model)
      const thinkingConfig = ThinkingConfigManager.mergeConfig(this.config.model, this.config.thinkingConfig)

      if (thinkingConfig) {
        baseConfig.thinkingConfig = thinkingConfig as Record<string, unknown>
      }
    }

    return baseConfig
  }

  /**
   * Build the generation configuration for the ByteRover gRPC API call.
   *
   * Constructs the complete generation parameters including:
   * - Output token limit (from config)
   * - Temperature/sampling parameters
   * - System instruction from the prompt manager
   * - Available tools for function calling
   *
   * For Claude: messages are included in the config (merged into body)
   * For Gemini: messages are passed separately
   *
   * This configuration is passed to the provider and controls how the LLM
   * generates responses. It bridges between service configuration and
   * the provider's expected format.
   *
   * @param tools - List of tool definitions available to the LLM
   * @param systemPrompt - System prompt text to guide LLM behavior
   * @param messages - Formatted messages (for Claude, these are merged into config)
   * @returns Complete generation configuration for gRPC API (Gemini or Claude format)
   */
  private buildGenerationConfig(
    tools: ToolDefinition[],
    systemPrompt: string,
    messages: Content[] | MessageParam[],
  ): GenerateContentConfig | MessageCreateParamsNonStreaming {
    if (this.providerType === 'claude') {
      return this.buildClaudeConfig(tools, systemPrompt, messages as MessageParam[])
    }

    return this.buildGeminiConfig(tools, systemPrompt)
  }

  /**
   * Call LLM and parse the response with validation and retry logic.
   *
   * Implements:
   * - Response validation (checks structure, content, tool calls)
   * - Automatic retry on validation failures
   * - Exponential backoff between retries
   * - Temperature adjustment for retries
   *
   * Parameter structure differs by provider:
   * - Gemini: contents = formattedMessages, config = genConfig
   * - Claude: contents = genConfig (complete body), config = {} (empty RequestOptions)
   *
   * @param genConfig - For Gemini: GenerateContentConfig. For Claude: MessageCreateParamsNonStreaming (complete body)
   * @param formattedMessages - Formatted messages (only used for Gemini; Claude has messages in genConfig)
   * @returns Last validated message from parsed response
   */
  private async callLLMAndParseResponse(
    genConfig: GenerateContentConfig | MessageCreateParamsNonStreaming,
    formattedMessages: Content[] | MessageParam[],
  ): Promise<InternalMessage> {
    const retryConfig: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      maxAttempts: 2, // Try once, retry once
    }

    let lastError: Error | null = null
    let currentConfig = genConfig

    for (let attempt = 0; attempt < retryConfig.maxAttempts!; attempt++) {
      try {
        // Call ByteRover gRPC API via provider
        // For Claude: pass genConfig as contents (complete body), config = {} (empty RequestOptions)
        // For Gemini: pass formattedMessages as contents, genConfig as config
        const contents = this.providerType === 'claude' ? currentConfig : formattedMessages
        const config = this.providerType === 'claude' ? ({} as RequestOptions) : currentConfig

        // eslint-disable-next-line no-await-in-loop -- Sequential retries required for error recovery
        const response = await this.provider.generateContent(
          contents as Content[] | MessageCreateParamsNonStreaming,
          config as GenerateContentConfig | RequestOptions,
          this.config.model,
        )

        // Parse response to internal format
        const messages = this.formatter.parseResponse(response)

        // Validate response structure
        const lastMessage = ResponseValidator.validateResponse(response, messages)

        // Success - return validated message
        return lastMessage
      } catch (error) {
        lastError = error as Error

        // Check if error is retryable
        if (!RetryHelper.isRetryableError(error)) {
          // Non-validation error - throw immediately
          if (error instanceof LlmResponseParsingError || error instanceof LlmGenerationError) {
            throw error
          }

          // Use .message to avoid "Error: Error: ..." nesting
          const errorMessage = error instanceof Error ? error.message : String(error)
          throw new LlmResponseParsingError(errorMessage, 'byterover', this.config.model)
        }

        // Don't retry on last attempt
        if (attempt === retryConfig.maxAttempts! - 1) {
          break
        }

        // Emit retry event
        const validationError = error as ResponseValidationError
        this.sessionEventBus.emit('llmservice:warning', {
          message: `Response validation failed (${validationError.validationType}), retrying... (attempt ${
            attempt + 1
          }/${retryConfig.maxAttempts})`,
          model: this.config.model,
          provider: 'byterover',
        })

        // Calculate delay and sleep
        const delay = RetryHelper.calculateDelay(attempt, retryConfig.initialDelayMs!)
        // eslint-disable-next-line no-await-in-loop -- Sequential delay required between retries
        await RetryHelper.sleep(delay)

        // Adjust temperature for retry (if applicable)
        if ('temperature' in currentConfig && typeof currentConfig.temperature === 'number') {
          const newTemperature = RetryHelper.adjustTemperature(
            currentConfig.temperature,
            retryConfig as Required<RetryConfig>,
          )
          currentConfig = {
            ...currentConfig,
            temperature: newTemperature,
          }
        }

        // Continue to next attempt
        continue
      }
    }

    // All retries failed - throw last error
    if (lastError instanceof LlmResponseParsingError) {
      throw lastError
    }

    throw new LlmResponseParsingError(
      `Response validation failed after ${retryConfig.maxAttempts} attempts: ${lastError?.message ?? 'Unknown error'}`,
      'byterover',
      this.config.model,
    )
  }

  /**
   * Detect provider type from model name.
   *
   * @param model - Model identifier
   * @returns Provider type ('claude' or 'gemini')
   */
  private detectProviderType(model: string): 'claude' | 'gemini' {
    return model.toLowerCase().startsWith('claude') ? 'claude' : 'gemini'
  }

  /**
   * Execute a single iteration of the agentic loop.
   *
   * @param iterationCount - Current iteration number
   * @param tools - Available tools for this iteration
   * @param mode - Optional mode for system prompt
   * @param executionContext - Optional execution context
   * @returns Final response string if complete, null if more iterations needed
   */
  private async executeAgenticIteration(
    iterationCount: number,
    tools: ToolDefinition[],
    mode?: 'autonomous' | 'default' | 'query',
    executionContext?: ExecutionContext,
  ): Promise<null | string> {
    // Build system prompt using SimplePromptFactory (before compression for correct token accounting)
    const availableTools = this.toolManager.getToolNames()
    const markersSet = this.toolManager.getAvailableMarkers()
    // Convert Set to Record for prompt factory
    const availableMarkers: Record<string, string> = {}
    for (const marker of markersSet) {
      availableMarkers[marker] = marker
    }

    let systemPrompt = await this.promptFactory.buildSystemPrompt({
      availableMarkers,
      availableTools,
      commandType: executionContext?.commandType,
      conversationMetadata: executionContext?.conversationMetadata,
      memoryManager: this.memoryManager,
      mode,
    })

    // Add reflection prompt when approaching max iterations (80% threshold)
    const iterationThreshold = Math.floor(this.config.maxIterations * 0.8)
    if (iterationCount >= iterationThreshold) {
      const reflectionPrompt = this.promptFactory.buildReflectionPrompt({
        currentIteration: iterationCount + 1,
        maxIterations: this.config.maxIterations,
        type: 'near_max_iterations',
      })
      systemPrompt = systemPrompt + '\n\n' + reflectionPrompt
    }
    // Add periodic completion check every 3 iterations (after iteration 3)
    else if (iterationCount > 0 && iterationCount % 3 === 0) {
      const reflectionPrompt = this.promptFactory.buildReflectionPrompt({
        type: 'completion_check',
      })
      systemPrompt = systemPrompt + '\n\n' + reflectionPrompt
    }

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

    // Build generation config with system prompt and messages
    // For Claude: messages are included in the config
    // For Gemini: messages are passed separately to the API call
    const genConfig = this.buildGenerationConfig(tools, systemPrompt, formattedMessages)

    // Emit thinking event
    this.sessionEventBus.emit('llmservice:thinking')

    // Call LLM and parse response
    const lastMessage = await this.callLLMAndParseResponse(genConfig, formattedMessages)

    // Check if there are tool calls
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return this.handleFinalResponse(lastMessage)
    }

    // Has tool calls - handle them
    await this.handleToolCalls(lastMessage)

    return null
  }

  /**
   * Execute a single tool call with structured error handling.
   *
   * Uses ToolManager which returns ToolExecutionResult with:
   * - success/failure status
   * - classified error types
   * - execution metadata (duration, tokens, etc.)
   *
   * @param toolCall - Tool call to execute
   */
  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    const toolName = toolCall.function.name
    const toolArgs = JSON.parse(toolCall.function.arguments)

    // Emit tool call event
    this.sessionEventBus.emit('llmservice:toolCall', {
      args: toolArgs,
      callId: toolCall.id,
      toolName,
    })

    // Execute tool via ToolManager (returns structured result)
    const result: ToolExecutionResult = await this.toolManager.executeTool(toolName, toolArgs)

    // Process output (truncation and file saving if needed)
    const processedOutput = await this.outputProcessor.processOutput(toolName, result.content)

    // Emit truncation event if output was truncated
    if (processedOutput.metadata?.truncated) {
      this.sessionEventBus.emit('llmservice:outputTruncated', {
        originalLength: processedOutput.metadata.originalLength!,
        savedToFile: processedOutput.metadata.savedToFile!,
        toolName,
      })
    }

    // Emit tool result event with success/error info
    this.sessionEventBus.emit('llmservice:toolResult', {
      callId: toolCall.id,
      errorType: result.errorType,
      metadata: {
        ...result.metadata,
        ...processedOutput.metadata,
      },
      result: processedOutput.content,
      success: result.success,
      toolName,
    })

    // Add tool result to context with full metadata (using processed output)
    await this.contextManager.addToolResult(toolCall.id, toolName, processedOutput.content, {
      errorType: result.errorType,
      metadata: {
        ...result.metadata,
        ...processedOutput.metadata,
      },
      success: result.success,
    })
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
   * Extract partial response from conversation history when max iterations reached.
   * Returns the last assistant message or accumulated tool outputs.
   *
   * @returns Partial response string
   */
  private async getPartialResponse(): Promise<string> {
    const history = this.contextManager.getMessages()

    // Find last assistant message
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]
      if (msg && msg.role === 'assistant') {
        return this.extractTextContent(msg)
      }
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
      provider: 'byterover',
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
      throw new LlmGenerationError((error as Error).message, 'byterover', this.config.model)
    }

    throw new LlmGenerationError(String(error), 'byterover', this.config.model)
  }

  /**
   * Handle thoughts from LLM response (Gemini only).
   *
   * Extracts and emits thought events if present.
   *
   * @param message - Message potentially containing thoughts
   */
  private handleThoughts(message: InternalMessage): void {
    // Only process thoughts for Gemini models
    if (this.providerType !== 'gemini') {
      return
    }

    // Check if message has thought content
    if (message.thought) {
      // Parse thought if not already parsed
      if (!message.thoughtSummary) {
        message.thoughtSummary = ThoughtParser.parse(message.thought)
      }

      // Emit thought event
      this.sessionEventBus.emit('llmservice:thought', {
        description: message.thoughtSummary.description,
        subject: message.thoughtSummary.subject,
      })
    }
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

    // Emit thought events if present
    this.handleThoughts(lastMessage)

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
