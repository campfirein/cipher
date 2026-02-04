import type {ITokenizer} from '../../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/message-types.js'
import type {ICompressionStrategy} from './types.js'

import {countMessagesTokens} from '../utils.js'

/**
 * Configuration options for OldestRemovalStrategy
 */
export interface OldestRemovalOptions {
  /** Minimum number of recent messages to keep (default: 4) */
  minMessagesToKeep?: number
}

/**
 * Oldest Removal compression strategy.
 *
 * Simple FIFO (First-In-First-Out) strategy that removes the oldest messages first,
 * preserving only recent conversation history.
 *
 * This strategy is ideal as a fallback after more sophisticated strategies have been
 * applied. It ensures the most recent context is always preserved while older messages
 * are removed to meet token limits.
 *
 * Algorithm:
 * 1. Check if compression is needed
 * 2. Remove oldest message (from start of array)
 * 3. Recalculate token count
 * 4. Repeat until token limit is met or minimum messages reached
 * 5. Warn if still over limit (cannot compress further)
 *
 * Example with minMessagesToKeep=3:
 * Messages: [1, 2, 3, 4, 5, 6, 7, 8]
 * Remove: 1, then 2, then 3, then 4, then 5 (oldest-first)
 * Result: [6, 7, 8] (stops at minimum 3 messages)
 */
export class OldestRemovalStrategy implements ICompressionStrategy {
  private readonly minMessagesToKeep: number

  public constructor(options: OldestRemovalOptions = {}) {
    this.minMessagesToKeep = options.minMessagesToKeep ?? 4
    // Debug logging removed for cleaner user experience
  }

  public async compress(
    history: InternalMessage[],
    maxHistoryTokens: number,
    tokenizer: ITokenizer,
  ): Promise<InternalMessage[]> {
    // Work with a copy to avoid mutating input
    const currentHistory = [...history]
    let currentTokenCount = countMessagesTokens(currentHistory, tokenizer)

    // Remove oldest messages until token limit met or minimum reached
    while (
      currentHistory.length > this.minMessagesToKeep &&
      currentTokenCount > maxHistoryTokens
    ) {
      // Remove oldest message (from start)
      currentHistory.shift()

      // Recalculate token count
      currentTokenCount = countMessagesTokens(currentHistory, tokenizer)
    }

    // Note: may still be over limit after reaching minimum message count
    // This is expected when individual messages are very large

    // Debug logging removed for cleaner user experience

    return currentHistory
  }

  public getName(): string {
    return 'OldestRemoval'
  }
}
