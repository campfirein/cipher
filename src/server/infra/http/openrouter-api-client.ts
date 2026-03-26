/**
 * OpenRouter API Client
 *
 * Handles API calls to OpenRouter for:
 * - Fetching available models
 * - Validating API keys
 *
 * Uses the OpenRouter REST API: https://openrouter.ai/api/v1
 */

import axios, {isAxiosError} from 'axios'

import type {ProviderDefinition} from '../../core/domain/entities/provider-registry.js'

import {ProxyConfig} from './proxy-config.js'

/**
 * OpenRouter model from the /models endpoint.
 * Based on: https://openrouter.ai/docs#models
 */
export interface OpenRouterModel {
  /** Supported modalities */
  architecture?: {
    instruct_type?: string
    modality: string // e.g., 'text->text', 'text+image->text'
    tokenizer: string
  }
  /** Context length (max tokens) */
  context_length: number
  /** Description */
  description?: string
  /** Model ID (e.g., 'anthropic/claude-3.5-sonnet') */
  id: string
  /** Display name */
  name: string
  /** Per-request limits */
  per_request_limits?: {
    completion_tokens?: string
    prompt_tokens?: string
  }
  /** Pricing per token (as string) */
  pricing: {
    completion: string // USD per output token (as string)
    prompt: string // USD per input token (as string)
  }
  /** Top provider info */
  top_provider?: {
    context_length?: number
    is_moderated?: boolean
    max_completion_tokens?: number
  }
}

/**
 * Response from OpenRouter /models endpoint.
 */
interface ModelsResponse {
  data: OpenRouterModel[]
}

/**
 * Normalized model for use in the application.
 */
export interface NormalizedModel {
  /** Context window size */
  contextLength: number
  /** Optional description */
  description?: string
  /** Model ID (e.g., 'anthropic/claude-3.5-sonnet') */
  id: string
  /** Whether this model is free */
  isFree: boolean
  /** Display name */
  name: string
  /** Pricing per million tokens */
  pricing: {
    inputPerM: number
    outputPerM: number
  }
  /** Provider name extracted from ID (e.g., 'anthropic') */
  provider: string
}

/**
 * Cache entry for models.
 */
interface ModelCache {
  models: NormalizedModel[]
  timestamp: number
}

/**
 * OpenRouter API client configuration.
 */
export interface OpenRouterApiClientConfig {
  /** Base URL for OpenRouter API */
  baseUrl?: string
  /** Cache TTL in milliseconds (default: 1 hour) */
  cacheTtlMs?: number
  /** HTTP Referer header */
  httpReferer?: string
  /** X-Title header */
  xTitle?: string
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_CACHE_TTL = 60 * 60 * 1000 // 1 hour

/**
 * OpenRouter API Client.
 *
 * Provides methods to interact with the OpenRouter API for fetching models
 * and validating API keys.
 *
 * @example
 * ```typescript
 * const client = new OpenRouterApiClient()
 *
 * // Validate API key
 * const isValid = await client.validateApiKey('sk-or-v1-...')
 *
 * // Fetch models
 * const models = await client.fetchModels('sk-or-v1-...')
 * ```
 */
export class OpenRouterApiClient {
  private readonly baseUrl: string
  private readonly cacheTtlMs: number
  private readonly httpReferer?: string
  private modelCache: ModelCache | undefined
  private readonly xTitle?: string

  public constructor(config: OpenRouterApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL
    this.httpReferer = config.httpReferer ?? 'https://byterover.dev'
    this.xTitle = config.xTitle ?? 'byterover-cli'
  }

  /**
   * Clears the model cache.
   */
  public clearCache(): void {
    this.modelCache = undefined
  }

  /**
   * Fetches available models from OpenRouter.
   * Results are cached for the configured TTL.
   *
   * @param apiKey - The API key to use
   * @param forceRefresh - If true, bypasses cache
   * @returns Array of normalized models
   */
  public async fetchModels(apiKey: string, forceRefresh = false): Promise<NormalizedModel[]> {
    // Check cache
    if (!forceRefresh && this.modelCache && Date.now() - this.modelCache.timestamp < this.cacheTtlMs) {
      return this.modelCache.models
    }

    const models = await this.fetchModelsInternal(apiKey)

    // Update cache
    this.modelCache = {
      models,
      timestamp: Date.now(),
    }

    return models
  }

  /**
   * Validates an API key by attempting to fetch models.
   *
   * @param apiKey - The API key to validate
   * @returns Object with isValid flag and optional error message
   */
  public async validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}> {
    try {
      await this.fetchModelsInternal(apiKey)
      return {isValid: true}
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response?.status === 401) {
          return {error: 'Invalid API key', isValid: false}
        }

        if (error.response?.status === 403) {
          return {error: 'API key does not have required permissions', isValid: false}
        }

        return {error: `API error: ${error.response?.statusText ?? error.message}`, isValid: false}
      }

      return {error: error instanceof Error ? error.message : 'Unknown error', isValid: false}
    }
  }

  /**
   * Internal method to fetch models from OpenRouter API.
   */
  private async fetchModelsInternal(apiKey: string): Promise<NormalizedModel[]> {
    const response = await axios.get<ModelsResponse>(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': this.httpReferer,
        'X-Title': this.xTitle,
      },
      httpAgent: ProxyConfig.getProxyAgent(),
      httpsAgent: ProxyConfig.getProxyAgent(),
      timeout: 30_000,
    })

    return response.data.data.map((model) => this.normalizeModel(model))
  }

  /**
   * Normalizes an OpenRouter model to our standard format.
   */
  private normalizeModel(model: OpenRouterModel): NormalizedModel {
    // Extract provider from model ID (e.g., 'anthropic' from 'anthropic/claude-3.5-sonnet')
    const [provider, ...nameParts] = model.id.split('/')
    const shortName = nameParts.join('/') || model.id

    // Parse pricing (convert from string to number)
    // OpenRouter returns price per token, multiply by 1M to get price per million tokens
    const inputPricePerToken = Number.parseFloat(model.pricing.prompt) || 0
    const outputPricePerToken = Number.parseFloat(model.pricing.completion) || 0
    const inputPerM = inputPricePerToken * 1_000_000
    const outputPerM = outputPricePerToken * 1_000_000

    // Check if free (both prices are 0)
    const isFree = inputPricePerToken === 0 && outputPricePerToken === 0

    return {
      contextLength: model.context_length,
      description: model.description,
      id: model.id,
      isFree,
      name: model.name || shortName,
      pricing: {
        inputPerM,
        outputPerM,
      },
      provider: `OpenRouter (${provider})`,
    }
  }
}

/**
 * Creates an OpenRouterApiClient configured from a provider definition.
 *
 * @param provider - Provider definition from the registry
 * @returns Configured OpenRouterApiClient
 */
export function createOpenRouterApiClient(provider: ProviderDefinition): OpenRouterApiClient {
  return new OpenRouterApiClient({
    baseUrl: provider.baseUrl || DEFAULT_BASE_URL,
    httpReferer: provider.headers['HTTP-Referer'],
    xTitle: provider.headers['X-Title'],
  })
}

/**
 * Singleton instance of the OpenRouter API client.
 */
let _openRouterApiClient: OpenRouterApiClient | undefined

/**
 * Gets or creates the singleton OpenRouter API client.
 */
export function getOpenRouterApiClient(): OpenRouterApiClient {
  if (!_openRouterApiClient) {
    _openRouterApiClient = new OpenRouterApiClient()
  }

  return _openRouterApiClient
}
