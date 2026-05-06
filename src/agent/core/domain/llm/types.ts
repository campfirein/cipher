/**
 * LLM Provider types and constants.
 *
 * This module defines the core types for LLM provider abstraction,
 */

/**
 * Provider types for formatter/tokenizer selection.
 * These represent the underlying API format, NOT provider IDs.
 * e.g., OpenRouter, xAI, Groq, Mistral all use 'openai' format.
 */
export const PROVIDER_TYPES = ['claude', 'gemini', 'openai'] as const

/**
 * Union type of provider types.
 */
export type ProviderType = (typeof PROVIDER_TYPES)[number]

/**
 * @deprecated Use PROVIDER_TYPES instead. Kept for backward compatibility.
 */
export const LLM_PROVIDERS = PROVIDER_TYPES

/**
 * @deprecated Use ProviderType instead. Kept for backward compatibility.
 */
export type LLMProvider = ProviderType

/**
 * Supported file types for multimodal input.
 */
export const SUPPORTED_FILE_TYPES = ['audio', 'image', 'pdf'] as const

/**
 * Union type of supported file types.
 */
export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number]

/**
 * Model capabilities configuration.
 * Defines what features a specific model supports.
 */
export interface ModelCapabilities {
  /**
   * Whether the model accepts the sampling parameters `temperature`, `top_p`, and `top_k`.
   * When false, callers must omit these from the request — Claude Opus 4.7 returns 400
   * on any non-default value. Defaults to true when omitted.
   */
  acceptsSamplingParameters?: boolean
  /** Whether the model supports audio input */
  supportsAudio: boolean
  /** Whether the model supports image input */
  supportsImages: boolean
  /** Whether the model supports multimodal data in function responses (Gemini 3+) */
  supportsMultimodalFunctionResponse?: boolean
  /** Whether the model supports PDF input */
  supportsPdf: boolean
  /** Whether the model supports streaming responses */
  supportsStreaming: boolean
  /** Whether the model supports extended thinking (Gemini) */
  supportsThinking?: boolean
}

/**
 * Model metadata information.
 * Contains all relevant details about a specific model.
 */
export interface ModelInfo {
  /** Model capabilities */
  capabilities: ModelCapabilities
  /** Characters per token ratio for estimation (e.g., 3.5 for Claude) */
  charsPerToken: number
  /** Whether this is the default model for the provider */
  default?: boolean
  /** Human-readable display name */
  displayName: string
  /** Maximum input tokens (context window size) */
  maxInputTokens: number
  /** Default max output tokens */
  maxOutputTokens?: number
  /** Model identifier (e.g., 'claude-sonnet-4-20250514') */
  name: string
  /** Optional pricing info (USD per million tokens) */
  pricing?: {
    inputPerM: number
    outputPerM: number
  }
  /** File types this model supports */
  supportedFileTypes: SupportedFileType[]
}

/**
 * Provider configuration information.
 * Contains metadata about a provider and its available models.
 */
export interface ProviderInfo {
  /** Default model name for this provider */
  defaultModel: string
  /** List of available models */
  models: ModelInfo[]
  /** Provider-level supported file types (fallback when model doesn't specify) */
  supportedFileTypes: SupportedFileType[]
}

/**
 * Runtime LLM context information.
 * Represents the current LLM configuration in use.
 */
export interface LLMContext {
  /** Current model name */
  model: string
  /** Current provider */
  provider: ProviderType
}

/**
 * Token usage statistics.
 */
export interface LLMTokenUsage {
  /** Number of input tokens */
  inputTokens: number
  /** Number of output tokens */
  outputTokens: number
  /** Number of reasoning tokens (if applicable) */
  reasoningTokens?: number
  /** Total tokens (input + output + reasoning) */
  totalTokens: number
}

/**
 * MIME type to file type mapping.
 * Used to determine supported file types from MIME types.
 */
export const MIME_TYPE_TO_FILE_TYPE: Record<string, SupportedFileType> = {
  // PDF
  'application/pdf': 'pdf',
  // Audio
  'audio/aac': 'audio',
  'audio/m4a': 'audio',
  'audio/mp3': 'audio',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/wave': 'audio',
  'audio/webm': 'audio',
  'audio/x-wav': 'audio',
  // Images
  'image/gif': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
}

/**
 * Get all allowed MIME types.
 * @returns Array of allowed MIME type strings
 */
export function getAllowedMimeTypes(): string[] {
  return Object.keys(MIME_TYPE_TO_FILE_TYPE)
}

/**
 * Get file type from MIME type.
 * @param mimeType - MIME type string
 * @returns SupportedFileType or undefined if not supported
 */
export function getFileTypeFromMimeType(mimeType: string): SupportedFileType | undefined {
  return MIME_TYPE_TO_FILE_TYPE[mimeType]
}

/**
 * Check if a MIME type is supported.
 * @param mimeType - MIME type string
 * @returns true if the MIME type is supported
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return mimeType in MIME_TYPE_TO_FILE_TYPE
}
