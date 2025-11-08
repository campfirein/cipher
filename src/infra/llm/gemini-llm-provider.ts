import type {Content, GenerateContentConfig, GenerateContentResponse} from '@google/genai'

import {GoogleGenAI} from '@google/genai'

/**
 * Gemini-specific configuration.
 * Pure API client configuration without tool execution concerns.
 */
export interface GeminiProviderConfig {
  apiKey: string
  maxTokens?: number
  model?: string
  temperature?: number
  timeout?: number
}

/**
 * Google Gemini API client.
 *
 * Pure API client responsible only for calling the Gemini API.
 * Does NOT handle:
 * - Agentic loops (moved to GeminiLLMService)
 * - Tool execution (moved to ToolManager via service)
 * - Message history management (moved to ContextManager)
 *
 * This is a thin wrapper around GoogleGenAI SDK.
 */
export class GeminiLlmProvider {
  private readonly client: GoogleGenAI
  private readonly config: Required<Omit<GeminiProviderConfig, 'timeout'>> & {timeout?: number}

  public constructor(config: GeminiProviderConfig) {
    this.config = {
      apiKey: config.apiKey,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'gemini-2.5-flash',
      temperature: config.temperature ?? 0.7,
      timeout: config.timeout,
    }

    this.client = new GoogleGenAI({apiKey: this.config.apiKey})
  }

  /**
   * Call Gemini API to generate content.
   *
   * Simple, single API call - no loop, no tool execution.
   * The service layer handles the agentic loop.
   *
   * @param contents - Formatted messages in Gemini format
   * @param config - Generation configuration including tools
   * @param model - Model to use (optional, uses default if not provided)
   * @returns Raw Gemini API response
   */
  public async generateContent(
    contents: Content[],
    config: GenerateContentConfig,
    model?: string,
  ): Promise<GenerateContentResponse> {
    const modelToUse = model ?? this.config.model

    return this.client.models.generateContent({
      config,
      contents,
      model: modelToUse,
    })
  }

  /**
   * Get the default model name.
   */
  public getModel(): string {
    return this.config.model
  }

  /**
   * Get the temperature setting.
   */
  public getTemperature(): number {
    return this.config.temperature
  }
}
