/**
 * AI SDK Content Generator
 *
 * Universal IContentGenerator adapter wrapping any AI SDK LanguageModel.
 * Replaces per-provider content generators with one unified implementation.
 */

import type {LanguageModel} from 'ai'

import {generateText, streamText} from 'ai'

import type {
  GenerateContentChunk,
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../core/interfaces/i-content-generator.js'
import type {ToolCall} from '../../../core/interfaces/message-types.js'

import {StreamChunkType} from '../../../core/interfaces/i-content-generator.js'
import {toAiSdkTools, toModelMessages} from './ai-sdk-message-converter.js'

const DEFAULT_CHARS_PER_TOKEN = 4

/**
 * Configuration for AiSdkContentGenerator.
 */
export interface AiSdkContentGeneratorConfig {
  /** Characters per token ratio for token estimation */
  charsPerToken?: number
  /** AI SDK LanguageModel instance */
  model: LanguageModel
}

/**
 * Universal content generator that wraps any AI SDK LanguageModel.
 *
 * Implements IContentGenerator by delegating to the AI SDK's
 * generateText() and streamText() functions. This single adapter
 * replaces all per-provider content generators (Anthropic, OpenAI,
 * Google, OpenRouter) with one unified implementation.
 */
export class AiSdkContentGenerator implements IContentGenerator {
  private readonly charsPerToken: number
  private readonly model: LanguageModel

  constructor(config: AiSdkContentGeneratorConfig) {
    this.model = config.model
    this.charsPerToken = config.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN
  }

  public estimateTokensSync(content: string): number {
    return Math.ceil(content.length / this.charsPerToken)
  }

  public async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    const messages = toModelMessages(request.contents)
    const tools = toAiSdkTools(request.tools)

    const result = await generateText({
      maxOutputTokens: request.config.maxTokens,
      maxRetries: 0, // RetryableContentGenerator handles retries
      messages,
      model: this.model,
      temperature: request.config.temperature,
      ...(request.systemPrompt && {system: request.systemPrompt}),
      ...(tools && {tools}),
      ...(request.config.topK !== undefined && {topK: request.config.topK}),
      ...(request.config.topP !== undefined && {topP: request.config.topP}),
    })

    // Map AI SDK tool calls to our ToolCall format
    // Preserve thoughtSignature from providerMetadata (required by Gemini 3+ models)
    const toolCalls: ToolCall[] = result.toolCalls.map((tc) => {
      const meta = tc.providerMetadata as Record<string, Record<string, unknown>> | undefined
      const thoughtSig = meta?.google?.thoughtSignature

      return {
        function: {
          arguments: JSON.stringify(tc.input),
          name: tc.toolName,
        },
        id: tc.toolCallId,
        ...(typeof thoughtSig === 'string' && {thoughtSignature: thoughtSig}),
        type: 'function' as const,
      }
    })

    return {
      content: result.text,
      finishReason: mapFinishReason(result.finishReason, toolCalls.length > 0),
      rawResponse: result.response,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        completionTokens: result.usage.outputTokens ?? 0,
        promptTokens: result.usage.inputTokens ?? 0,
        totalTokens: result.usage.totalTokens ?? 0,
      },
    }
  }

  public async *generateContentStream(
    request: GenerateContentRequest,
  ): AsyncGenerator<GenerateContentChunk> {
    const messages = toModelMessages(request.contents)
    const tools = toAiSdkTools(request.tools)

    const result = streamText({
      maxOutputTokens: request.config.maxTokens,
      maxRetries: 0,
      messages,
      model: this.model,
      temperature: request.config.temperature,
      ...(request.systemPrompt && {system: request.systemPrompt}),
      ...(tools && {tools}),
      ...(request.config.topK !== undefined && {topK: request.config.topK}),
      ...(request.config.topP !== undefined && {topP: request.config.topP}),
    })

    // Accumulate tool calls during streaming
    const pendingToolCalls: ToolCall[] = []

    for await (const event of result.fullStream) {
      switch (event.type) {
        case 'error': {
          // Throw the error so RetryableContentGenerator can catch and retry it.
          // Yielding it as content would swallow the error and prevent retry logic
          // from working (e.g., for 429 rate limit errors).
          throw event.error instanceof Error ? event.error : new Error(String(event.error))
        }

        case 'finish-step': {
          yield {
            finishReason: mapFinishReason(event.finishReason, pendingToolCalls.length > 0),
            isComplete: true,
            toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
          }

          break
        }

        case 'reasoning-delta': {
          yield {
            isComplete: false,
            reasoning: event.text,
            reasoningId: event.id,
            type: StreamChunkType.THINKING,
          }

          break
        }

        case 'text-delta': {
          yield {
            content: event.text,
            isComplete: false,
            type: StreamChunkType.CONTENT,
          }

          break
        }

        case 'tool-call': {
          // Preserve thoughtSignature from providerMetadata (required by Gemini 3+ models)
          const meta = event.providerMetadata as Record<string, Record<string, unknown>> | undefined
          const thoughtSig = meta?.google?.thoughtSignature
          pendingToolCalls.push({
            function: {
              arguments: JSON.stringify(event.input),
              name: event.toolName,
            },
            id: event.toolCallId,
            ...(typeof thoughtSig === 'string' && {thoughtSignature: thoughtSig}),
            type: 'function',
          })

          break
        }

        default: {
          // Ignore other events (tool-input-start/delta/end, source, file, etc.)
          break
        }
      }
    }
  }
}

/**
 * Map AI SDK finish reason to our finish reason format.
 */
function mapFinishReason(
  aiReason: string,
  hasToolCalls: boolean,
): GenerateContentResponse['finishReason'] {
  if (hasToolCalls) {
    return 'tool_calls'
  }

  switch (aiReason) {
    case 'error': {
      return 'error'
    }

    case 'length': {
      return 'max_tokens'
    }

    case 'stop': {
      return 'stop'
    }

    case 'tool-calls': {
      return 'tool_calls'
    }

    default: {
      return 'stop'
    }
  }
}
