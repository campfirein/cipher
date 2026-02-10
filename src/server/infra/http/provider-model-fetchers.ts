/**
 * Provider Model Fetcher Implementations
 *
 * Implements IProviderModelFetcher for each supported LLM provider:
 * - AnthropicModelFetcher: Uses @anthropic-ai/sdk
 * - OpenAIModelFetcher: Uses openai SDK
 * - GoogleModelFetcher: Uses @google/genai SDK
 * - OpenAICompatibleModelFetcher: Generic for xAI/Groq/Mistral (REST API)
 * - OpenRouterModelFetcher: Wraps existing OpenRouterApiClient
 */

import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import Anthropic from '@anthropic-ai/sdk'
import {GoogleGenAI} from '@google/genai'
import {APICallError, generateText} from 'ai'
import axios, {isAxiosError} from 'axios'
import OpenAI from 'openai'

import type {IProviderModelFetcher, ProviderModelInfo} from '../../core/interfaces/i-provider-model-fetcher.js'

// ============================================================================
// Cache helper
// ============================================================================

interface ModelCache {
  models: ProviderModelInfo[]
  timestamp: number
}

const DEFAULT_CACHE_TTL = 60 * 60 * 1000 // 1 hour

// ============================================================================
// Anthropic Model Fetcher
// ============================================================================

/**
 * Fetches models from Anthropic using the official SDK.
 */
export class AnthropicModelFetcher implements IProviderModelFetcher {
  private cache: ModelCache | undefined
  private readonly cacheTtlMs: number

  constructor(cacheTtlMs = DEFAULT_CACHE_TTL) {
    this.cacheTtlMs = cacheTtlMs
  }

  async fetchModels(apiKey: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.models
    }

    const client = new Anthropic({apiKey})
    const models: ProviderModelInfo[] = []

    // Anthropic models.list() returns a paginated list
    for await (const model of client.models.list()) {
      models.push({
        contextLength: 200_000, // Anthropic models typically have 200k context
        description: model.display_name,
        id: model.id,
        isFree: false,
        name: model.display_name,
        pricing: {inputPerM: 0, outputPerM: 0}, // Anthropic doesn't expose pricing via API
        provider: 'Anthropic',
      })
    }

    this.cache = {models, timestamp: Date.now()}
    return models
  }

  async validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}> {
    try {
      const provider = createAnthropic({apiKey})
      await generateText({
        maxOutputTokens: 1,
        maxRetries: 0,
        messages: [{content: 'hi', role: 'user'}],
        model: provider('claude-3-haiku-20240307'),
      })

      return {isValid: true}
    } catch (error: unknown) {
      return handleAiSdkValidationError(error)
    }
  }
}

// ============================================================================
// OpenAI Model Fetcher
// ============================================================================

/**
 * Fetches models from OpenAI using the official SDK.
 */
export class OpenAIModelFetcher implements IProviderModelFetcher {
  private cache: ModelCache | undefined
  private readonly cacheTtlMs: number

  constructor(cacheTtlMs = DEFAULT_CACHE_TTL) {
    this.cacheTtlMs = cacheTtlMs
  }

  async fetchModels(apiKey: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.models
    }

    const client = new OpenAI({apiKey})
    const models: ProviderModelInfo[] = []

    // Fetch all models and filter for chat-capable ones
    for await (const model of client.models.list()) {
      // Filter: only include GPT, O-series, and chat models
      const id = model.id.toLowerCase()
      if (
        id.startsWith('gpt-') ||
        id.startsWith('o1') ||
        id.startsWith('o3') ||
        id.startsWith('o4') ||
        id.startsWith('chatgpt')
      ) {
        models.push({
          contextLength: this.estimateContextLength(model.id),
          id: model.id,
          isFree: false,
          name: model.id,
          pricing: {inputPerM: 0, outputPerM: 0}, // OpenAI doesn't expose pricing via list API
          provider: 'OpenAI',
        })
      }
    }

    // Sort by ID for consistent ordering
    models.sort((a, b) => a.id.localeCompare(b.id))

    this.cache = {models, timestamp: Date.now()}
    return models
  }

  async validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}> {
    try {
      const provider = createOpenAI({apiKey})
      await generateText({
        maxOutputTokens: 1,
        maxRetries: 0,
        messages: [{content: 'hi', role: 'user'}],
        model: provider.responses('gpt-4o-mini'),
      })

      return {isValid: true}
    } catch (error: unknown) {
      return handleAiSdkValidationError(error)
    }
  }

  private estimateContextLength(modelId: string): number {
    const id = modelId.toLowerCase()
    if (id.includes('gpt-4.1')) return 1_047_576
    if (id.includes('gpt-4o')) return 128_000
    if (id.includes('gpt-4-turbo')) return 128_000
    if (id.includes('gpt-4')) return 8192
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return 200_000
    return 128_000
  }
}

// ============================================================================
// Google Model Fetcher
// ============================================================================

/**
 * Fetches models from Google using the @google/genai SDK.
 */
export class GoogleModelFetcher implements IProviderModelFetcher {
  private cache: ModelCache | undefined
  private readonly cacheTtlMs: number

  constructor(cacheTtlMs = DEFAULT_CACHE_TTL) {
    this.cacheTtlMs = cacheTtlMs
  }

  async fetchModels(apiKey: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.models
    }

    const client = new GoogleGenAI({apiKey})
    const models: ProviderModelInfo[] = []

    // Google GenAI SDK list models
    const pager = await client.models.list()
    for (const model of pager.page) {
      // Filter for generateContent-capable models (chat/completion models)
      if (!model.supportedActions?.includes('generateContent')) continue

      const id = model.name?.replace('models/', '') ?? ''
      models.push({
        contextLength: model.inputTokenLimit ?? 1_000_000,
        description: model.description ?? undefined,
        id,
        isFree: false,
        name: model.displayName ?? id,
        pricing: {inputPerM: 0, outputPerM: 0}, // Google doesn't expose pricing via API
        provider: 'Google',
      })
    }

    this.cache = {models, timestamp: Date.now()}
    return models
  }

  async validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}> {
    try {
      const client = new GoogleGenAI({apiKey})
      await client.models.list()
      return {isValid: true}
    } catch (error: unknown) {
      return handleSdkValidationError(error)
    }
  }
}

// ============================================================================
// Google Vertex AI Model Fetcher
// ============================================================================

/**
 * Fetches models from Google Vertex AI using the @google/genai SDK with vertexai mode.
 * Uses Application Default Credentials (ADC) instead of API keys.
 */
export class GoogleVertexModelFetcher implements IProviderModelFetcher {
  private cache: ModelCache | undefined
  private readonly cacheTtlMs: number

  constructor(cacheTtlMs = DEFAULT_CACHE_TTL) {
    this.cacheTtlMs = cacheTtlMs
  }

  async fetchModels(_apiKey: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.models
    }

    const project = process.env.GOOGLE_CLOUD_PROJECT
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
    const client = new GoogleGenAI({location, project, vertexai: true})
    const models: ProviderModelInfo[] = []

    const pager = await client.models.list()
    for (const model of pager.page) {
      if (!model.supportedActions?.includes('generateContent')) continue

      const id = model.name?.replace('models/', '') ?? ''
      models.push({
        contextLength: model.inputTokenLimit ?? 1_000_000,
        description: model.description ?? undefined,
        id,
        isFree: false,
        name: model.displayName ?? id,
        pricing: {inputPerM: 0, outputPerM: 0},
        provider: 'Google Vertex AI',
      })
    }

    this.cache = {models, timestamp: Date.now()}
    return models
  }

  async validateApiKey(_apiKey: string): Promise<{error?: string; isValid: boolean}> {
    try {
      const project = process.env.GOOGLE_CLOUD_PROJECT
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
      const client = new GoogleGenAI({location, project, vertexai: true})
      await client.models.list()
      return {isValid: true}
    } catch (error: unknown) {
      return handleSdkValidationError(error)
    }
  }
}

// ============================================================================
// OpenAI-Compatible Model Fetcher (xAI, Groq, Mistral)
// ============================================================================

/**
 * Generic model fetcher for OpenAI-compatible APIs.
 * Works with xAI (Grok), Groq, and Mistral.
 */
export class OpenAICompatibleModelFetcher implements IProviderModelFetcher {
  private readonly baseUrl: string
  private cache: ModelCache | undefined
  private readonly cacheTtlMs: number
  private readonly providerName: string

  constructor(baseUrl: string, providerName: string, cacheTtlMs = DEFAULT_CACHE_TTL) {
    this.baseUrl = baseUrl
    this.providerName = providerName
    this.cacheTtlMs = cacheTtlMs
  }

  async fetchModels(apiKey: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.models
    }

    const response = await axios.get<{data: Array<{id: string; object?: string}>}>(
      `${this.baseUrl}/models`,
      {
        headers: {Authorization: `Bearer ${apiKey}`},
        timeout: 30_000,
      },
    )

    const models: ProviderModelInfo[] = response.data.data.map((model) => ({
      contextLength: 128_000, // Default; most modern models have at least 128k
      id: model.id,
      isFree: false,
      name: model.id,
      pricing: {inputPerM: 0, outputPerM: 0},
      provider: this.providerName,
    }))

    // Sort by ID
    models.sort((a, b) => a.id.localeCompare(b.id))

    this.cache = {models, timestamp: Date.now()}
    return models
  }

  async validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}> {
    try {
      await axios.get(`${this.baseUrl}/models`, {
        headers: {Authorization: `Bearer ${apiKey}`},
        timeout: 15_000,
      })
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
}

// ============================================================================
// OpenRouter Model Fetcher (wraps existing client)
// ============================================================================

import {getOpenRouterApiClient, type NormalizedModel} from './openrouter-api-client.js'

/**
 * Model fetcher that wraps the existing OpenRouterApiClient.
 * Adapts NormalizedModel to ProviderModelInfo.
 */
export class OpenRouterModelFetcher implements IProviderModelFetcher {
  async fetchModels(apiKey: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    const client = getOpenRouterApiClient()
    const models = await client.fetchModels(apiKey, forceRefresh)
    return models.map((m: NormalizedModel) => ({
      contextLength: m.contextLength,
      description: m.description,
      id: m.id,
      isFree: m.isFree,
      name: m.name,
      pricing: m.pricing,
      provider: m.provider,
    }))
  }

  async validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}> {
    const client = getOpenRouterApiClient()
    return client.validateApiKey(apiKey)
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Handle AI SDK validation errors.
 * Uses APICallError.statusCode for reliable HTTP status-based detection
 * instead of fragile string matching on error messages.
 *
 * Only 401/403 mean the key is invalid. Other HTTP errors (429 rate limit,
 * 404 model not found, 500 server error) indicate the key was accepted
 * but the test request failed for another reason — key is valid.
 */
function handleAiSdkValidationError(error: unknown): {error?: string; isValid: boolean} {
  // AI SDK throws APICallError with statusCode for HTTP-level errors
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401) {
      return {error: 'Invalid API key', isValid: false}
    }

    if (error.statusCode === 403) {
      return {error: 'API key does not have required permissions', isValid: false}
    }

    // 429, 404, 500, etc. — key authenticated fine, request failed for other reasons
    return {isValid: true}
  }

  // Non-API errors (network, timeout, etc.) — can't determine key validity
  if (error instanceof Error) {
    return {error: error.message, isValid: false}
  }

  return {error: 'Unknown error', isValid: false}
}

/**
 * Handle SDK validation errors consistently across providers.
 */
function handleSdkValidationError(error: unknown): {error: string; isValid: boolean} {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid api key') || message.includes('authentication')) {
      return {error: `Authentication failed: ${error.message}`, isValid: false}
    }

    if (message.includes('403') || message.includes('forbidden') || message.includes('permission')) {
      return {error: `Permission denied: ${error.message}`, isValid: false}
    }

    return {error: error.message, isValid: false}
  }

  return {error: 'Unknown error', isValid: false}
}
