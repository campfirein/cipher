/**
 * Reasoning Extractor
 *
 * Extracts reasoning/thinking content from different API response formats.
 * Different providers return reasoning in different fields:
 *
 * - OpenAI: `delta.reasoning` or `message.reasoning`
 * - Grok: `delta.reasoning_content` or `delta.reasoning_details`
 * - Gemini via OpenRouter: `delta.reasoning_details` array (with type: 'reasoning.text')
 *   or `delta.thoughts` (native Gemini format)
 *
 * OpenRouter normalizes reasoning into `reasoning_details` array format:
 * ```json
 * {
 *   "reasoning_details": [
 *     { "type": "reasoning.text", "text": "thinking content...", "id": "..." }
 *   ]
 * }
 * ```
 *
 * This module normalizes these different formats into a consistent structure
 * following OpenCode's pattern.
 */

import {getModelCapabilities, type ModelCapabilities} from '../model-capabilities.js'

/**
 * Result from extracting reasoning content from a chunk
 */
export interface ReasoningExtractorResult {
  /** Extracted reasoning/thinking text (undefined if none found) */
  reasoning?: string
  /** Unique ID for the reasoning block (for tracking across deltas) */
  reasoningId?: string
  /** Remaining content after reasoning extraction (text response) */
  content?: string
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>
}

/**
 * OpenRouter reasoning_details array item format.
 * OpenRouter returns reasoning in this format for Gemini and some other models.
 */
interface ReasoningDetailItem {
  format?: string
  id?: string
  index?: number
  signature?: string | null
  text?: string
  type?: string
}

/**
 * OpenAI/OpenRouter streaming chunk structure (simplified)
 */
interface OpenAIStreamChunk {
  id?: string
  choices?: Array<{
    delta?: {
      content?: string
      reasoning?: string
      reasoning_content?: string
      reasoning_details?: ReasoningDetailItem[] | string
      thoughts?: string
    }
    message?: {
      content?: string
      reasoning?: string
      reasoning_content?: string
      reasoning_details?: ReasoningDetailItem[] | string
    }
    index?: number
  }>
}

/**
 * Extract reasoning from OpenAI format chunks.
 * OpenAI reasoning models (o1, o3, gpt-5) use the `reasoning` field.
 *
 * @param chunk - Raw API chunk
 * @returns Extracted reasoning result
 */
function extractOpenAIReasoning(chunk: OpenAIStreamChunk): ReasoningExtractorResult {
  const result: ReasoningExtractorResult = {}
  const choice = chunk.choices?.[0]

  if (!choice) {
    return result
  }

  // Check delta for streaming
  if (choice.delta) {
    // Primary: reasoning field
    if (choice.delta.reasoning) {
      result.reasoning = choice.delta.reasoning
      result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
    }

    // Content remains separate
    if (choice.delta.content) {
      result.content = choice.delta.content
    }
  }

  // Check message for non-streaming
  if (choice.message?.reasoning) {
    result.reasoning = choice.message.reasoning
    result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
  }

  return result
}

/**
 * Extract reasoning text from reasoning_details array.
 * OpenRouter returns reasoning in this format for some models.
 *
 * @param details - The reasoning_details value (can be string or array)
 * @returns Extracted reasoning text or undefined
 */
function extractFromReasoningDetails(details: ReasoningDetailItem[] | string | undefined): string | undefined {
  if (!details) {
    return undefined
  }

  // If it's already a string, return it directly
  if (typeof details === 'string') {
    return details
  }

  // If it's an array, extract text from reasoning.text type items
  if (Array.isArray(details)) {
    const reasoningText = details
      .filter((d) => d.type === 'reasoning.text' && d.text)
      .map((d) => d.text)
      .join('')
    return reasoningText || undefined
  }

  return undefined
}

/**
 * Extract reasoning from Grok format chunks.
 * Grok uses `reasoning_content` or `reasoning_details` fields.
 *
 * @param chunk - Raw API chunk
 * @returns Extracted reasoning result
 */
function extractGrokReasoning(chunk: OpenAIStreamChunk): ReasoningExtractorResult {
  const result: ReasoningExtractorResult = {}
  const choice = chunk.choices?.[0]

  if (!choice) {
    return result
  }

  if (choice.delta) {
    // Primary: reasoning_content
    if (choice.delta.reasoning_content) {
      result.reasoning = choice.delta.reasoning_content
      result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
    }
    // Alternative: reasoning_details (can be string or array)
    else if (choice.delta.reasoning_details) {
      const extracted = extractFromReasoningDetails(choice.delta.reasoning_details)
      if (extracted) {
        result.reasoning = extracted
        result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
      }
    }
    // Fallback: reasoning (some Grok models may use this)
    else if (choice.delta.reasoning) {
      result.reasoning = choice.delta.reasoning
      result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
    }

    if (choice.delta.content) {
      result.content = choice.delta.content
    }
  }

  return result
}

/**
 * Extract reasoning from Gemini format chunks.
 * Gemini via OpenRouter may use:
 * - `thoughts` field (native Gemini format)
 * - `reasoning_details` array (OpenRouter normalized format)
 *
 * @param chunk - Raw API chunk
 * @returns Extracted reasoning result
 */
function extractGeminiReasoning(chunk: OpenAIStreamChunk): ReasoningExtractorResult {
  const result: ReasoningExtractorResult = {}
  const choice = chunk.choices?.[0]

  if (!choice) {
    return result
  }

  if (choice.delta) {
    // Primary: thoughts (native Gemini format)
    if (choice.delta.thoughts) {
      result.reasoning = choice.delta.thoughts
      result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
    }
    // Alternative: reasoning_details array (OpenRouter normalized format)
    else if (choice.delta.reasoning_details) {
      const extracted = extractFromReasoningDetails(choice.delta.reasoning_details)
      if (extracted) {
        result.reasoning = extracted
        result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
      }
    }
    // Fallback: reasoning field
    else if (choice.delta.reasoning) {
      result.reasoning = choice.delta.reasoning
      result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
    }

    if (choice.delta.content) {
      result.content = choice.delta.content
    }
  }

  // Also check message for non-streaming
  if (!result.reasoning && choice.message) {
    if (choice.message.reasoning_details) {
      const extracted = extractFromReasoningDetails(choice.message.reasoning_details)
      if (extracted) {
        result.reasoning = extracted
        result.reasoningId = chunk.id ?? `reasoning-${Date.now()}`
      }
    }
  }

  return result
}

/**
 * Extract reasoning from a streaming chunk based on model capabilities.
 * Automatically detects the appropriate extraction method based on model ID.
 *
 * @param chunk - Raw API chunk (OpenAI-compatible format)
 * @param modelId - Model identifier to determine extraction method
 * @returns Extracted reasoning result
 *
 * @example
 * ```typescript
 * const result = extractReasoning(chunk, 'openai/o3-mini')
 * if (result.reasoning) {
 *   console.log('Reasoning:', result.reasoning)
 * }
 * ```
 */
export function extractReasoning(chunk: unknown, modelId: string): ReasoningExtractorResult {
  const capabilities = getModelCapabilities(modelId)

  // Only try native extraction for models with native-field format
  if (capabilities.reasoningFormat !== 'native-field') {
    return {}
  }

  const typedChunk = chunk as OpenAIStreamChunk

  // Dispatch to appropriate extractor based on model
  const id = modelId.toLowerCase()

  if (id.includes('grok')) {
    return extractGrokReasoning(typedChunk)
  }

  if (id.includes('gemini')) {
    return extractGeminiReasoning(typedChunk)
  }

  // Default to OpenAI format (works for o1, o3, gpt-5)
  return extractOpenAIReasoning(typedChunk)
}

/**
 * Extract reasoning using explicit field names.
 * Useful when you know the exact field to check.
 *
 * @param chunk - Raw API chunk
 * @param capabilities - Model capabilities with field names
 * @returns Extracted reasoning result
 */
export function extractReasoningByField(
  chunk: unknown,
  capabilities: ModelCapabilities,
): ReasoningExtractorResult {
  if (!capabilities.reasoningField) {
    return {}
  }

  const typedChunk = chunk as OpenAIStreamChunk
  const choice = typedChunk.choices?.[0]
  const result: ReasoningExtractorResult = {}

  if (!choice?.delta) {
    return result
  }

  // Check primary field
  const delta = choice.delta as Record<string, unknown>
  const primaryField = capabilities.reasoningField

  if (delta[primaryField] && typeof delta[primaryField] === 'string') {
    result.reasoning = delta[primaryField] as string
    result.reasoningId = typedChunk.id ?? `reasoning-${Date.now()}`
  }

  // Check alternative fields
  if (!result.reasoning && capabilities.alternativeFields) {
    for (const field of capabilities.alternativeFields) {
      if (delta[field] && typeof delta[field] === 'string') {
        result.reasoning = delta[field] as string
        result.reasoningId = typedChunk.id ?? `reasoning-${Date.now()}`
        break
      }
    }
  }

  // Extract content
  if (delta.content && typeof delta.content === 'string') {
    result.content = delta.content
  }

  return result
}

/**
 * Check if a chunk contains reasoning content.
 *
 * @param chunk - Raw API chunk
 * @param modelId - Model identifier
 * @returns True if reasoning was found
 */
export function hasReasoningContent(chunk: unknown, modelId: string): boolean {
  const result = extractReasoning(chunk, modelId)
  return Boolean(result.reasoning)
}
