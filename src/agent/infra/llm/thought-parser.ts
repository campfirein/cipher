/**
 * Thought Parsing Utilities
 *
 * Handles parsing and processing of thinking/thought signatures from Gemini models.
 * Thoughts represent the model's reasoning process before generating responses or tool calls.
 */

/**
 * Parsed thought summary with subject and description
 */
export interface ThoughtSummary {
  /**
   * Description or details of the thought
   */
  description: string

  /**
   * Subject of the thought (extracted from **subject** format)
   */
  subject: string
}

/**
 * Thinking configuration for Gemini models
 */
export interface ThinkingConfig {
  /**
   * Whether to include thoughts in responses
   * @default false
   */
  includeThoughts?: boolean

  /**
   * Thinking token budget for Gemini 2.x models
   * @default 512
   */
  thinkingBudget?: number

  /**
   * Thinking level for Gemini 3.x models
   * @default 'HIGH'
   */
  thinkingLevel?: ThinkingLevel
}

/**
 * Thinking levels for Gemini 3.x models
 * Matches @google/genai ThinkingLevel enum values
 */
export enum ThinkingLevel {
  DISABLED = 'DISABLED',
  HIGH = 'HIGH',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  UNSPECIFIED = 'THINKING_LEVEL_UNSPECIFIED',
}

/**
 * Check if model is a Gemini 2.x model
 * @param model - Model identifier
 * @returns True if model is Gemini 2.x
 */
export function isGemini2Model(model: string): boolean {
  return /^gemini-2(\.|$)/.test(model)
}

/**
 * Check if model is a Gemini 3.x model
 * @param model - Model identifier
 * @returns True if model is Gemini 3.x
 */
export function isGemini3Model(model: string): boolean {
  return /^gemini-3[.-]/.test(model)
}

/**
 * Check if model supports multimodal function responses
 * This is supported in Gemini 3+ models
 * @param model - Model identifier
 * @returns True if model supports multimodal function responses
 */
export function supportsMultimodalFunctionResponse(model: string): boolean {
  return /^gemini-3[.-]/.test(model)
}

/**
 * Default thinking mode token budget
 */
export const DEFAULT_THINKING_BUDGET = 8192

/**
 * Synthetic thought signature used for Preview models
 */
export const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/**
 * Utility object for parsing thoughts from LLM responses
 */
export const ThoughtParser = {
  /**
   * Delimiters for subject extraction
   */
  END_DELIMITER: '**',

  /**
   * Extract just the description from thought text
   *
   * @param text - Thought text
   * @returns Description string
   */
  extractDescription(text: string): string {
    const { description } = this.parse(text)
    return description
  },

  /**
   * Extract just the subject from thought text
   *
   * @param text - Thought text
   * @returns Subject string or empty if no subject found
   */
  extractSubject(text: string): string {
    const { subject } = this.parse(text)
    return subject
  },

  /**
   * Check if text contains a thought subject
   *
   * @param text - Text to check
   * @returns True if text contains **subject** format
   */
  hasSubject(text: string): boolean {
    if (!text) return false

    const startIndex = text.indexOf(this.START_DELIMITER)
    if (startIndex === -1) return false

    const endIndex = text.indexOf(
      this.END_DELIMITER,
      startIndex + this.START_DELIMITER.length
    )

    return endIndex !== -1
  },

  /**
   * Parse thought text into subject and description.
   *
   * Extracts subject from **subject** format:
   * - Text between ** ** becomes the subject
   * - Rest of the text becomes the description
   *
   * @param rawText - Raw thought text from LLM
   * @returns Parsed thought summary
   *
   * @example
   * ```typescript
   * const thought = ThoughtParser.parse("**Analyzing code** Let me review the structure")
   * // Returns: { subject: "Analyzing code", description: "Let me review the structure" }
   * ```
   */
  parse(rawText: string): ThoughtSummary {
    if (!rawText) {
      return { description: '', subject: '' }
    }

    const startIndex = rawText.indexOf(this.START_DELIMITER)

    // No delimiter found - entire text is description
    if (startIndex === -1) {
      return { description: rawText.trim(), subject: '' }
    }

    const endIndex = rawText.indexOf(
      this.END_DELIMITER,
      startIndex + this.START_DELIMITER.length
    )

    // End delimiter not found - entire text is description
    if (endIndex === -1) {
      return { description: rawText.trim(), subject: '' }
    }

    // Extract subject from between delimiters
    const subject = rawText
      .slice(startIndex + this.START_DELIMITER.length, endIndex)
      .trim()

    // Rest is description (before start + after end)
    const description = (
      rawText.slice(0, startIndex) +
      rawText.slice(endIndex + this.END_DELIMITER.length)
    ).trim()

    return { description, subject }
  },

  /**
   * Delimiters for subject extraction
   */
  START_DELIMITER: '**',
} as const

/**
 * Utility object for managing thinking configuration
 */
export const ThinkingConfigManager = {
  /**
   * Get thinking config based on model version
   *
   * - Gemini 3.x: Uses thinkingLevel
   * - Gemini 2.x: Uses thinkingBudget
   * - Other models: No thinking config
   *
   * @param model - Model identifier
   * @returns Thinking configuration or undefined
   */
  getConfigForModel(model: string): ThinkingConfig | undefined {
    const lowerModel = model.toLowerCase()

    // Only Gemini models support thinking
    if (!lowerModel.includes('gemini')) {
      return undefined
    }

    // Gemini 3.x models
    if (lowerModel.startsWith('gemini-3') || lowerModel.includes('gemini-3')) {
      return {
        includeThoughts: true,
        thinkingLevel: ThinkingLevel.MEDIUM,
      }
    }

    // Gemini 2.x models
    if (lowerModel.startsWith('gemini-2') || lowerModel.includes('gemini-2')) {
      return {
        includeThoughts: true,
        thinkingBudget: DEFAULT_THINKING_BUDGET,
      }
    }

    // Other Gemini models - use budget as default
    return {
      includeThoughts: true,
      thinkingBudget: DEFAULT_THINKING_BUDGET,
    }
  },

  /**
   * Check if model is a preview model requiring thought signatures
   *
   * @param model - Model identifier
   * @returns True if model is preview
   */
  isPreviewModel(model: string): boolean {
    return model.toLowerCase().includes('preview')
  },

  /**
   * Merge user config with model defaults
   *
   * @param model - Model identifier
   * @param userConfig - User-provided config (optional)
   * @returns Merged configuration
   */
  mergeConfig(model: string, userConfig?: ThinkingConfig): ThinkingConfig | undefined {
    const modelDefaults = this.getConfigForModel(model)

    if (!modelDefaults) {
      return userConfig
    }

    if (!userConfig) {
      return modelDefaults
    }

    return {
      ...modelDefaults,
      ...userConfig,
    }
  },

  /**
   * Check if model supports thinking
   *
   * @param model - Model identifier
   * @returns True if model supports thinking
   */
  supportsThinking(model: string): boolean {
    return model.toLowerCase().includes('gemini')
  },
} as const
