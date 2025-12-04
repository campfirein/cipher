import type {ITokenizer} from '../../../../core/interfaces/cipher/i-tokenizer.js'

/**
 * Tokenizer for Anthropic Claude models - CURRENTLY USING APPROXIMATION.
 *
 * This implementation uses a character-based approximation rather than
 * accurate token counting. This is a temporary solution due to the
 * complexity of integrating Anthropic's token counting API.
 *
 * Claude models use a tokenizer similar to GPT's, with approximately
 * 3.5-4 characters per token for English text. We use 3.5 as a middle ground.
 *
 * TODO: Consider these improvements:
 * 1. Use Anthropic's official token counting API (requires async handling or separate service)
 * 2. Implement a WASM-based tokenizer for accurate synchronous counting
 * 3. Cache token counts for frequently used text
 * 4. Model-specific adjustments based on actual Claude tokenization patterns
 *
 * Reference: https://docs.anthropic.com/en/docs/about-claude/models
 */
export class ClaudeTokenizer implements ITokenizer {
  private readonly modelName: string

  /**
   * Creates a new Claude tokenizer instance.
   *
   * @param model - The Claude model name (e.g., 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229')
   *                Currently not used for approximation, but stored for future improvements
   */
  public constructor(model: string) {
    this.modelName = model
  }

  /**
   * Approximates the token count for Anthropic Claude models.
   *
   * Uses a character-based approximation: ~3.5 characters per token.
   * This is based on Anthropic's documentation and common patterns for
   * English text with Claude's tokenizer.
   *
   * IMPORTANT: This is NOT accurate for Claude models and should be replaced
   * with a proper implementation when possible. The actual token count can vary
   * significantly based on:
   * - Language (non-English text may have different ratios)
   * - Content type (code vs prose)
   * - Special characters and formatting
   *
   * @param text - Text content to count tokens for
   * @returns Approximate number of tokens
   */
  public countTokens(text: string): number {
    if (!text) {
      return 0
    }

    // Approximation: ~3.5 characters per token
    // Claude's tokenizer is similar to GPT's, typically more efficient than 4 chars/token
    return Math.ceil(text.length / 3.5)
  }
}
