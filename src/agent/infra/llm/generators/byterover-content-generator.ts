/**
 * ByteRover Content Generator.
 *
 * Implements IContentGenerator using ByteRover HTTP service.
 * Supports both Claude and Gemini models through the unified HTTP interface.
 */

// @ts-expect-error - Internal SDK path not exported in package.json, but exists and works at runtime
import type {RequestOptions} from '@anthropic-ai/sdk/internal/request-options'
import type {
  Tool as ClaudeTool,
  MessageCreateParamsNonStreaming,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages'

import {type Content, FunctionCallingConfigMode, type GenerateContentConfig} from '@google/genai'
// import {appendFileSync} from 'node:fs'

import type {ToolSet} from '../../../core/domain/tools/types.js'
import type {
  GenerateContentChunk,
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../core/interfaces/i-content-generator.js'
import type {IMessageFormatter} from '../../../core/interfaces/i-message-formatter.js'
import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../core/interfaces/message-types.js'
import type {ByteRoverLlmHttpService} from '../../http/internal-llm-http-service.js'

import {ClaudeMessageFormatter} from '../formatters/claude-formatter.js'
import {ensureActiveLoopHasThoughtSignatures, GeminiMessageFormatter} from '../formatters/gemini-formatter.js'
import {type ThinkingConfig, ThinkingConfigManager} from '../thought-parser.js'
import {ClaudeTokenizer} from '../tokenizers/claude-tokenizer.js'
import {GeminiTokenizer} from '../tokenizers/gemini-tokenizer.js'

/**
 * Configuration for ByteRover Content Generator.
 */
export interface ByteRoverContentGeneratorConfig {
  /** Maximum tokens in the response */
  maxTokens?: number
  /** Model identifier */
  model: string
  /** Temperature for randomness */
  temperature?: number
  /** Thinking configuration for Gemini models */
  thinkingConfig?: ThinkingConfig
}

/**
 * ByteRover Content Generator.
 *
 * Wraps ByteRoverLlmHttpService and implements IContentGenerator.
 * Handles:
 * - Provider detection (Claude vs Gemini)
 * - Message formatting via provider-specific formatters
 * - Token estimation via provider-specific tokenizers
 * - Response parsing to unified format
 */
export class ByteRoverContentGenerator implements IContentGenerator {
  private readonly config: {
    maxTokens: number
    model: string
    temperature: number
    thinkingConfig?: ThinkingConfig
  }
  private readonly formatter: IMessageFormatter<Content | MessageParam>
  private readonly httpService: ByteRoverLlmHttpService
  private readonly providerType: 'claude' | 'gemini'
  private readonly tokenizer: ITokenizer

  /**
   * Create a new ByteRover Content Generator.
   *
   * @param httpService - Configured HTTP service for LLM API calls
   * @param config - Generator configuration
   */
  constructor(httpService: ByteRoverLlmHttpService, config: ByteRoverContentGeneratorConfig) {
    this.httpService = httpService
    this.config = {
      maxTokens: config.maxTokens ?? 8192,
      model: config.model,
      temperature: config.temperature ?? 0.7,
      thinkingConfig: config.thinkingConfig,
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
  }

  /**
   * Estimate tokens synchronously using character-based approximation.
   *
   * @param content - Text to estimate tokens for
   * @returns Estimated token count
   */
  public estimateTokensSync(content: string): number {
    return this.tokenizer.countTokens(content)
  }

  /**
   * Generate content (non-streaming).
   *
   * @param request - Generation request
   * @returns Generated content response
   */
  public async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    // Format messages for provider
    let formattedMessages = this.formatter.format(request.contents)

    // For Gemini 3+ models, ensure function calls in the active loop have thought signatures
    if (this.providerType === 'gemini') {
      formattedMessages = ensureActiveLoopHasThoughtSignatures(
        formattedMessages as Content[],
        this.config.model,
      )
    }

    // Build generation config
    const genConfig = this.buildGenerationConfig(request.tools ?? {}, request.systemPrompt ?? '', formattedMessages)

    // Call gRPC service
    const contents = this.providerType === 'claude' ? genConfig : formattedMessages
    const config = this.providerType === 'claude' ? ({} as RequestOptions) : genConfig

    // Build execution metadata from request
    const executionMetadata = {
      sessionId: request.taskId,
      taskId: request.taskId,
      ...(request.executionContext && {executionContext: request.executionContext}),
    }

    // // Debug: Log taskId for tracking
    // appendFileSync('debug-taskid.log', `[${new Date().toISOString()}] taskId from request: "${request.taskId}"\n`)

    const rawResponse = await this.httpService.generateContent(
      contents as Content[] | MessageCreateParamsNonStreaming,
      config as GenerateContentConfig | RequestOptions,
      executionMetadata,
    )

    // Parse response to internal format
    const messages = this.formatter.parseResponse(rawResponse)
    const lastMessage = messages.at(-1)

    if (!lastMessage) {
      return {
        content: '',
        finishReason: 'error',
        rawResponse,
        toolCalls: [],
      }
    }

    // Extract content and tool calls
    const content = this.extractTextContent(lastMessage)
    const toolCalls = lastMessage.toolCalls ?? []

    // Determine finish reason
    let finishReason: GenerateContentResponse['finishReason'] = 'stop'
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls'
    }

    return {
      content,
      finishReason,
      rawResponse,
      toolCalls,
      usage: this.extractUsage(rawResponse),
    }
  }

  /**
   * Generate content with streaming.
   *
   * Uses the HTTP service's streaming endpoint to yield chunks as they arrive.
   * Handles both regular content and thinking/reasoning parts from Gemini models.
   *
   * @param request - Generation request
   * @yields Content chunks as they are generated
   * @returns Async generator yielding content chunks
   */
  public async *generateContentStream(request: GenerateContentRequest): AsyncGenerator<GenerateContentChunk> {
    // Format messages for provider
    let formattedMessages = this.formatter.format(request.contents)

    // For Gemini 3+ models, ensure function calls in the active loop have thought signatures
    if (this.providerType === 'gemini') {
      formattedMessages = ensureActiveLoopHasThoughtSignatures(
        formattedMessages as Content[],
        this.config.model,
      )
    }

    // Build generation config
    const genConfig = this.buildGenerationConfig(request.tools ?? {}, request.systemPrompt ?? '', formattedMessages)

    // Build execution metadata from request
    const executionMetadata = {
      sessionId: request.taskId,
      taskId: request.taskId,
      ...(request.executionContext && {executionContext: request.executionContext}),
    }

    // Determine contents and config based on provider
    const contents = this.providerType === 'claude' ? genConfig : formattedMessages
    const config = this.providerType === 'claude' ? ({} as RequestOptions) : genConfig

    // We DON'T use httpService.generateContentStream because it discards the
    // raw response after extracting chunks — losing usage metadata. Instead,
    // call generateContent directly to get the full response, extract usage,
    // and yield chunks ourselves (using the now-public extract helpers).
    // This preserves the streaming chunk semantics while surfacing usage on
    // the final chunk for telemetry.
    const rawResponse = await this.httpService.generateContent(
      contents as Content[] | MessageCreateParamsNonStreaming,
      config as GenerateContentConfig | RequestOptions,
      executionMetadata,
    )

    // Yield thinking chunks first (Gemini may emit `thought: true` parts)
    yield* this.httpService.extractThinkingFromResponse(rawResponse)

    // Yield content + tool-call chunks. Attach `usage` to the final chunk.
    const usage = this.extractUsage(rawResponse)
    let lastEmitted = false
    for (const chunk of this.httpService.extractContentFromResponse(rawResponse)) {
      if (chunk.isComplete && usage) {
        yield {...chunk, usage}
        lastEmitted = true
      } else {
        yield chunk
      }
    }

    // Defensive: if extractContentFromResponse didn't emit a final chunk,
    // ensure usage still surfaces via a trailing usage-only chunk.
    if (!lastEmitted && usage) {
      yield {isComplete: true, usage}
    }
  }

  /**
   * Build Claude-specific generation configuration.
   */
  private buildClaudeConfig(
    tools: ToolSet,
    systemPrompt: string,
    messages: MessageParam[],
  ): MessageCreateParamsNonStreaming {
    /* eslint-disable camelcase */
    const claudeTools: ClaudeTool[] = Object.entries(tools).map(([name, schema]) => ({
      description: schema.description ?? '',
      input_schema: schema.parameters as ClaudeTool.InputSchema,
      name,
    }))

    return {
      max_tokens: this.config.maxTokens,
      messages,
      model: this.config.model,
      system: systemPrompt,
      temperature: this.config.temperature,
      ...(claudeTools.length > 0 && {tools: claudeTools}),
    }
    /* eslint-enable camelcase */
  }

  /**
   * Build Gemini-specific generation configuration.
   */
  private buildGeminiConfig(tools: ToolSet, systemPrompt: string): GenerateContentConfig {
    const toolDefinitions = Object.entries(tools).map(([name, schema]) => ({
      description: schema.description ?? '',
      name,
      parameters: schema.parameters as Record<string, unknown>,
    }))

    const baseConfig: GenerateContentConfig = {
      maxOutputTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      topP: 1,
      ...(systemPrompt && {systemInstruction: {parts: [{text: systemPrompt}]}}),
      ...(toolDefinitions.length > 0 && {
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.VALIDATED,
          },
        },
        tools: [
          {
            functionDeclarations: toolDefinitions,
          },
        ],
      }),
    }

    // Add thinking configuration for Gemini models
    const thinkingConfig = ThinkingConfigManager.mergeConfig(this.config.model, this.config.thinkingConfig)

    if (thinkingConfig) {
      baseConfig.thinkingConfig = thinkingConfig as Record<string, unknown>
    }

    return baseConfig
  }

  /**
   * Build generation config for the appropriate provider.
   */
  private buildGenerationConfig(
    tools: ToolSet,
    systemPrompt: string,
    messages: Content[] | MessageParam[],
  ): GenerateContentConfig | MessageCreateParamsNonStreaming {
    if (this.providerType === 'claude') {
      return this.buildClaudeConfig(tools, systemPrompt, messages as MessageParam[])
    }

    return this.buildGeminiConfig(tools, systemPrompt)
  }

  /**
   * Detect provider type from model name.
   */
  private detectProviderType(model: string): 'claude' | 'gemini' {
    return model.toLowerCase().startsWith('claude') ? 'claude' : 'gemini'
  }

  /**
   * Extract text content from an internal message.
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
   * Extract provider-reported token usage from a raw response.
   *
   * Dispatches by `providerType`:
   * - Gemini: `rawResponse.usageMetadata.{promptTokenCount, candidatesTokenCount, totalTokenCount, cachedContentTokenCount, thoughtsTokenCount}`
   * - Claude: `rawResponse.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`
   *
   * Returns undefined if the response doesn't carry usage (e.g. error path or
   * a stub response). Callers should treat the absence as "we don't know" not zero.
   */
  private extractUsage(rawResponse: unknown): GenerateContentResponse['usage'] {
    if (!rawResponse || typeof rawResponse !== 'object') return undefined

    if (this.providerType === 'gemini') {
      const meta = (rawResponse as {usageMetadata?: Record<string, number | undefined>}).usageMetadata
      if (!meta) return undefined
      const inputTokens = meta.promptTokenCount ?? 0
      const outputTokens = meta.candidatesTokenCount ?? 0
      const totalTokens = meta.totalTokenCount ?? inputTokens + outputTokens
      const cacheReadTokens = meta.cachedContentTokenCount
      const reasoningTokens = meta.thoughtsTokenCount
      return {
        inputTokens,
        outputTokens,
        totalTokens,
        ...(typeof cacheReadTokens === 'number' && cacheReadTokens > 0 && {cacheReadTokens}),
        ...(typeof reasoningTokens === 'number' && reasoningTokens > 0 && {reasoningTokens}),
      }
    }

    // Claude
    const {usage} = (rawResponse as {usage?: Record<string, number | undefined>})
    if (!usage) return undefined
     
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const cacheReadTokens = usage.cache_read_input_tokens
    const cacheCreationTokens = usage.cache_creation_input_tokens
     
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      ...(typeof cacheReadTokens === 'number' && cacheReadTokens > 0 && {cacheReadTokens}),
      ...(typeof cacheCreationTokens === 'number' && cacheCreationTokens > 0 && {cacheCreationTokens}),
    }
  }
}
