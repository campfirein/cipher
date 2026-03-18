import type {InternalMessage} from '../../../../core/interfaces/message-types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Quality dimensions measured after compression.
 * All scores are 0-1, where 1 is perfect preservation.
 */
export interface CompressionDimensions {
  /** Fraction of key facts (decisions, conclusions) surviving compression. */
  factualCompleteness: number

  /** Fraction of tool names surviving compression. */
  toolContextPreservation: number

  /** Fraction of user intent keywords surviving compression. */
  userIntentClarity: number
}

/**
 * Snapshot of compression quality after the full pipeline completes.
 */
export interface CompressionQualitySnapshot {
  /** Per-dimension scores. */
  dimensions: CompressionDimensions

  /** Weighted overall score: 0.4*factual + 0.35*tool + 0.25*intent. */
  overallScore: number
}

export interface CompressionQualityEvaluatorOptions {
  /** Score threshold below which a warning is emitted (default: 0.5). */
  warningThreshold?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex for detecting key decision phrases in assistant messages. */
const DECISION_PATTERN = /\b(decided|chose|will use|approach|selected|going to)\b/i

/** Weights for overall score calculation. */
const WEIGHT_FACTUAL = 0.4
const WEIGHT_TOOL = 0.35
const WEIGHT_INTENT = 0.25

// ---------------------------------------------------------------------------
// CompressionQualityEvaluator
// ---------------------------------------------------------------------------

/**
 * Pure evaluator that measures compression quality by checking
 * what key information survived the compression pipeline.
 *
 * Uses zero-cost heuristic checks (keyword/substring presence) —
 * no LLM calls, no embeddings.
 *
 * NOT an ICompressionStrategy. Called by ContextManager after the
 * full compression chain completes.
 */
export class CompressionQualityEvaluator {
  public readonly warningThreshold: number

  constructor(options?: CompressionQualityEvaluatorOptions) {
    this.warningThreshold = options?.warningThreshold ?? 0.5
  }

  /**
   * Compare original history against compressed result.
   *
   * @param original - Messages before compression
   * @param compressed - Messages after full compression pipeline
   * @returns Quality snapshot with per-dimension scores
   */
  public evaluate(original: InternalMessage[], compressed: InternalMessage[]): CompressionQualitySnapshot {
    // Extract key facts from original
    const toolNames = this.extractToolNames(original)
    const userIntents = this.extractUserIntents(original)
    const keyDecisions = this.extractKeyDecisions(original)

    // Flatten compressed messages for searching
    const compressedText = this.flattenMessages(compressed)

    // Score each dimension
    const factualCompleteness = this.scorePresence(keyDecisions, compressedText)
    const toolContextPreservation = this.scorePresence(toolNames, compressedText)
    const userIntentClarity = this.scorePresence(userIntents, compressedText)

    const overallScore =
      (WEIGHT_FACTUAL * factualCompleteness) +
      (WEIGHT_TOOL * toolContextPreservation) +
      (WEIGHT_INTENT * userIntentClarity)

    return {
      dimensions: {
        factualCompleteness,
        toolContextPreservation,
        userIntentClarity,
      },
      overallScore,
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Extraction helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract key decision phrases from assistant messages.
   */
  private extractKeyDecisions(messages: InternalMessage[]): string[] {
    const decisions: string[] = []
    for (const msg of messages) {
      if (msg.role !== 'assistant') {
        continue
      }

      for (const text of this.extractTextParts(msg.content)) {
        const sentences = text.split(/[.!?\n]/)
        for (const sentence of sentences) {
          const trimmed = sentence.trim()
          if (trimmed.length > 10 && DECISION_PATTERN.test(trimmed)) {
            decisions.push(trimmed.toLowerCase().slice(0, 150))
          }
        }
      }
    }

    return decisions
  }

  /**
   * Extract text fragments from message content, including array text parts.
   */
  private extractTextParts(content: InternalMessage['content']): string[] {
    if (typeof content === 'string') {
      return [content]
    }

    if (!Array.isArray(content)) {
      return []
    }

    return content.flatMap((part) => {
      if (typeof part === 'object' && part !== null && 'text' in part) {
        return [String((part as {text: string}).text)]
      }

      return []
    })
  }

  /**
   * Extract full tool names from toolCalls arrays (e.g. "read_file", "grep_content").
   */
  private extractToolNames(messages: InternalMessage[]): string[] {
    const names = new Set<string>()
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          if (call.function?.name) {
            names.add(call.function.name)
          }
        }
      }
    }

    return [...names]
  }

  /**
   * Extract first sentence (up to first period or 100 chars) from user messages.
   */
  private extractUserIntents(messages: InternalMessage[]): string[] {
    const intents: string[] = []
    for (const msg of messages) {
      if (msg.role !== 'user') {
        continue
      }

      const text = this.extractTextParts(msg.content).join(' ').trim()
      if (text.length === 0) {
        continue
      }

      const periodIndex = text.indexOf('.')
      const intent = periodIndex > 0 && periodIndex < 100
        ? text.slice(0, periodIndex)
        : text.slice(0, 100)
      intents.push(intent.toLowerCase())
    }

    return intents
  }

  // ---------------------------------------------------------------------------
  // Private: Scoring helpers
  // ---------------------------------------------------------------------------

  /**
   * Flatten all message content into a single lowercase string for searching.
   */
  private flattenMessages(messages: InternalMessage[]): string {
    const parts: string[] = []
    for (const msg of messages) {
      parts.push(...this.extractTextParts(msg.content))

      // Also include tool call function names (they may appear in summary messages)
      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          if (call.function?.name) {
            parts.push(call.function.name)
          }
        }
      }
    }

    return parts.join(' ').toLowerCase()
  }

  /**
   * Score what fraction of items are found as substrings in the target text.
   * Returns 1.0 if items is empty (nothing to check = perfect score).
   */
  private scorePresence(items: string[], targetText: string): number {
    if (items.length === 0) {
      return 1
    }

    let found = 0
    for (const item of items) {
      if (targetText.includes(item.toLowerCase())) {
        found++
      }
    }

    return found / items.length
  }
}
