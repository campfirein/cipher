import type {ITokenizer} from '../../../../core/interfaces/cipher/i-tokenizer.js'

/**
 * Tokenizer for OpenRouter API.
 *
 * OpenRouter supports multiple model providers (OpenAI, Anthropic, etc.),
 * each with different tokenization schemes. This tokenizer provides a
 * generic approximation that works reasonably well across different models.
 *
 * For more accurate token counting, model-specific tokenizers could be
 * implemented based on the selected model's provider.
 */
export class OpenRouterTokenizer implements ITokenizer {
  /**
   * Approximates token count using a character-based heuristic.
   *
   * Uses ~4 characters per token, which is a common approximation
   * for modern tokenizers (GPT, Claude, Gemini, etc.).
   *
   * @param text - Text content to count tokens for
   * @returns Approximate number of tokens
   */
  public countTokens(text: string): number {
    if (!text) {
      return 0
    }

    // Simple heuristic: ~4 characters per token
    // This works reasonably well for most OpenRouter models
    return Math.ceil(text.length / 4)
  }

  /**
   * Gets the provider name for this tokenizer.
   *
   * @returns 'openrouter' as the provider identifier
   */
  public getProviderName(): string {
    return 'openrouter'
  }
}
