import type {Content, GenerateContentConfig} from '@google/genai'

import type {JSONSchema7, ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {ILLMService} from '../../../core/interfaces/cipher/i-llm-service.js'
import type {InternalMessage} from '../../../core/interfaces/cipher/message-types.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmResponseParsingError,
} from '../../../core/domain/cipher/errors/llm-error.js'
import {SessionEventBus} from '../events/event-emitter.js'
import {ByteRoverLlmGrpcService} from '../grpc/internal-llm-grpc-service.js'
import {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {GeminiMessageFormatter} from './formatters/gemini-formatter.js'
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
 * - Format messages for ByteRover gRPC API via formatter
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
  }
  private readonly contextManager: ContextManager<Content>
  private readonly formatter: GeminiMessageFormatter
  private readonly provider: ByteRoverLlmGrpcService
  private readonly sessionEventBus: SessionEventBus
  private readonly systemPromptManager: SystemPromptManager
  private readonly tokenizer: GeminiTokenizer
  private readonly toolManager: ToolManager

  /**
   * Initialize a new ByteRover LLM service instance.
   *
   * Sets up the service with all required dependencies and initializes:
   * - Context manager for conversation history
   * - Message formatter (Gemini format)
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
   * @param options.systemPromptManager - Manager for dynamic system prompts
   * @param options.sessionEventBus - Event bus for session lifecycle events
   */
  public constructor(
    sessionId: string,
    provider: ByteRoverLlmGrpcService,
    config: ByteRoverLLMServiceConfig,
    options: {
      sessionEventBus: SessionEventBus
      systemPromptManager: SystemPromptManager
      toolManager: ToolManager
    },
  ) {
    this.provider = provider
    this.toolManager = options.toolManager
    this.systemPromptManager = options.systemPromptManager
    this.sessionEventBus = options.sessionEventBus
    this.config = {
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
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    options?: {fileData?: FileData; imageData?: ImageData; signal?: AbortSignal; stream?: boolean},
  ): Promise<string> {
    // Extract options with defaults
    const {fileData, imageData, signal} = options ?? {}

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

      // Get formatted messages from context
      // eslint-disable-next-line no-await-in-loop -- Sequential iterations required for agentic loop
      const {formattedMessages} = await this.contextManager.getFormattedMessagesWithCompression()

      // Build system prompt using SystemPromptManager
      // eslint-disable-next-line no-await-in-loop -- Sequential system prompt building required
      const systemPrompt = await this.systemPromptManager.build({})

      // Build generation config with system prompt
      const genConfig = this.buildGenerationConfig(tools, systemPrompt)

      // Emit thinking event
      this.sessionEventBus.emit('llmservice:thinking')

      try {
        // Call ByteRover gRPC API via provider
        // eslint-disable-next-line no-await-in-loop -- Sequential LLM calls required for agentic loop
        const response = await this.provider.generateContent(formattedMessages as Content[], genConfig, this.config.model)

        // Parse response to internal format
        const messages = this.formatter.parseResponse(response)
        if (messages.length === 0) {
          throw new LlmResponseParsingError(
            'No messages returned from formatter',
            'byterover',
            this.config.model,
          )
        }

        const lastMessage = messages.at(-1)!
        // Check if there are tool calls
        if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
          // No tool calls - final response
          const content = this.extractTextContent(lastMessage)

          // Emit response event
          this.sessionEventBus.emit('llmservice:response', {
            content,
            model: this.config.model,
            provider: 'byterover',
          })

          // Add assistant message to context
          // eslint-disable-next-line no-await-in-loop -- Sequential context update required
          await this.contextManager.addAssistantMessage(content)

          return content
        }

        // Has tool calls - add assistant message with tool calls
        const assistantContent = this.extractTextContent(lastMessage)
        // eslint-disable-next-line no-await-in-loop -- Sequential context update required
        await this.contextManager.addAssistantMessage(assistantContent, lastMessage.toolCalls)

        // Execute tool calls via ToolManager
        for (const toolCall of lastMessage.toolCalls) {
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
            // eslint-disable-next-line no-await-in-loop -- Sequential tool execution required
            const result = await this.toolManager.executeTool(toolName, toolArgs)

            // Emit tool result event (success)
            this.sessionEventBus.emit('llmservice:toolResult', {
              callId: toolCall.id,
              result,
              success: true,
              toolName,
            })

            // Add tool result to context
            // eslint-disable-next-line no-await-in-loop -- Sequential context update required
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

            // eslint-disable-next-line no-await-in-loop -- Sequential context update required
            await this.contextManager.addToolResult(
              toolCall.id,
              toolCall.function.name,
              `Error: ${errorMessage}`,
              {success: false},
            )
          }
        }

        iterationCount++
      } catch (error) {
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
   * Build the generation configuration for the ByteRover gRPC API call.
   *
   * Constructs the complete generation parameters including:
   * - Output token limit (from config)
   * - Temperature/sampling parameters
   * - System instruction from the prompt manager
   * - Available tools for function calling
   *
   * This configuration is passed to the provider and controls how the LLM
   * generates responses. It bridges between service configuration and
   * the provider's expected format.
   *
   * @param tools - List of tool definitions available to the LLM
   * @param systemPrompt - System prompt text to guide LLM behavior
   * @returns Complete generation configuration for gRPC API
   */
  private buildGenerationConfig(tools: ToolDefinition[], systemPrompt: string): GenerateContentConfig {
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
}
