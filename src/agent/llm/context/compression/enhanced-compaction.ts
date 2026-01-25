/**
 * Enhanced Compaction Strategy
 *
 * Extends the ReactiveOverflowStrategy with additional features from OpenCode:
 * - Creates CompactionPart to track compaction metadata
 * - Preserves last 2 conversation turns (configurable)
 * - Only compacts if saving > 20K tokens (configurable)
 * - Emits compaction events for observability
 *
 * This is a wrapper that adds these features on top of the existing
 * ReactiveOverflowStrategy for backward compatibility.
 */

import type {ITokenizer} from '../../../interfaces/i-tokenizer.js'
import type {CompactionPart, InternalMessage} from '../../../interfaces/message-types.js'
import type {SessionEventBus} from '../../../events/event-emitter.js'
import type {ICompressionStrategy} from './types.js'

import {type ReactiveOverflowOptions, ReactiveOverflowStrategy} from './reactive-overflow.js'

/**
 * Configuration for enhanced compaction.
 */
export interface EnhancedCompactionOptions extends ReactiveOverflowOptions {
  /**
   * Event bus for emitting compaction events.
   * Optional - if not provided, events won't be emitted.
   */
  eventBus?: SessionEventBus

  /**
   * Minimum token savings required to trigger compaction.
   * Default: 20000 (20K tokens)
   */
  minTokenSavings?: number

  /**
   * Number of recent conversation turns to always preserve.
   * Default: 2
   */
  preserveTurns?: number
}

/**
 * Default configuration values.
 */
const ENHANCED_DEFAULTS = {
  minTokenSavings: 20_000,
  preserveTurns: 2,
}

/**
 * Enhanced Compaction Strategy.
 *
 * Wraps ReactiveOverflowStrategy with additional OpenCode-style features:
 * - Token savings threshold
 * - CompactionPart creation
 * - Event emission
 *
 * @example
 * ```typescript
 * const strategy = new EnhancedCompactionStrategy({
 *   llmProvider: myLlmProvider,
 *   eventBus: sessionEventBus,
 *   minTokenSavings: 20000,
 *   preserveTurns: 2,
 * })
 *
 * const compactedHistory = await strategy.compress(history, maxTokens, tokenizer)
 * ```
 */
export class EnhancedCompactionStrategy implements ICompressionStrategy {
  private readonly baseStrategy: ReactiveOverflowStrategy
  private readonly eventBus?: SessionEventBus
  /** Track the last compaction result for observability */
  private lastCompactionResult?: CompactionResult
  private readonly minTokenSavings: number
  private readonly preserveTurns: number

  constructor(options: EnhancedCompactionOptions) {
    // Create base strategy with configured preserve turns
    this.baseStrategy = new ReactiveOverflowStrategy({
      ...options,
      preserveLastNTurns: options.preserveTurns ?? ENHANCED_DEFAULTS.preserveTurns,
    })

    this.eventBus = options.eventBus
    this.minTokenSavings = options.minTokenSavings ?? ENHANCED_DEFAULTS.minTokenSavings
    this.preserveTurns = options.preserveTurns ?? ENHANCED_DEFAULTS.preserveTurns
  }

  /**
   * Compress history with enhanced features.
   */
  async compress(
    history: InternalMessage[],
    maxHistoryTokens: number,
    tokenizer: ITokenizer,
  ): Promise<InternalMessage[]> {
    // Calculate tokens before compression
    const tokensBefore = this.countTokens(history, tokenizer)

    // Check if compression is needed at all
    if (tokensBefore <= maxHistoryTokens) {
      return history
    }

    // Apply base compression strategy
    const compressedHistory = await this.baseStrategy.compress(history, maxHistoryTokens, tokenizer)

    // Calculate tokens after compression
    const tokensAfter = this.countTokens(compressedHistory, tokenizer)
    const tokensSaved = tokensBefore - tokensAfter

    // Check minimum savings threshold
    if (tokensSaved < this.minTokenSavings) {
      // Not enough savings, return original (let other strategies handle it)
      return history
    }

    // Find compacted message IDs (messages that were removed or summarized)
    const compactedMessageIds = this.findCompactedMessageIds(history, compressedHistory)

    // Create compaction result for tracking
    this.lastCompactionResult = {
      compactedAt: Date.now(),
      compactedMessageIds,
      messageCountAfter: compressedHistory.length,
      messageCountBefore: history.length,
      tokensAfter,
      tokensBefore,
      tokensSaved,
    }

    // Emit compaction event if event bus provided
    if (this.eventBus) {
      this.eventBus.emit('llmservice:contextCompressed', {
        compressedTokens: tokensAfter,
        originalTokens: tokensBefore,
        strategy: 'summary',
      })
    }

    return compressedHistory
  }

  /**
   * Create a CompactionPart for the given compaction result.
   * Can be used to insert into message parts for tracking.
   */
  createCompactionPart(summary: string): CompactionPart | undefined {
    if (!this.lastCompactionResult) {
      return undefined
    }

    return {
      compactedMessageIds: this.lastCompactionResult.compactedMessageIds,
      id: `compaction-${Date.now()}`,
      summary,
      timestamp: this.lastCompactionResult.compactedAt,
      tokensSaved: this.lastCompactionResult.tokensSaved,
      type: 'compaction',
    }
  }

  /**
   * Get the last compaction result for observability.
   */
  getLastCompactionResult(): CompactionResult | undefined {
    return this.lastCompactionResult
  }

  getName(): string {
    return 'EnhancedCompaction'
  }

  /**
   * Count total tokens in history.
   */
  private countTokens(history: InternalMessage[], tokenizer: ITokenizer): number {
    let total = 0

    for (const message of history) {
      // Role overhead
      total += 4

      if (typeof message.content === 'string') {
        total += tokenizer.countTokens(message.content)
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          total +=
            part.type === 'text' || part.type === 'reasoning'
              ? tokenizer.countTokens(part.text)
              : 100 // Estimate for non-text parts
        }
      }

      // Tool calls overhead
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          total += tokenizer.countTokens(call.function.name)
          total += tokenizer.countTokens(call.function.arguments)
        }
      }
    }

    return total
  }

  /**
   * Find message IDs that were compacted (removed or summarized).
   * Since messages don't have IDs, we use indices as pseudo-IDs.
   */
  private findCompactedMessageIds(original: InternalMessage[], compressed: InternalMessage[]): string[] {
    const compactedIds: string[] = []
    const compressedCount = compressed.filter((m) => !m.metadata?.isSummary).length

    // Messages from index 0 to (original.length - compressedCount) were compacted
    const compactedCount = original.length - compressedCount

    for (let i = 0; i < compactedCount; i++) {
      compactedIds.push(`msg-${i}`)
    }

    return compactedIds
  }
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** Timestamp when compaction occurred */
  compactedAt: number
  /** IDs of messages that were compacted */
  compactedMessageIds: string[]
  /** Number of messages after compaction */
  messageCountAfter: number
  /** Number of messages before compaction */
  messageCountBefore: number
  /** Token count after compaction */
  tokensAfter: number
  /** Token count before compaction */
  tokensBefore: number
  /** Tokens saved by compaction */
  tokensSaved: number
}

/**
 * Create an EnhancedCompactionStrategy instance.
 */
export function createEnhancedCompactionStrategy(options: EnhancedCompactionOptions): EnhancedCompactionStrategy {
  return new EnhancedCompactionStrategy(options)
}
