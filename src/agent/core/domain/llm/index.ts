/**
 * LLM Domain Module
 *
 * Exports types, registry, and utilities for LLM provider abstraction.
 */

// Error Codes
export {
  ErrorScope,
  type ErrorScopeType,
  ErrorType,
  type ErrorTypeValue,
  LLMErrorCode,
  type LLMErrorCodeType,
} from './error-codes.js'

// Registry
export {
  acceptsAnyModel,
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_MAX_INPUT_TOKENS,
  getCharsPerToken,
  getDefaultModelForProvider,
  getEffectiveMaxInputTokens,
  getMaxInputTokensForModel,
  getModelCapabilities,
  getModelInfo,
  getModelInfoWithFallback,
  getProviderFromModel,
  getSupportedFileTypesForModel,
  getSupportedModels,
  isValidProviderModel,
  LLM_REGISTRY,
  modelSupportsFileType,
} from './registry.js'

// Schemas
export {
  type LLMConfig,
  LLMConfigBaseSchema,
  LLMConfigSchema,
  type LLMUpdates,
  LLMUpdatesSchema,
  safeParseLLMConfig,
  type ValidatedLLMConfig,
  validateLLMConfig,
  validateLLMUpdates,
} from './schemas.js'

// Types
export {
  getAllowedMimeTypes,
  getFileTypeFromMimeType,
  isSupportedMimeType,
  LLM_PROVIDERS,
  type LLMContext,
  type LLMProvider,
  type LLMTokenUsage,
  MIME_TYPE_TO_FILE_TYPE,
  type ModelCapabilities,
  type ModelInfo,
  type ProviderInfo,
  SUPPORTED_FILE_TYPES,
  type SupportedFileType,
} from './types.js'
