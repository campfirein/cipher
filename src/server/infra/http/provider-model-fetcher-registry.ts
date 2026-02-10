/**
 * Provider Model Fetcher Registry
 *
 * Maps provider IDs to their model fetcher implementations.
 * Lazily instantiated singletons for each provider.
 */

import type {IProviderModelFetcher} from '../../core/interfaces/i-provider-model-fetcher.js'

import {PROVIDER_REGISTRY} from '../../core/domain/entities/provider-registry.js'
import {FileProviderConfigStore} from '../storage/file-provider-config-store.js'
import {
  AnthropicModelFetcher,
  ChatBasedModelFetcher,
  GoogleModelFetcher,
  GoogleVertexModelFetcher,
  OpenAICompatibleModelFetcher,
  OpenAIModelFetcher,
  OpenRouterModelFetcher,
} from './provider-model-fetchers.js'

/**
 * Singleton instances of model fetchers, lazily created.
 */
const fetchers = new Map<string, IProviderModelFetcher>()

/**
 * Get or create a model fetcher for a provider.
 *
 * @param providerId - Provider identifier (e.g., 'anthropic', 'openai', 'google')
 * @returns IProviderModelFetcher instance, or undefined if provider doesn't support model fetching
 */
export async function getModelFetcher(providerId: string): Promise<IProviderModelFetcher | undefined> {
  // ByteRover internal doesn't support model fetching
  if (providerId === 'byterover') return undefined

  // Return cached instance
  if (fetchers.has(providerId)) {
    return fetchers.get(providerId)
  }

  // Create fetcher based on provider ID
  let fetcher: IProviderModelFetcher | undefined

  switch (providerId) {
    case 'anthropic': {
      fetcher = new AnthropicModelFetcher()

      break
    }

    case 'cerebras': // falls through
    case 'cohere': // falls through
    case 'deepinfra': // falls through
    case 'groq': // falls through
    case 'mistral': // falls through
    case 'togetherai': // falls through
    case 'xai': {
      const provider = PROVIDER_REGISTRY[providerId]
      if (provider?.baseUrl) {
        fetcher = new OpenAICompatibleModelFetcher(provider.baseUrl, provider.name)
      }

      break
    }

    case 'google': {
      fetcher = new GoogleModelFetcher()

      break
    }

    case 'google-vertex': {
      fetcher = new GoogleVertexModelFetcher()

      break
    }

    case 'openai': {
      fetcher = new OpenAIModelFetcher()

      break
    }

    case 'openai-compatible': {
      // Base URL is user-configured — read from stored provider config
      const configStore = new FileProviderConfigStore()
      const config = await configStore.read()
      const baseUrl = config.getBaseUrl('openai-compatible')
      if (baseUrl) {
        fetcher = new OpenAICompatibleModelFetcher(baseUrl, 'OpenAI Compatible')
      }

      break
    }

    case 'openrouter': {
      fetcher = new OpenRouterModelFetcher()

      break
    }

    case 'perplexity': {
      fetcher = new ChatBasedModelFetcher(
        'https://api.perplexity.ai',
        'Perplexity',
        ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research', 'r1-1776'],
      )

      break
    }

    case 'vercel': {
      fetcher = new ChatBasedModelFetcher(
        'https://api.v0.dev/v1',
        'Vercel',
        ['v0-1.0-md', 'v0-1.5-md', 'v0-1.5-lg'],
      )

      break
    }
  }

  if (fetcher) {
    fetchers.set(providerId, fetcher)
  }

  return fetcher
}

/**
 * Clear all cached fetcher instances.
 * Useful for testing or when provider configs change.
 */
export function clearModelFetcherCache(): void {
  fetchers.clear()
}

/**
 * Validate an API key for a specific provider.
 * Convenience function that gets the right fetcher and validates.
 *
 * @param apiKey - API key to validate
 * @param providerId - Provider identifier
 * @returns Validation result, or {isValid: false} if no fetcher exists
 */
export async function validateApiKey(
  apiKey: string,
  providerId: string,
): Promise<{error?: string; isValid: boolean}> {
  const fetcher = await getModelFetcher(providerId)
  if (!fetcher) {
    return {error: `No model fetcher available for provider: ${providerId}`, isValid: false}
  }

  return fetcher.validateApiKey(apiKey)
}
