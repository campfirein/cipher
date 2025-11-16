import type {Content, GenerateContentConfig} from '@google/genai'

import {GoogleGenAI} from '@google/genai'

import type {JSONSchema7, ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {ExecutionContext} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {ILLMService} from '../../../core/interfaces/cipher/i-llm-service.js'
import type {InternalMessage, ToolCall} from '../../../core/interfaces/cipher/message-types.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmResponseParsingError,
} from '../../../core/domain/cipher/errors/llm-error.js'
import {SessionEventBus} from '../events/event-emitter.js'
import {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {GeminiMessageFormatter} from './formatters/gemini-formatter.js'
import {GeminiTokenizer} from './tokenizers/gemini-tokenizer.js'

/**
 * Configuration for Gemini LLM service
 */
export interface GeminiServiceConfig {
  apiKey: string
  maxInputTokens?: number
  maxIterations?: number
  maxTokens?: number
  model?: string
  temperature?: number
  timeout?: number
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
 * Simplified tool definition for Gemini function declarations
 */
interface GeminiToolDefinition {
  description: string
  name: string
  parameters: JSONSchema7
}

/**
 * Gemini LLM Service.
 *
 * Orchestrates the agentic loop for tool calling with Gemini.
 * Responsibilities:
 * - Manage conversation context via ContextManager
 * - Execute agentic loop (call LLM → execute tools → repeat)
 * - Delegate tool execution to ToolManager
 * - Format messages for Gemini API via formatter
 * - Handle errors and iteration limits
 *
 * Does NOT:
 * - Execute tools directly (uses ToolManager)
 * - Store persistent history (uses in-memory ContextManager)
 */
export class GeminiLLMService implements ILLMService {
  private readonly client: GoogleGenAI
  private readonly config: Required<Omit<GeminiServiceConfig, 'timeout'>> & {timeout?: number}
  private readonly contextManager: ContextManager<Content>
  private readonly formatter: GeminiMessageFormatter
  private readonly sessionEventBus: SessionEventBus
  private readonly systemPromptManager: SystemPromptManager
  private readonly tokenizer: GeminiTokenizer
  private readonly toolManager: ToolManager

  /**
   * Creates a new Gemini LLM service
   *
   * @param sessionId - Unique session identifier
   * @param geminiClient - Pre-configured GoogleGenAI client instance
   * @param config - Service configuration
   * @param options - Service dependencies
   * @param options.toolManager - Tool manager for tool execution
   * @param options.systemPromptManager - System prompt manager for building system prompts
   * @param options.sessionEventBus - Session event bus for emitting events
   */
  public constructor(
    sessionId: string,
    geminiClient: GoogleGenAI,
    config: GeminiServiceConfig,
    options: {
      sessionEventBus: SessionEventBus
      systemPromptManager: SystemPromptManager
      toolManager: ToolManager
    },
  ) {
    this.client = geminiClient
    this.toolManager = options.toolManager
    this.systemPromptManager = options.systemPromptManager
    this.sessionEventBus = options.sessionEventBus
    this.config = {
      apiKey: config.apiKey,
      maxInputTokens: config.maxInputTokens ?? 1_000_000,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'gemini-2.5-flash',
      temperature: config.temperature ?? 0.7,
      timeout: config.timeout,
    }

    // Initialize formatter and tokenizer
    this.formatter = new GeminiMessageFormatter()
    this.tokenizer = new GeminiTokenizer(this.config.model)

    // Initialize context manager
    this.contextManager = new ContextManager({
      formatter: this.formatter,
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
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    options?: {executionContext?: ExecutionContext; fileData?: FileData; imageData?: ImageData; signal?: AbortSignal; stream?: boolean},
  ): Promise<string> {
    // Extract options with defaults
    const {executionContext, fileData, imageData, signal} = options ?? {}

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
    throw new LlmMaxIterationsError(this.config.maxIterations, 'gemini', this.config.model)
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
      provider: 'gemini',
      router: 'in-built',
    }
  }

  /**
   * Get the context manager instance.
   */
  public getContextManager(): ContextManager<unknown> {
    return this.contextManager
  }

  /**
   * Build generation configuration for Gemini API.
   *
   * @param tools - Available tools
   * @param systemPrompt - System prompt to include
   * @returns Generation config with tools and system instruction
   */
  private buildGenerationConfig(tools: GeminiToolDefinition[], systemPrompt: string): GenerateContentConfig {
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
   * Call LLM and parse the response.
   *
   * @param genConfig - Generation configuration
   * @param formattedMessages - Formatted messages to send
   * @returns Last message from parsed response
   */
  private async callLLMAndParseResponse(genConfig: GenerateContentConfig, formattedMessages: Content[]): Promise<InternalMessage> {
    // Call Gemini API directly via client
    const response = await this.client.models.generateContent({
      config: genConfig,
      contents: formattedMessages,
      model: this.config.model,
    })

    // Parse response to internal format
    const messages = this.formatter.parseResponse(response)
    if (messages.length === 0) {
      throw new LlmResponseParsingError('No messages returned from formatter', 'gemini', this.config.model)
    }

    const lastMessage = messages.at(-1)
    if (!lastMessage) {
      throw new LlmResponseParsingError('Failed to get last message from response', 'gemini', this.config.model)
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
    tools: GeminiToolDefinition[],
    executionContext: ExecutionContext | undefined,
  ): Promise<null | string> {
    // Build system prompt using SystemPromptManager (before compression for correct token accounting)
    const systemPrompt = await this.systemPromptManager.build({
      conversationMetadata: executionContext?.conversationMetadata,
      isJsonInputMode: executionContext?.isJsonInputMode,
    })

    // Get formatted messages from context with compression (passing system prompt for token accounting)
    const {formattedMessages, tokensUsed} = await this.contextManager.getFormattedMessagesWithCompression(systemPrompt)

    // Log token usage for monitoring compression behavior
    console.log(`[GeminiLLMService] [Iter ${iterationCount + 1}/${this.config.maxIterations}] Sending to LLM: ${tokensUsed} tokens (max: ${this.config.maxInputTokens})`)

    // Build generation config with system prompt
    const genConfig = this.buildGenerationConfig(tools, systemPrompt)

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
      provider: 'gemini',
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
      throw new LlmGenerationError((error as Error).message, 'gemini', this.config.model)
    }

    throw new LlmGenerationError(String(error), 'gemini', this.config.model)
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
