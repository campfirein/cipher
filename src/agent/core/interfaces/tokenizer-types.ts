/**
 * Custom error class for tokenization-related errors.
 * Used to distinguish tokenization failures from other types of errors.
 */
export class TokenizationError extends Error {
  /**
   * Creates a new TokenizationError
   * @param message - Error message describing what went wrong
   */
  public constructor(message: string) {
    super(message)
    this.name = 'TokenizationError'
  }
}