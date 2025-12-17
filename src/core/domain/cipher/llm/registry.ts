/**
 * LLM Model Registry - Single Source of Truth for Model Metadata.
 *
 * This registry provides centralized model information including:
 * - Context window sizes (maxInputTokens)
 * - Character-per-token ratios for estimation
 * - Supported file types for multimodal input
 * - Model capabilities
 *
 * Following patterns from Dexto's LLM registry.
 */

import {
  LLM_PROVIDERS,
  type LLMProvider,
  type ModelCapabilities,
  type ModelInfo,
  type ProviderInfo,
  type SupportedFileType,
} from './types.js'

/** Default fallback for unknown models */
export const DEFAULT_MAX_INPUT_TOKENS = 128_000
export const DEFAULT_CHARS_PER_TOKEN = 4

/**
 * LLM Model Registry
 *
 * IMPORTANT: supportedFileTypes is the SINGLE SOURCE OF TRUTH for file upload capabilities:
 * - Empty array [] = Model does NOT support file uploads
 * - Specific types ['image', 'pdf'] = Model supports ONLY those file types
 */
export const LLM_REGISTRY: Record<LLMProvider, ProviderInfo> = {
  claude: {
    defaultModel: '',
    models: [],
    supportedFileTypes: [],
  },
  gemini: {
    defaultModel: 'gemini-2.0-flash',
    models: [
      // Gemini 2.0 series
      {
        capabilities: {
          supportsAudio: true,
          supportsImages: true,
          supportsPdf: true,
          supportsStreaming: true,
          supportsThinking: true,
        },
        charsPerToken: 4,
        default: true,
        displayName: 'Gemini 2.0 Flash',
        maxInputTokens: 1_000_000,
        maxOutputTokens: 8192,
        name: 'gemini-2.0-flash',
        pricing: {inputPerM: 0.075, outputPerM: 0.3},
        supportedFileTypes: ['image', 'pdf', 'audio'],
      },
    ],
    supportedFileTypes: ['image', 'pdf', 'audio'],
  },

  openrouter: {
    defaultModel: '',
    models: [],
    supportedFileTypes: [],
  },
}

// ============================================================================
// Registry Helper Functions
// ============================================================================

/**
 * Get model information from the registry.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns ModelInfo or undefined if not found
 */
export function getModelInfo(provider: LLMProvider, model: string): ModelInfo | undefined {
  const providerInfo = LLM_REGISTRY[provider]
  if (!providerInfo) return undefined
  return providerInfo.models.find((m) => m.name === model)
}

/**
 * Get model info with fallback for unknown models.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns ModelInfo (falls back to default values for unknown models)
 */
export function getModelInfoWithFallback(provider: LLMProvider, model: string): ModelInfo {
  const info = getModelInfo(provider, model)
  if (info) return info

  // Fallback for unknown models
  const providerInfo = LLM_REGISTRY[provider]
  return {
    capabilities: {
      supportsAudio: false,
      supportsImages: provider !== 'openrouter', // Assume basic image support
      supportsPdf: provider === 'claude' || provider === 'gemini',
      supportsStreaming: true,
    },
    charsPerToken: DEFAULT_CHARS_PER_TOKEN,
    displayName: model,
    maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
    name: model,
    supportedFileTypes: providerInfo?.supportedFileTypes ?? [],
  }
}

/**
 * Get characters per token ratio for a model.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns Characters per token ratio
 */
export function getCharsPerToken(provider: LLMProvider, model: string): number {
  const info = getModelInfo(provider, model)
  return info?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN
}

/**
 * Get maximum input tokens for a model.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns Maximum input tokens
 */
export function getMaxInputTokensForModel(provider: LLMProvider, model: string): number {
  const info = getModelInfo(provider, model)
  return info?.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS
}

/**
 * Check if a model is valid for a provider.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns true if the model is in the registry
 */
export function isValidProviderModel(provider: LLMProvider, model: string): boolean {
  return getModelInfo(provider, model) !== undefined
}

/**
 * Get supported models for a provider.
 * @param provider - LLM provider
 * @returns Array of model names
 */
export function getSupportedModels(provider: LLMProvider): string[] {
  const providerInfo = LLM_REGISTRY[provider]
  if (!providerInfo) return []
  return providerInfo.models.map((m) => m.name)
}

/**
 * Get the default model for a provider.
 * @param provider - LLM provider
 * @returns Default model name
 */
export function getDefaultModelForProvider(provider: LLMProvider): string {
  const providerInfo = LLM_REGISTRY[provider]
  return providerInfo?.defaultModel ?? ''
}

/**
 * Infer provider from model name.
 * @param model - Model name
 * @returns LLMProvider or undefined if not found
 */
export function getProviderFromModel(model: string): LLMProvider | undefined {
  // Check each provider's models
  for (const provider of LLM_PROVIDERS) {
    if (getModelInfo(provider, model)) {
      return provider
    }
  }

  // Fallback: infer from model name prefix
  const lowerModel = model.toLowerCase()
  if (lowerModel.startsWith('claude')) return 'claude'
  if (lowerModel.startsWith('gemini')) return 'gemini'
  if (lowerModel.includes('/')) return 'openrouter' // OpenRouter uses provider/model format

  return undefined
}

/**
 * Get supported file types for a model.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns Array of supported file types
 */
export function getSupportedFileTypesForModel(
  provider: LLMProvider,
  model: string
): SupportedFileType[] {
  const info = getModelInfo(provider, model)
  if (info) return info.supportedFileTypes

  // Fallback to provider-level defaults
  const providerInfo = LLM_REGISTRY[provider]
  return providerInfo?.supportedFileTypes ?? []
}

/**
 * Check if a model supports a specific file type.
 * @param provider - LLM provider
 * @param model - Model name
 * @param fileType - File type to check
 * @returns true if the model supports the file type
 */
export function modelSupportsFileType(
  provider: LLMProvider,
  model: string,
  fileType: SupportedFileType
): boolean {
  const supportedTypes = getSupportedFileTypesForModel(provider, model)
  return supportedTypes.includes(fileType)
}

/**
 * Get model capabilities.
 * @param provider - LLM provider
 * @param model - Model name
 * @returns ModelCapabilities
 */
export function getModelCapabilities(provider: LLMProvider, model: string): ModelCapabilities {
  const info = getModelInfoWithFallback(provider, model)
  return info.capabilities
}

/**
 * Get effective max input tokens considering config override.
 * @param provider - LLM provider
 * @param model - Model name
 * @param configuredMax - Optional configured max from user
 * @returns Effective max input tokens (min of model limit and configured limit)
 */
export function getEffectiveMaxInputTokens(
  provider: LLMProvider,
  model: string,
  configuredMax?: number
): number {
  const modelMax = getMaxInputTokensForModel(provider, model)
  if (configuredMax === undefined) return modelMax
  return Math.min(modelMax, configuredMax)
}

/**
 * Check if OpenRouter accepts any model (custom models).
 * OpenRouter can route to many models not in our registry.
 * @param provider - LLM provider
 * @returns true if provider accepts arbitrary models
 */
export function acceptsAnyModel(provider: LLMProvider): boolean {
  return provider === 'openrouter'
}
