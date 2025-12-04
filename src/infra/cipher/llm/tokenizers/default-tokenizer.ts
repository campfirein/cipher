import type {ITokenizer} from '../../../../core/interfaces/cipher/i-tokenizer.js'

/**
 * Default fallback tokenizer for unknown or unsupported models.
 *
 * This tokenizer provides a generic character-based approximation
 * that can be used when no provider-specific tokenizer is available.
 * It uses a simple heuristic that works reasonably well for English text.
 */
export class DefaultTokenizer implements ITokenizer {
  /**
   * Approximates token count using a character-based heuristic.
   *
   * Assumes roughly 4 characters per token, which is a common approximation
   * for English text with modern tokenizers (like GPT, Claude, Gemini).
   *
   * This heuristic may be less accurate for:
   * - Non-English languages (especially character-based languages)
   * - Code (which often has different tokenization patterns)
   * - Text with many special characters or formatting
   *
   * @param text - Text content to count tokens for
   * @returns Approximate number of tokens
   */
  public countTokens(text: string): number {
    if (!text) {
      return 0
    }

    // Simple heuristic: ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  /**
   * Gets the provider name for this tokenizer.
   *
   * @returns 'default' as the provider identifier
   */
  public getProviderName(): string {
    return 'default'
  }
}
