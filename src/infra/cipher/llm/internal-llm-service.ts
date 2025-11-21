// @ts-expect-error - Internal SDK path not exported in package.json, but exists and works at runtime
import type {RequestOptions} from '@anthropic-ai/sdk/internal/request-options'
import type {Tool as ClaudeTool, MessageCreateParamsNonStreaming, MessageParam} from '@anthropic-ai/sdk/resources/messages'
import type {Content, GenerateContentConfig} from '@google/genai'

import type {JSONSchema7, ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {IHistoryStorage} from '../../../core/interfaces/cipher/i-history-storage.js'
import type {ILLMService} from '../../../core/interfaces/cipher/i-llm-service.js'
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
import {SessionEventBus} from '../events/event-emitter.js'
import {ByteRoverLlmGrpcService} from '../grpc/internal-llm-grpc-service.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {ClaudeMessageFormatter} from './formatters/claude-formatter.js'
import {GeminiMessageFormatter} from './formatters/gemini-formatter.js'
import {ClaudeTokenizer} from './tokenizers/claude-tokenizer.js'
import {GeminiTokenizer} from './tokenizers/gemini-tokenizer.js'


/**
 * Configuration for ByteRover LLM service (using gRPC)
 */
export interface ByteRoverLLMServiceConfig {
  maxInputTokens?: number
  maxIterations?: number
  maxTokens?: number
  model: string
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
    timeout?: number
    verbose: boolean
  }
  private readonly contextManager: ContextManager<Content | MessageParam>
  private readonly formatter: IMessageFormatter<Content | MessageParam>
  private readonly memoryManager?: MemoryManager
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
   */
  public constructor(
    sessionId: string,
    provider: ByteRoverLlmGrpcService,
    config: ByteRoverLLMServiceConfig,
    options: {
      historyStorage?: IHistoryStorage
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
    this.config = {
      maxInputTokens: config.maxInputTokens ?? 1_000_000,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'gemini-2.5-flash',
      temperature: config.temperature ?? 0.7,
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
   * @param options.signal - Optional abort signal for cancellation
   * @param options.imageData - Optional image data
   * @param options.fileData - Optional file data
   * @param options.stream - Whether to stream response (not implemented yet)
   * @param options.mode - Optional mode for system prompt ('json-input' enables autonomous mode)
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    options?: {fileData?: FileData; imageData?: ImageData; mode?: 'default' | 'json-input'; signal?: AbortSignal; stream?: boolean},
  ): Promise<string> {
    // Extract options with defaults
    const {fileData, imageData, mode, signal} = options ?? {}

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
        const result = await this.executeAgenticIteration(iterationCount, tools, mode)

        if (result !== null) {
          return result
        }

        iterationCount++
      } catch (error) {
        this.handleLLMError(error)
      }
    }

    // Max iterations exceeded
    throw new LlmMaxIterationsError(this.config.maxIterations, 'byterover', this.config.model)
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
  private buildClaudeConfig(tools: ToolDefinition[], systemPrompt: string, messages: MessageParam[]): MessageCreateParamsNonStreaming {
    /* eslint-disable camelcase */
    const claudeTools: ClaudeTool[] = tools.map((tool) => ({
      input_schema: tool.parameters as ClaudeTool.InputSchema,
      name: tool.name,
      ...(tool.description && {description: tool.description}),
    }))

    return {
      max_tokens: this.config.maxTokens,
      messages,  // Messages array is part of the config for Claude
      model: this.config.model,  // Model is also part of the body
      system: systemPrompt,
      temperature: this.config.temperature,
      ...(claudeTools.length > 0 && {tools: claudeTools}),
    }
    /* eslint-enable camelcase */
  }

  /**
   * Build Gemini-specific generation configuration.
   *
   * @param tools - Available tool definitions
   * @param systemPrompt - System prompt (passed in systemInstruction)
   * @returns Gemini API configuration object
   */
  private buildGeminiConfig(tools: ToolDefinition[], systemPrompt: string): GenerateContentConfig {
    return {
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
    messages: Content[] | MessageParam[]
  ): GenerateContentConfig | MessageCreateParamsNonStreaming {
    if (this.providerType === 'claude') {
      return this.buildClaudeConfig(tools, systemPrompt, messages as MessageParam[])
    }

    return this.buildGeminiConfig(tools, systemPrompt)
  }

  /**
   * Call LLM and parse the response.
   *
   * Parameter structure differs by provider:
   * - Gemini: contents = formattedMessages, config = genConfig
   * - Claude: contents = genConfig (complete body), config = {} (empty RequestOptions)
   *
   * @param genConfig - For Gemini: GenerateContentConfig. For Claude: MessageCreateParamsNonStreaming (complete body)
   * @param formattedMessages - Formatted messages (only used for Gemini; Claude has messages in genConfig)
   * @returns Last message from parsed response
   */
  private async callLLMAndParseResponse(
    genConfig: GenerateContentConfig | MessageCreateParamsNonStreaming,
    formattedMessages: Content[] | MessageParam[],
  ): Promise<InternalMessage> {
    // Call ByteRover gRPC API via provider
    // For Claude: pass genConfig as contents (complete body), config = {} (empty RequestOptions)
    // For Gemini: pass formattedMessages as contents, genConfig as config
    const contents = this.providerType === 'claude' ? genConfig : formattedMessages
    const config = this.providerType === 'claude' ? {} as RequestOptions : genConfig

    const response = await this.provider.generateContent(
      contents as Content[] | MessageCreateParamsNonStreaming,
      config as GenerateContentConfig | RequestOptions,
      this.config.model,
    )

    // Parse response to internal format
    const messages = this.formatter.parseResponse(response)
    if (messages.length === 0) {
      throw new LlmResponseParsingError('No messages returned from formatter', 'byterover', this.config.model)
    }

    const lastMessage = messages.at(-1)
    if (!lastMessage) {
      throw new LlmResponseParsingError('Failed to get last message from response', 'byterover', this.config.model)
    }

    return lastMessage
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
   * @returns Final response string if complete, null if more iterations needed
   */
  private async executeAgenticIteration(
    iterationCount: number,
    tools: ToolDefinition[],
    mode?: 'default' | 'json-input',
  ): Promise<null | string> {
    // Build system prompt using SimplePromptFactory (before compression for correct token accounting)
    const availableTools = this.toolManager.getToolNames()
    const markersSet = this.toolManager.getAvailableMarkers()
    // Convert Set to Record for prompt factory
    const availableMarkers: Record<string, string> = {}
    for (const marker of markersSet) {
      availableMarkers[marker] = marker
    }

    const systemPrompt = await this.promptFactory.buildSystemPrompt({
      availableMarkers,
      availableTools,
      memoryManager: this.memoryManager,
      mode,
    })

    // Verbose debug: Show complete system prompt
    if (this.config.verbose) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`[PromptDebug:LLMService] SYSTEM PROMPT (Iteration ${iterationCount + 1})`)
      console.log(`${'='.repeat(80)}`)
      console.log(`Length: ${systemPrompt.length} characters`)
      console.log(`Lines: ${systemPrompt.split('\n').length}`)
      console.log(`\n--- FIRST 500 CHARACTERS ---`)
      console.log(systemPrompt.slice(0, 500))
      console.log(`\n--- LAST 500 CHARACTERS ---`)
      console.log(systemPrompt.slice(-500))
      console.log(`${'='.repeat(80)}\n`)
    }

    // Get formatted messages from context with compression (passing system prompt for token accounting)
    const {formattedMessages, tokensUsed} = await this.contextManager.getFormattedMessagesWithCompression(systemPrompt)

    // Verbose: Log formatted messages that will be sent to LLM
    if (this.config.verbose) {
      console.log('\n========== FORMATTED MESSAGES (Sent to LLM) ==========')
      console.log(JSON.stringify(formattedMessages, null, 2))
      console.log('========== END FORMATTED MESSAGES ==========\n')
    }

    // Log token usage for monitoring compression behavior
    console.log(`[ByteRoverLLMService] [Iter ${iterationCount + 1}/${this.config.maxIterations}] Sending to LLM: ${tokensUsed} tokens (max: ${this.config.maxInputTokens})`)

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

      await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, `Error: ${errorMessage}`, {success: false})
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
