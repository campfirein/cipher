/**
 * Model Capability Cache
 *
 * Caches model capability lookups for performance.
 * Avoids repeated registry lookups for the same model.
 */

import {
  getModelInfoWithFallback,
  type LLMProvider,
  type ModelCapabilities,
} from '../types/llm/index.js'

/**
 * Cached model info for quick access.
 */
interface CachedModelInfo {
  capabilities: ModelCapabilities
  charsPerToken: number
  maxInputTokens: number
}

/**
 * Cache for model capability lookups.
 *
 * This cache stores model information to avoid repeated registry lookups.
 * The cache is keyed by "provider:model" for quick access.
 */
export class ModelCapabilityCache {
  private readonly cache = new Map<string, CachedModelInfo>()

  /**
   * Get cache size (number of cached models).
   */
  public get size(): number {
    return this.cache.size
  }

  /**
   * Clear the cache.
   */
  public clear(): void {
    this.cache.clear()
  }

  /**
   * Get model capabilities.
   * @param provider - LLM provider
   * @param model - Model name
   * @returns ModelCapabilities object
   */
  public getCapabilities(provider: LLMProvider, model: string): ModelCapabilities {
    return this.getOrFetch(provider, model).capabilities
  }

  /**
   * Get characters per token ratio for model.
   */
  public getCharsPerToken(provider: LLMProvider, model: string): number {
    return this.getOrFetch(provider, model).charsPerToken
  }

  /**
   * Get max input tokens for model.
   */
  public getMaxInputTokens(provider: LLMProvider, model: string): number {
    return this.getOrFetch(provider, model).maxInputTokens
  }

  /**
   * Check if a model is cached.
   */
  public has(provider: LLMProvider, model: string): boolean {
    return this.cache.has(this.getCacheKey(provider, model))
  }

  /**
   * Check if model supports audio.
   */
  public supportsAudio(provider: LLMProvider, model: string): boolean {
    return this.supportsFeature(provider, model, 'supportsAudio')
  }

  /**
   * Check if model supports a specific feature.
   * @param provider - LLM provider
   * @param model - Model name
   * @param feature - Feature to check
   * @returns true if feature is supported
   */
  public supportsFeature(
    provider: LLMProvider,
    model: string,
    feature: keyof ModelCapabilities
  ): boolean {
    const capabilities = this.getCapabilities(provider, model)
    return capabilities[feature] ?? false
  }

  /**
   * Check if model supports images.
   */
  public supportsImages(provider: LLMProvider, model: string): boolean {
    return this.supportsFeature(provider, model, 'supportsImages')
  }

  /**
   * Check if model supports PDFs.
   */
  public supportsPdf(provider: LLMProvider, model: string): boolean {
    return this.supportsFeature(provider, model, 'supportsPdf')
  }

  /**
   * Check if model supports streaming.
   */
  public supportsStreaming(provider: LLMProvider, model: string): boolean {
    return this.supportsFeature(provider, model, 'supportsStreaming')
  }

  /**
   * Check if model supports extended thinking (Gemini).
   */
  public supportsThinking(provider: LLMProvider, model: string): boolean {
    return this.supportsFeature(provider, model, 'supportsThinking')
  }

  /**
   * Generate cache key from provider and model.
   */
  private getCacheKey(provider: LLMProvider, model: string): string {
    return `${provider}:${model}`
  }

  /**
   * Get cached model info, fetching from registry if not cached.
   * @param provider - LLM provider
   * @param model - Model name
   * @returns Cached model info
   */
  private getOrFetch(provider: LLMProvider, model: string): CachedModelInfo {
    const key = this.getCacheKey(provider, model)

    if (!this.cache.has(key)) {
      const modelInfo = getModelInfoWithFallback(provider, model)
      this.cache.set(key, {
        capabilities: modelInfo.capabilities,
        charsPerToken: modelInfo.charsPerToken,
        maxInputTokens: modelInfo.maxInputTokens,
      })
    }

    return this.cache.get(key)!
  }
}

/**
 * Singleton instance for shared capability cache.
 * Use this for application-wide caching.
 */
export const globalCapabilityCache = new ModelCapabilityCache()
