import type {ITokenizer} from '../../../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage} from '../../../../../core/interfaces/cipher/message-types.js'
import type {ICompressionStrategy} from './types.js'

import {countMessagesTokens} from '../utils.js'

/**
 * Configuration options for MiddleRemovalStrategy
 */
export interface MiddleRemovalOptions {
  /** Number of messages to preserve at the end (default: 5) */
  preserveEnd?: number
  /** Number of messages to preserve at the start (default: 4) */
  preserveStart?: number
}

/**
 * Middle Removal compression strategy.
 *
 * Preserves messages at the beginning (early context/setup) and end (recent conversation),
 * removing messages from the middle section when compression is needed.
 *
 * This strategy is ideal for maintaining both:
 * - Historical context (system instructions, initial setup)
 * - Recent conversation flow (latest user/assistant exchanges)
 *
 * Algorithm:
 * 1. Check if compression is needed
 * 2. Identify the "middle" section (between preserved start and end)
 * 3. Remove oldest messages from middle until token limit is met
 * 4. Return compressed history with start and end intact
 *
 * Example with preserveStart=2, preserveEnd=2:
 * Messages: [1, 2, 3, 4, 5, 6, 7, 8]
 * Preserved: [1, 2] + [...] + [7, 8]
 * Removable: [3, 4, 5, 6] (removed oldest-first if needed)
 */
export class MiddleRemovalStrategy implements ICompressionStrategy {
  private readonly preserveEnd: number
  private readonly preserveStart: number

  public constructor(options: MiddleRemovalOptions = {}) {
    this.preserveEnd = options.preserveEnd ?? 5
    this.preserveStart = options.preserveStart ?? 4

    console.log(
      `MiddleRemovalStrategy initialized: preserveStart=${this.preserveStart}, preserveEnd=${this.preserveEnd}`,
    )
  }

  public async compress(
    history: InternalMessage[],
    maxHistoryTokens: number,
    tokenizer: ITokenizer,
  ): Promise<InternalMessage[]> {
    // Calculate initial token count
    const initialTokenCount = countMessagesTokens(history, tokenizer)

    // No compression needed - return unchanged
    if (initialTokenCount <= maxHistoryTokens) {
      console.log(
        `MiddleRemovalStrategy: No compression needed (${initialTokenCount} / ${maxHistoryTokens} tokens)`,
      )
      return history
    }

    const totalMessages = history.length
    const removableIndices: number[] = []

    // Identify middle section that can be removed
    // We need at least (preserveStart + preserveEnd) messages to apply this strategy
    if (totalMessages > this.preserveStart + this.preserveEnd) {
      for (let i = this.preserveStart; i < totalMessages - this.preserveEnd; i++) {
        removableIndices.push(i)
      }
    } else {
      // Not enough messages to apply strategy
      console.warn(
        `MiddleRemovalStrategy: Cannot apply - only ${totalMessages} messages (need at least ${this.preserveStart + this.preserveEnd})`,
      )
      return history
    }

    // Remove oldest messages from middle section until token limit is met
    const removedIndices = new Set<number>()
    let currentTokenCount = initialTokenCount

    while (currentTokenCount > maxHistoryTokens && removableIndices.length > 0) {
      // Remove oldest message from middle (shift from start of removableIndices)
      const indexToRemove = removableIndices.shift()!
      removedIndices.add(indexToRemove)

      // Recalculate tokens with current removals
      const remaining = history.filter((_, i) => !removedIndices.has(i))
      currentTokenCount = countMessagesTokens(remaining, tokenizer)
    }

    // Build final compressed history
    const compressed = history.filter((_, i) => !removedIndices.has(i))

    console.log(
      `MiddleRemovalStrategy: Removed ${removedIndices.size} messages from middle section (${initialTokenCount} → ${currentTokenCount} tokens)`,
    )

    return compressed
  }

  public getName(): string {
    return 'MiddleRemoval'
  }
}
