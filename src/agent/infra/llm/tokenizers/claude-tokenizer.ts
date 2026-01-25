import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'

import {DEFAULT_CHARS_PER_TOKEN, getCharsPerToken} from '../../../core/domain/llm/index.js'

/**
 * Tokenizer for Anthropic Claude models.
 *
 * Uses the LLM registry for model-specific character-per-token ratios,
 * providing better estimation accuracy across different Claude models.
 *
 * This implementation uses a character-based approximation rather than
 * accurate token counting. The ratio is now model-aware via the registry.
 *
 * TODO: Consider these improvements:
 * 1. Use Anthropic's official token counting API (requires async handling)
 * 2. Implement a WASM-based tokenizer for accurate synchronous counting
 * 3. Cache token counts for frequently used text
 *
 * Reference: https://docs.anthropic.com/en/docs/about-claude/models
 */
export class ClaudeTokenizer implements ITokenizer {
  private readonly charsPerToken: number

  /**
   * Creates a new Claude tokenizer instance.
   *
   * @param model - The Claude model name (e.g., 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022')
   *                Used to look up model-specific token ratio from registry
   */
  public constructor(model: string) {
    // Look up model-specific ratio from registry, fallback to default
    this.charsPerToken = getCharsPerToken('claude', model) ?? DEFAULT_CHARS_PER_TOKEN
  }

  /**
   * Approximates the token count for Anthropic Claude models.
   *
   * Uses model-specific character-per-token ratio from the LLM registry.
   * Default for Claude models is ~3.5 characters per token.
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
