import type {ITokenizer} from '../../interfaces/i-tokenizer.js'

import {DEFAULT_CHARS_PER_TOKEN, getCharsPerToken} from '../../types/llm/index.js'

/**
 * Tokenizer for Google Gemini models.
 *
 * Uses the LLM registry for model-specific character-per-token ratios,
 * providing better estimation accuracy across different Gemini models.
 *
 * This implementation uses a character-based approximation rather than
 * accurate token counting. The ratio is now model-aware via the registry.
 *
 * TODO: Consider these improvements:
 * 1. Use the official @google/genai countTokens method (requires async handling)
 * 2. Implement a WASM-based tokenizer for accurate synchronous counting
 * 3. Cache token counts for frequently used text
 */
export class GeminiTokenizer implements ITokenizer {
  private readonly charsPerToken: number

  /**
   * Creates a new Gemini tokenizer instance.
   *
   * @param model - The Gemini model name (e.g., 'gemini-2.0-flash', 'gemini-1.5-pro')
   *                Used to look up model-specific token ratio from registry
   */
  public constructor(model: string) {
    // Look up model-specific ratio from registry, fallback to default
    this.charsPerToken = getCharsPerToken('gemini', model) ?? DEFAULT_CHARS_PER_TOKEN
  }

  /**
   * Approximates the token count for Google Gemini models.
   *
   * Uses model-specific character-per-token ratio from the LLM registry.
   * Default for Gemini models is ~4 characters per token.
   *
   * IMPORTANT: This is still an approximation. The actual token count can vary
   * based on language, content type (code vs prose), and special characters.
   *
   * @param text - Text content to count tokens for
   * @returns Approximate number of tokens
   */
  public countTokens(text: string): number {
    if (!text) {
      return 0
    }

    return Math.ceil(text.length / this.charsPerToken)
  }
}
