/**
 * OpenRouter Content Generator.
 *
 * Implements IContentGenerator using OpenRouter API (OpenAI-compatible).
 * Supports various models available through OpenRouter.
 */

import type {ChatCompletionMessageParam, ChatCompletionTool} from 'openai/resources'

import {OpenAI} from 'openai'

import type {JSONSchema7, ToolSet} from '../../../../core/domain/cipher/tools/types.js'
import type {
  GenerateContentChunk,
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../../core/interfaces/cipher/i-content-generator.js'
import type {InternalMessage} from '../../../../core/interfaces/cipher/message-types.js'

import {OpenRouterMessageFormatter} from '../formatters/openrouter-formatter.js'
import {OpenRouterTokenizer} from '../tokenizers/openrouter-tokenizer.js'

/**
 * Configuration for OpenRouter Content Generator.
 */
export interface OpenRouterContentGeneratorConfig {
  /** OpenRouter API key */
  apiKey: string
  /** Base URL for OpenRouter API */
  baseUrl?: string
  /** HTTP Referer header for OpenRouter */
  httpReferer?: string
  /** Maximum tokens in the response */
  maxTokens?: number
  /** Model identifier */
  model?: string
  /** Site name for X-Title header */
  siteName?: string
  /** Temperature for randomness */
  temperature?: number
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * OpenAI-compatible tool definition for function calling.
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
 * OpenRouter Content Generator.
 *
 * Wraps OpenAI client configured for OpenRouter and implements IContentGenerator.
 * Provides:
 * - Non-streaming content generation
 * - Streaming content generation (true streaming via OpenAI SDK)
 * - Token estimation
 */
export class OpenRouterContentGenerator implements IContentGenerator {
  private readonly client: OpenAI
  private readonly config: {
    maxTokens: number
    model: string
    temperature: number
  }
  private readonly formatter: OpenRouterMessageFormatter
  private readonly tokenizer: OpenRouterTokenizer

  /**
   * Create a new OpenRouter Content Generator.
   *
   * @param config - Generator configuration
   */
  constructor(config: OpenRouterContentGeneratorConfig) {
    this.config = {
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'anthropic/claude-haiku-4.5',
      temperature: config.temperature ?? 0.7,
    }

    // Initialize OpenAI client with OpenRouter base URL
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        ...(config.httpReferer && {'HTTP-Referer': config.httpReferer}),
        ...(config.siteName && {'X-Title': config.siteName}),
      },
      timeout: config.timeout,
    })

    // Initialize formatter and tokenizer
    this.formatter = new OpenRouterMessageFormatter()
    this.tokenizer = new OpenRouterTokenizer()
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
    // Format messages for OpenAI/OpenRouter
    const formattedMessages = this.formatter.format(request.contents)

    // Build tools array
    const tools = this.buildTools(request.tools ?? {})

    // Build messages with system prompt
    const messages: ChatCompletionMessageParam[] = request.systemPrompt
      ? [{content: request.systemPrompt, role: 'system'}, ...formattedMessages]
      : formattedMessages

    // Call OpenRouter API
    const rawResponse = await this.client.chat.completions.create({
      // eslint-disable-next-line camelcase
      max_tokens: request.config.maxTokens ?? this.config.maxTokens,
      messages,
      model: request.model ?? this.config.model,
      temperature: request.config.temperature ?? this.config.temperature,
      ...(tools.length > 0 && {tools: tools as ChatCompletionTool[]}),
    })

    // Parse response to internal format
    const parsedMessages = this.formatter.parseResponse(rawResponse)
    const lastMessage = parsedMessages.at(-1)

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
    } else if (rawResponse.choices[0]?.finish_reason === 'length') {
      finishReason = 'max_tokens'
    }

    // Extract usage if available
    const usage = rawResponse.usage
      ? {
          completionTokens: rawResponse.usage.completion_tokens,
          promptTokens: rawResponse.usage.prompt_tokens,
          totalTokens: rawResponse.usage.total_tokens,
        }
      : undefined

    return {
      content,
      finishReason,
      rawResponse,
      toolCalls,
      usage,
    }
  }

  /**
   * Generate content with streaming.
   *
   * Uses OpenAI SDK's native streaming support for real-time content generation.
   * Includes rawChunk for native reasoning extraction by the stream transformer.
   *
   * @param request - Generation request
   * @yields Content chunks as they are generated
   * @returns Async generator yielding content chunks
   */
  public async *generateContentStream(
    request: GenerateContentRequest,
  ): AsyncGenerator<GenerateContentChunk> {
    // Format messages for OpenAI/OpenRouter
    const formattedMessages = this.formatter.format(request.contents)

    // Build tools array
    const tools = this.buildTools(request.tools ?? {})

    // Build messages with system prompt
    const messages: ChatCompletionMessageParam[] = request.systemPrompt
      ? [{content: request.systemPrompt, role: 'system'}, ...formattedMessages]
      : formattedMessages

    // Call OpenRouter API with streaming
    const stream = await this.client.chat.completions.create({
      // eslint-disable-next-line camelcase
      max_tokens: request.config.maxTokens ?? this.config.maxTokens,
      messages,
      model: request.model ?? this.config.model,
      stream: true,
      temperature: request.config.temperature ?? this.config.temperature,
      ...(tools.length > 0 && {tools: tools as ChatCompletionTool[]}),
    })

    // Accumulate tool calls across chunks
    const accumulatedToolCalls: Map<number, {
      arguments: string
      id: string
      name: string
    }> = new Map()

    // Stream chunks
    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue

      const {delta} = choice

      // Handle tool call deltas
      if (delta.tool_calls) {
        this.processToolCallDeltas(delta.tool_calls, accumulatedToolCalls)
      }

      // Yield content chunk
      const isComplete = choice.finish_reason !== null
      const finishReason = this.determineFinishReason(choice.finish_reason, isComplete)
      const toolCalls = this.buildToolCallsArray(accumulatedToolCalls, isComplete)

      // Extract native reasoning fields if present (for OpenAI o1/o3, Grok, Gemini)
      // Different providers return reasoning differently:
      // - OpenAI: delta.reasoning
      // - Grok: delta.reasoning_content or delta.reasoning_details
      // - Gemini via OpenRouter: delta.reasoning_details array with {type: 'reasoning.text', text: '...'}
      // The rawChunk allows the stream transformer to extract reasoning using model-specific logic
      const deltaAny = delta as Record<string, unknown>

      // Check for standard reasoning fields first
      let reasoning = (deltaAny.reasoning ?? deltaAny.reasoning_content ?? deltaAny.thoughts) as string | undefined

      // Check for OpenRouter's reasoning_details array format (used for Gemini and some other models)
      if (!reasoning && deltaAny.reasoning_details) {
        const details = deltaAny.reasoning_details as Array<{text?: string; type?: string}>
        if (Array.isArray(details)) {
          const reasoningText = details
            .filter((d) => d.type === 'reasoning.text' && d.text)
            .map((d) => d.text)
            .join('')
          if (reasoningText) {
            reasoning = reasoningText
          }
        }
      }

      yield {
        content: delta.content ?? undefined,
        finishReason,
        isComplete,
        rawChunk: chunk,
        reasoning,
        reasoningId: reasoning ? chunk.id : undefined,
        toolCalls,
      }
    }
  }

  /**
   * Build tool calls array from accumulated tool calls.
   */
  private buildToolCallsArray(
    accumulatedToolCalls: Map<number, {arguments: string; id: string; name: string}>,
    isComplete: boolean,
  ): GenerateContentChunk['toolCalls'] {
    if (!isComplete || accumulatedToolCalls.size === 0) {
      return undefined
    }

    return [...accumulatedToolCalls.values()].map((tc) => ({
      function: {
        arguments: tc.arguments,
        name: tc.name,
      },
      id: tc.id,
      type: 'function' as const,
    }))
  }

  /**
   * Build tools array from ToolSet.
   */
  private buildTools(tools: ToolSet): OpenAIToolDefinition[] {
    return Object.entries(tools).map(([name, schema]) => ({
      function: {
        description: schema.description ?? '',
        name,
        parameters: schema.parameters,
      },
      type: 'function' as const,
    }))
  }

  /**
   * Determine finish reason from OpenAI finish reason.
   */
  private determineFinishReason(
    finishReason: null | string,
    isComplete: boolean,
  ): GenerateContentChunk['finishReason'] | undefined {
    if (!isComplete) {
      return undefined
    }

    if (finishReason === 'tool_calls') {
      return 'tool_calls'
    }

    if (finishReason === 'length') {
      return 'max_tokens'
    }

    return 'stop'
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
   * Process tool call deltas and accumulate them.
   */
  private processToolCallDeltas(
    toolCallDeltas: Array<{function?: {arguments?: string; name?: string}; id?: string; index: number}>,
    accumulatedToolCalls: Map<number, {arguments: string; id: string; name: string}>,
  ): void {
    for (const toolCallDelta of toolCallDeltas) {
      const {function: func, id, index} = toolCallDelta
      const existing = accumulatedToolCalls.get(index)

      if (existing) {
        // Append to existing tool call
        if (func?.arguments) {
          existing.arguments += func.arguments
        }
      } else {
        // Start new tool call
        accumulatedToolCalls.set(index, {
          arguments: func?.arguments ?? '',
          id: id ?? `tool_${index}`,
          name: func?.name ?? '',
        })
      }
    }
  }
}
