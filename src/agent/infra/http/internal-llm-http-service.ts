// @ts-expect-error - Internal SDK path not exported in package.json, but exists and works at runtime
import type {RequestOptions} from '@anthropic-ai/sdk/internal/request-options'
import type {MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages.js'
import type {Content, GenerateContentConfig, GenerateContentResponse} from '@google/genai'

import {AuthenticatedHttpClient} from '../../../server/infra/http/authenticated-http-client.js'
import {GenerateContentChunk, StreamChunkType} from '../../core/interfaces/i-content-generator.js'
import {ThoughtParser} from '../llm/thought-parser.js'

/* eslint-disable camelcase */

/**
 * Generation parameters sent to REST backend.
 * Note: contents and config are sent as JSON strings for proper serialization.
 */
type GenerateParams = {
  config: GenerateContentConfig | RequestOptions
  contents: Content[] | MessageCreateParamsNonStreaming
  model: string
}

/**
 * Generate request sent to ByteRover REST API.
 */
type GenerateRequest = {
  executionMetadata?: string
  params: GenerateParams
  project_id: string
  provider: 'claude' | 'gemini'
  region: string
  spaceId: string
  teamId: string
}

/**
 * Generate response from ByteRover REST API.
 */
type GenerateResponse = {
  data: GenerateContentResponse
}

/**
 * ByteRover HTTP LLM provider configuration.
 *
 * projectId, sessionKey, spaceId, teamId accept either a static string or a provider function.
 * Provider functions are resolved lazily on each HTTP request,
 * so long-lived agents always get the latest values from the StateServer.
 */
export interface ByteRoverHttpConfig {
  apiBaseUrl: string
  projectId?: (() => string) | string
  region?: string
  sessionKey: (() => string) | string
  spaceId: (() => string) | string
  teamId: (() => string) | string
  timeout?: number
}

/**
 * ByteRover HTTP LLM API client.
 *
 * Simple wrapper around ByteRover REST LLM service.
 * Delegates prompt building and formatting to service layer.
 *
 * Responsibilities:
 * - Call the remote REST API
 * - Handle HTTP responses
 * - Convert to GenerateContentResponse format
 *
 * Does NOT:
 * - Build prompts or format inputs
 * - Parse or manipulate response content
 * - Handle tool call parsing from text
 */
export class ByteRoverLlmHttpService {
  private readonly config: Required<Omit<ByteRoverHttpConfig, 'projectId'>> & {
    projectId: (() => string) | string
  }

  /**
   * Initialize a new ByteRover HTTP LLM service client.
   *
   * Sets up configuration with sensible defaults:
   * - projectId defaults to 'byterover'
   * - region defaults to 'us-east1' (can be overridden per request)
   * - timeout defaults to 60 seconds
   *
   * @param config - HTTP client configuration (apiBaseUrl, sessionKey, optional: projectId, region, timeout)
   */
  public constructor(config: ByteRoverHttpConfig) {
    this.config = {
      apiBaseUrl: config.apiBaseUrl,
      projectId: config.projectId ?? 'byterover',
      region: config.region ?? 'us-east1',
      sessionKey: config.sessionKey,
      spaceId: config.spaceId,
      teamId: config.teamId,
      timeout: config.timeout ?? 60_000,
    }
  }

  /**
   * Call ByteRover REST LLM service to generate content.
   *
   * Simple forward to remote REST API - delegates all formatting to backend.
   * Supports both Gemini and Claude formats - the correct format is determined
   * automatically based on the model name.
   *
   * Parameter structure differs by provider:
   * - Gemini: contents = Content[], config = GenerateContentConfig
   * - Claude: contents = MessageCreateParamsNonStreaming (complete body), config = RequestOptions (HTTP options)
   *
   * @param contents - For Gemini: Content[]. For Claude: MessageCreateParamsNonStreaming (complete body)
   * @param config - For Gemini: GenerateContentConfig. For Claude: RequestOptions (optional HTTP options)
   * @param model - Model to use (detects provider from model name)
   * @param executionMetadata - Optional execution metadata (mode, executionContext)
   * @returns Response in GenerateContentResponse format
   */
  public async generateContent(
    contents: Content[] | MessageCreateParamsNonStreaming,
    config: GenerateContentConfig | RequestOptions,
    model: string,
    executionMetadata?: Record<string, unknown>,
  ): Promise<GenerateContentResponse> {
    const request: GenerateRequest = {
      executionMetadata: JSON.stringify(executionMetadata ?? {}),
      params: {
        config,
        contents,
        model,
      },
      project_id: typeof this.config.projectId === 'function' ? this.config.projectId() : this.config.projectId,
      provider: this.detectProviderFromModel(model),
      region: this.detectRegionFromModel(model),
      spaceId: typeof this.config.spaceId === 'function' ? this.config.spaceId() : this.config.spaceId,
      teamId: typeof this.config.teamId === 'function' ? this.config.teamId() : this.config.teamId,
    }

    return this.callHttpGenerate(request)
  }

  /**
   * Call ByteRover REST LLM service to generate content with streaming.
   *
   * Currently falls back to non-streaming endpoint since /api/llm/generate/stream
   * doesn't exist on the backend yet. Extracts thinking/reasoning from the complete
   * response and yields them as separate chunks.
   *
   * When backend streaming is available, this will use SSE for true streaming.
   *
   * @param contents - For Gemini: Content[]. For Claude: MessageCreateParamsNonStreaming (complete body)
   * @param config - For Gemini: GenerateContentConfig. For Claude: RequestOptions (optional HTTP options)
   * @param model - Model to use (detects provider from model name)
   * @param executionMetadata - Optional execution metadata (mode, executionContext)
   * @yields GenerateContentChunk objects as they are generated
   */
  public async *generateContentStream(
    contents: Content[] | MessageCreateParamsNonStreaming,
    config: GenerateContentConfig | RequestOptions,
    model: string,
    executionMetadata?: Record<string, unknown>,
  ): AsyncGenerator<GenerateContentChunk> {
    // Fall back to non-streaming endpoint and simulate streaming
    // by extracting thinking from the complete response
    const response = await this.generateContent(contents, config, model, executionMetadata)

    // Extract and yield thinking/reasoning chunks first
    yield* this.extractThinkingFromResponse(response)

    // Then yield the final content
    yield* this.extractContentFromResponse(response)
  }

  /**
   * Call the ByteRover REST Generate endpoint.
   *
   * Handles authentication headers and error handling.
   *
   * @param request - The REST generate request with model, provider, region, and params
   * @returns Promise resolving to the complete LLM response
   * @throws Error if the request fails
   */
  private async callHttpGenerate(request: GenerateRequest): Promise<GenerateContentResponse> {
    const url = `${this.config.apiBaseUrl}/api/llm/generate`
    const sessionKey = typeof this.config.sessionKey === 'function' ? this.config.sessionKey() : this.config.sessionKey
    const httpClient = new AuthenticatedHttpClient(sessionKey)

    const httpResponse = await httpClient.post<GenerateResponse>(url, request, {
      timeout: this.config.timeout,
    })

    return httpResponse.data
  }

  /**
   * Detect LLM provider from model identifier.
   *
   * Determines which provider (Claude or Gemini) to use based on the model name.
   * Defaults to Gemini if the model doesn't match Claude patterns.
   *
   * @param model - Model identifier (e.g., 'claude-3-5-sonnet', 'gemini-2.5-flash')
   * @returns Provider name: 'claude' or 'gemini'
   */
  private detectProviderFromModel(model: string): 'claude' | 'gemini' {
    return model.toLowerCase().startsWith('claude') ? 'claude' : 'gemini'
  }

  /**
   * Detect appropriate GCP region from model identifier.
   *
   * Routes Claude models to us-east5 and Gemini models to global.
   * This ensures compatibility with the provider's available regions on Vertex AI.
   *
   * @param model - Model identifier (e.g., 'claude-3-5-sonnet', 'gemini-2.5-flash')
   * @returns GCP region identifier ('us-east5' or 'global')
   */
  private detectRegionFromModel(model: string): string {
    return model.toLowerCase().startsWith('claude') ? 'us-east5' : 'global'
  }

  /**
   * Extract content chunks from a complete response.
   *
   * Looks for text parts (excluding thinking) and function calls,
   * yields them as final chunks.
   *
   * @param response - Complete GenerateContentResponse
   * @yields GenerateContentChunk for content and tool calls
   */
  private *extractContentFromResponse(response: GenerateContentResponse): Generator<GenerateContentChunk> {
    const {candidates} = response
    if (!candidates || candidates.length === 0) {
      yield {
        content: '',
        finishReason: 'stop',
        isComplete: true,
      }
      return
    }

    const candidate = candidates[0]
    const parts = candidate?.content?.parts
    const finishReason = this.mapFinishReason((candidate as {finishReason?: string})?.finishReason ?? 'STOP')

    if (!parts || parts.length === 0) {
      yield {
        content: '',
        finishReason,
        isComplete: true,
      }
      return
    }

    // Collect text content (excluding thinking parts)
    const textParts: string[] = []
    const functionCalls: Array<{args?: Record<string, unknown>; name?: string}> = []

    for (const part of parts) {
      const partRecord = part as Record<string, unknown>

      // Skip thinking parts
      if (partRecord.thought === true) continue

      // Collect text
      if (partRecord.text && typeof partRecord.text === 'string') {
        textParts.push(partRecord.text)
      }

      // Collect function calls
      if (partRecord.functionCall) {
        functionCalls.push(partRecord.functionCall as {args?: Record<string, unknown>; name?: string})
      }
    }

    // Yield final content chunk
    yield {
      content: textParts.join('').trimEnd(),
      finishReason,
      isComplete: true,
      toolCalls:
        functionCalls.length > 0
          ? functionCalls.map((fc, index) => ({
              function: {
                arguments: JSON.stringify(fc.args ?? {}),
                name: fc.name ?? '',
              },
              id: `call_${Date.now()}_${index}`,
              type: 'function' as const,
            }))
          : undefined,
    }
  }

  /**
   * Extract thinking/reasoning chunks from a complete response.
   *
   * Looks for parts with `thought: true` and yields them as THINKING chunks.
   *
   * @param response - Complete GenerateContentResponse
   * @yields GenerateContentChunk for each thinking part
   */
  private *extractThinkingFromResponse(response: GenerateContentResponse): Generator<GenerateContentChunk> {
    const {candidates} = response
    if (!candidates || candidates.length === 0) return

    const parts = candidates[0]?.content?.parts
    if (!parts) return

    let thinkingSubject: string | undefined

    for (const part of parts) {
      const partRecord = part as Record<string, unknown>

      // Check for thinking part (thought: true)
      if (partRecord.thought === true && partRecord.text && typeof partRecord.text === 'string') {
        const delta = partRecord.text

        // Extract subject from **Subject** markdown if not already found
        if (!thinkingSubject && delta) {
          const parsed = ThoughtParser.parse(delta)
          if (parsed.subject) {
            thinkingSubject = parsed.subject
          }
        }

        yield {
          isComplete: false,
          providerMetadata: {
            subject: thinkingSubject,
          },
          reasoning: delta.trimEnd(),
          type: StreamChunkType.THINKING,
        }
      }
    }
  }

  /**
   * Map provider finish reason to standard format.
   */
  private mapFinishReason(reason: string): 'error' | 'max_tokens' | 'stop' | 'tool_calls' {
    switch (reason.toUpperCase()) {
      case 'FUNCTION_CALL':
      case 'TOOL_CALLS': {
        return 'tool_calls'
      }

      case 'LENGTH':
      case 'MAX_TOKENS': {
        return 'max_tokens'
      }

      case 'STOP': {
        return 'stop'
      }

      default: {
        return 'stop'
      }
    }
  }
}
