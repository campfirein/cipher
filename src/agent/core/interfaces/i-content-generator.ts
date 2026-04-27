/**
 * Content Generator interface for LLM providers.
 *
 * This interface provides a unified abstraction for all LLM backends,
 * enabling the decorator pattern for cross-cutting concerns like:
 * - Logging
 * - Retry with backoff
 * - Recording/replay (future)
 *
 * Based on gemini-cli's ContentGenerator pattern.
 */

import type {ToolSet} from '../domain/tools/types.js'
import type {ExecutionContext} from './i-cipher-agent.js'
import type {InternalMessage, ToolCall} from './message-types.js'

/**
 * Stream chunk type for distinguishing content types during streaming.
 */
export enum StreamChunkType {
  /** Regular text content */
  CONTENT = 'content',
  /** Thinking/reasoning content from models like Gemini */
  THINKING = 'thinking',
  /** Tool call request */
  TOOL_CALL = 'tool_call',
}

/**
 * Configuration for content generation.
 */
export interface GenerationConfig {
  /** Maximum tokens in the response */
  maxTokens?: number
  /** Temperature for randomness (0-1) */
  temperature?: number
  /** Top-K sampling parameter */
  topK?: number
  /** Top-P (nucleus) sampling parameter */
  topP?: number
}

/**
 * Request to generate content from an LLM.
 */
export interface GenerateContentRequest {
  /** Generation configuration */
  config: GenerationConfig
  /** Conversation history */
  contents: InternalMessage[]
  /** Optional execution context */
  executionContext?: ExecutionContext
  /** Model identifier */
  model: string
  /** Optional system prompt */
  systemPrompt?: string
  /** Tracking task ID for backend billing metrics (random UUID per request) */
  taskId: string
  /** Available tools for function calling */
  tools?: ToolSet
}

/**
 * Response from content generation.
 */
export interface GenerateContentResponse {
  /** Generated text content */
  content: string
  /** Reason why generation stopped */
  finishReason: 'error' | 'max_tokens' | 'stop' | 'tool_calls'
  /** Raw response from provider (for debugging) */
  rawResponse?: unknown
  /** Tool calls requested by the model */
  toolCalls?: ToolCall[]
  /** Token usage statistics (provider-reported, not estimated) */
  usage?: {
    /** Tokens written to cache on first call (Anthropic cache_creation_input_tokens). 0 if no cache. */
    cacheCreationTokens?: number
    /** Tokens read from cache (Anthropic cache_read_input_tokens, Gemini cachedContentTokenCount). 0 if no cache. */
    cacheReadTokens?: number
    /** Tokens consumed from the prompt/input */
    inputTokens: number
    /** Tokens generated in the response */
    outputTokens: number
    /** Tokens spent on reasoning/thinking (where the provider exposes it separately) */
    reasoningTokens?: number
    /** Sum of input + output (provider may report as a separate number) */
    totalTokens: number
  }
}

/**
 * Chunk of streaming content generation.
 */
export interface GenerateContentChunk {
  /** Incremental text content */
  content?: string
  /** Reason why generation stopped (only on final chunk) */
  finishReason?: 'error' | 'max_tokens' | 'stop' | 'tool_calls'
  /** Whether this is the final chunk */
  isComplete: boolean
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>
  /**
   * Raw API chunk data for native reasoning extraction.
   * Used by models that return reasoning in native fields (OpenAI, Grok, Gemini).
   */
  rawChunk?: unknown
  /**
   * Incremental reasoning/thinking content.
   * For models that provide native reasoning fields (OpenAI o1/o3, Grok, Gemini).
   */
  reasoning?: string
  /** Unique ID for the reasoning block (for tracking across deltas) */
  reasoningId?: string
  /** Tool calls (only on final chunk or when complete) */
  toolCalls?: ToolCall[]
  /**
   * Type of this chunk for distinguishing content from thinking.
   * Defaults to CONTENT if not specified.
   */
  type?: StreamChunkType
  /**
   * Provider-reported token usage. Only present on the final chunk
   * (or a dedicated usage chunk) emitted at end of stream. Same shape
   * as `GenerateContentResponse.usage`.
   */
  usage?: {
    cacheCreationTokens?: number
    cacheReadTokens?: number
    inputTokens: number
    outputTokens: number
    reasoningTokens?: number
    totalTokens: number
  }
}

/**
 * Content Generator interface.
 *
 * All LLM providers implement this interface, enabling:
 * - Consistent API across providers
 * - Decorator pattern for cross-cutting concerns
 * - Easy testing with fake implementations
 */
export interface IContentGenerator {
  /**
   * Estimate tokens synchronously (fast, local).
   *
   * Uses a simple estimation algorithm for quick token counting.
   * May not be perfectly accurate but is fast and doesn't require API calls.
   *
   * @param content - Text to estimate tokens for
   * @returns Estimated token count
   */
  estimateTokensSync(content: string): number

  /**
   * Generate content (non-streaming).
   *
   * @param request - Generation request
   * @returns Generated content response
   */
  generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse>

  /**
   * Generate content with streaming.
   *
   * Yields chunks as they are generated, allowing for
   * progressive display of responses.
   *
   * @param request - Generation request
   * @returns Async generator yielding content chunks
   */
  generateContentStream(request: GenerateContentRequest): AsyncGenerator<GenerateContentChunk>
}
