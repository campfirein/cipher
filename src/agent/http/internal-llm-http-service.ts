// @ts-expect-error - Internal SDK path not exported in package.json, but exists and works at runtime
import type {RequestOptions} from '@anthropic-ai/sdk/internal/request-options'
import type {MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages.js'
import type {Content, GenerateContentConfig, GenerateContentResponse} from '@google/genai'

import {AuthenticatedHttpClient} from '../../infra/http/authenticated-http-client.js'

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
 */
export interface ByteRoverHttpConfig {
  accessToken: string
  apiBaseUrl: string
  projectId?: string
  region?: string
  sessionKey: string
  spaceId: string
  teamId: string
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
    projectId: string
  }

  /**
   * Initialize a new ByteRover HTTP LLM service client.
   *
   * Sets up configuration with sensible defaults:
   * - projectId defaults to 'byterover'
   * - region defaults to 'us-east1' (can be overridden per request)
   * - timeout defaults to 60 seconds
   *
   * @param config - HTTP client configuration (accessToken, apiBaseUrl, sessionKey, optional: projectId, region, timeout)
   */
  public constructor(config: ByteRoverHttpConfig) {
    this.config = {
      accessToken: config.accessToken,
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
      project_id: this.config.projectId,
      provider: this.detectProviderFromModel(model),
      region: this.detectRegionFromModel(model),
      spaceId: this.config.spaceId,
      teamId: this.config.teamId,
    }

    return this.callHttpGenerate(request)
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
    const httpClient = new AuthenticatedHttpClient(this.config.accessToken, this.config.sessionKey)

    const response = await httpClient.post<GenerateResponse>(url, request, {
      timeout: this.config.timeout,
    })

    return response.data
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
}
