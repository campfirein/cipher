/**
 * Provider Model Fetcher Interface
 *
 * Defines the contract for fetching models from LLM providers.
 * Each provider implements this to enable model listing and API key validation.
 */

/**
 * Normalized model info returned by all provider fetchers.
 * Compatible with the existing NormalizedModel from OpenRouter client.
 */
export interface ProviderModelInfo {
  /** Capabilities (optional, provider-specific) */
  capabilities?: {streaming?: boolean; tools?: boolean; vision?: boolean}
  /** Context window size in tokens */
  contextLength: number
  /** Optional description */
  description?: string
  /** Model identifier (e.g., 'claude-sonnet-4-5-20250929', 'gpt-4.1') */
  id: string
  /** Whether this model is free to use */
  isFree: boolean
  /** Display name */
  name: string
  /** Pricing per million tokens (USD) */
  pricing: {
    inputPerM: number
    outputPerM: number
  }
  /** Provider name (e.g., 'Anthropic', 'OpenAI') */
  provider: string
}

/**
 * Interface for provider-specific model fetching.
 *
 * Implementations handle the specifics of each provider's API
 * and normalize the results to a common format.
 */
export interface IProviderModelFetcher {
  /**
   * Fetch available models from the provider.
   * @param apiKey - API key for authentication
   * @param forceRefresh - If true, bypass any cache
   * @returns Array of normalized model info
   */
  fetchModels(apiKey: string, forceRefresh?: boolean): Promise<ProviderModelInfo[]>

  /**
   * Validate an API key by attempting a lightweight API call.
   * @param apiKey - API key to validate
   * @returns Validation result with optional error message
   */
  validateApiKey(apiKey: string): Promise<{error?: string; isValid: boolean}>
}
