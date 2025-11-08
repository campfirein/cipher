/**
 * Interface for tokenizing text according to LLM provider-specific rules.
 * Different LLM providers use different tokenization algorithms, and this interface
 * provides a unified way to count tokens across providers.
 */
export interface ITokenizer {
  /**
   * Counts the number of tokens in the provided text according to
   * the specific LLM provider's tokenization rules.
   *
   * @param text - Text content to count tokens for
   * @returns Number of tokens in the text
   */
  countTokens: (text: string) => number
}
