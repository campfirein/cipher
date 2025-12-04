import type {ITokenizer} from '../../../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage} from '../../../../../core/interfaces/cipher/message-types.js'

/**
 * Configuration options for compression strategies
 */
export interface CompressionStrategyOptions {
  [key: string]: unknown
}

/**
 * Interface for context compression strategies.
 * Strategies remove messages from history to fit within token limits.
 *
 * Compression strategies are applied sequentially by the ContextManager
 * until the token limit is satisfied. Each strategy can implement different
 * algorithms for deciding which messages to remove.
 *
 * Common strategies:
 * - MiddleRemoval: Preserves early context and recent messages, removes from middle
 * - OldestRemoval: Simple FIFO, keeps only recent messages
 */
export interface ICompressionStrategy {
  /**
   * Compress message history to fit within token limit
   *
   * @param history - Full message history to compress
   * @param maxHistoryTokens - Maximum tokens allowed for history (excluding system prompt)
   * @param tokenizer - Tokenizer for counting tokens
   * @returns Compressed message history
   */
  compress(
    history: InternalMessage[],
    maxHistoryTokens: number,
    tokenizer: ITokenizer,
  ): Promise<InternalMessage[]>

  /**
   * Human-readable name of the strategy
   * Used for logging and debugging
   */
  getName(): string
}
