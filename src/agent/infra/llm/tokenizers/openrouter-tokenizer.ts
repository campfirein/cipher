import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'

import {DEFAULT_CHARS_PER_TOKEN, getCharsPerToken} from '../../../core/domain/llm/index.js'

/**
 * Tokenizer for OpenRouter API.
 *
 * OpenRouter supports multiple model providers (OpenAI, Anthropic, etc.),
 * each with different tokenization schemes. This tokenizer uses the LLM
 * registry to look up model-specific character-per-token ratios when available.
 *
 * For models not in the registry, falls back to a generic approximation
 * that works reasonably well across different model providers.
 */
export class OpenRouterTokenizer implements ITokenizer {
  private readonly charsPerToken: number

  /**
   * Creates a new OpenRouter tokenizer instance.
   *
   * @param model - The OpenRouter model name (e.g., 'anthropic/claude-sonnet-4', 'openai/gpt-4o')
   *                Used to look up model-specific token ratio from registry
   */
  public constructor(model?: string) {
    // Look up model-specific ratio from registry, fallback to default
    this.charsPerToken = model
      ? (getCharsPerToken('openai', model) ?? DEFAULT_CHARS_PER_TOKEN)
      : DEFAULT_CHARS_PER_TOKEN
  }

  /**
   * Approximates token count using model-specific character-per-token ratio.
   *
   * Uses the LLM registry when available, otherwise defaults to ~4 characters
   * per token which is a common approximation for modern tokenizers.
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

  /**
   * Gets the provider name for this tokenizer.
   *
   * @returns 'openrouter' as the provider identifier
   */
  public getProviderName(): string {
    return 'openrouter'
  }
}
