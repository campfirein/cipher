/**
 * Model Capabilities Detection
 *
 * Detects reasoning/thinking capabilities and format for each model.
 * Following OpenCode's pattern of model-specific capability detection.
 *
 * Different models use different formats for reasoning:
 * - OpenAI (o1, o3, gpt-5): Native `reasoning` field in API response
 * - Grok: `reasoning_content` or `reasoning_details` fields
 * - Gemini via OpenRouter: `reasoning_details` array or `thoughts` field
 * - GLM (Zhipu AI): `reasoning_content` field in API response
 * - DeepSeek (R1/Reasoner): `reasoning_content` field in API response (OpenAI-compatible)
 * - Claude/MiniMax: `<think>...</think>` XML tags in content
 */

/**
 * Reasoning format types
 */
export type ReasoningFormat =
  /** Model uses <think>...</think> XML tags in content */
  | 'interleaved'
  /** Model uses a native field in the API response */
  | 'native-field'
  /** Model interleaves reasoning in content parts */
  | 'none'
  /** Model does not support reasoning */
  | 'think-tags'

/**
 * Model capabilities for reasoning/thinking
 */
export interface ModelCapabilities {
  /** Additional fields to check for reasoning content */
  alternativeFields?: string[]
  /** Whether the model supports reasoning/thinking output */
  reasoning: boolean
  /** The field name for native reasoning (e.g., 'reasoning_content', 'reasoning', 'thoughts') */
  reasoningField?: string
  /** How the model outputs reasoning content */
  reasoningFormat: ReasoningFormat
}

/**
 * Get model capabilities for a given model ID.
 *
 * @param modelId - The model identifier (can be full path like "openai/gpt-5" or short like "gpt-5")
 * @returns Model capabilities including reasoning support and format
 *
 * @example
 * ```typescript
 * const caps = getModelCapabilities('openai/o3-mini')
 * // { reasoning: true, reasoningFormat: 'native-field', reasoningField: 'reasoning' }
 *
 * const caps2 = getModelCapabilities('anthropic/claude-3-opus')
 * // { reasoning: true, reasoningFormat: 'think-tags' }
 * ```
 */
export function getModelCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase()

  // OpenAI reasoning models (o1, o3, gpt-5 series)
  if (id.includes('o1') || id.includes('o3') || id.includes('o4')) {
    return {
      reasoning: true,
      reasoningField: 'reasoning',
      reasoningFormat: 'native-field',
    }
  }

  if (id.includes('gpt-5')) {
    return {
      reasoning: true,
      reasoningField: 'reasoning',
      reasoningFormat: 'native-field',
    }
  }

  // Grok models (x.ai)
  if (id.includes('grok')) {
    // Grok-3-mini has reasoning capability
    if (id.includes('grok-3-mini') || id.includes('grok-3-fast')) {
      return {
        alternativeFields: ['reasoning', 'reasoning_details'],
        reasoning: true,
        reasoningField: 'reasoning_content',
        reasoningFormat: 'native-field',
      }
    }

    // Other Grok models may not have explicit reasoning
    return {
      reasoning: false,
      reasoningFormat: 'none',
    }
  }

  // Gemini models with thinking
  // Via OpenRouter, Gemini thinking may be returned as:
  // - `reasoning_details` array (OpenRouter normalized format)
  // - `thoughts` field (native Gemini format)
  if (id.includes('gemini')) {
    // Gemini 2.5 and 3.x have thinking support
    if (id.includes('2.5') || id.includes('3.') || id.includes('gemini-3')) {
      return {
        alternativeFields: ['thoughts', 'thinking', 'thought', 'reasoning'],
        reasoning: true,
        reasoningField: 'reasoning_details',
        reasoningFormat: 'native-field',
      }
    }

    // Gemini 2.0 flash thinking
    if (id.includes('2.0') && id.includes('thinking')) {
      return {
        alternativeFields: ['thoughts', 'thinking', 'thought', 'reasoning'],
        reasoning: true,
        reasoningField: 'reasoning_details',
        reasoningFormat: 'native-field',
      }
    }

    return {
      reasoning: false,
      reasoningFormat: 'none',
    }
  }

  // Claude models (via OpenRouter use think tags)
  if (id.includes('claude')) {
    return {
      reasoning: true,
      reasoningFormat: 'think-tags',
    }
  }

  // DeepSeek models — reasoning models stream `reasoning_content` natively
  // (OpenAI-compatible field), not <think> tags.
  if (id.includes('deepseek')) {
    if (id.includes('r1') || id.includes('reasoner')) {
      return {
        reasoning: true,
        reasoningField: 'reasoning_content',
        reasoningFormat: 'native-field',
      }
    }

    return {
      reasoning: false,
      reasoningFormat: 'none',
    }
  }

  // GLM models (Zhipu AI / Z.AI)
  if (id.includes('glm')) {
    // GLM-4.6+ models support reasoning
    if (id.includes('4.6') || id.includes('4.7')) {
      return {
        reasoning: true,
        reasoningField: 'reasoning_content',
        reasoningFormat: 'native-field',
      }
    }

    return {
      reasoning: false,
      reasoningFormat: 'none',
    }
  }

  // Kimi models (Moonshot AI)
  if (id.includes('kimi')) {
    // Kimi K2 thinking variants and K2.5 support reasoning
    if (id.includes('thinking') || id.includes('k2.5')) {
      return {
        reasoning: true,
        reasoningField: 'reasoning_content',
        reasoningFormat: 'native-field',
      }
    }

    return {
      reasoning: false,
      reasoningFormat: 'none',
    }
  }

  // MiniMax models
  if (id.includes('minimax')) {
    return {
      reasoning: true,
      reasoningFormat: 'think-tags',
    }
  }

  // Qwen models with thinking
  if (id.includes('qwen') && (id.includes('qwq') || id.includes('thinking'))) {
    return {
      reasoning: true,
      reasoningFormat: 'think-tags',
    }
  }

  // Default: no reasoning support
  return {
    reasoning: false,
    reasoningFormat: 'none',
  }
}

/**
 * Check if a model supports reasoning.
 *
 * @param modelId - The model identifier
 * @returns True if the model supports reasoning output
 */
export function supportsReasoning(modelId: string): boolean {
  return getModelCapabilities(modelId).reasoning
}

/**
 * Check if a model uses think tags for reasoning.
 *
 * @param modelId - The model identifier
 * @returns True if the model uses <think>...</think> tags
 */
export function usesThinkTags(modelId: string): boolean {
  return getModelCapabilities(modelId).reasoningFormat === 'think-tags'
}

/**
 * Check if a model uses native reasoning fields.
 *
 * @param modelId - The model identifier
 * @returns True if the model uses native API fields for reasoning
 */
export function usesNativeReasoning(modelId: string): boolean {
  return getModelCapabilities(modelId).reasoningFormat === 'native-field'
}
