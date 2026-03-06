/**
 * Escalated Compression Strategy.
 *
 * Implements the three-level escalation protocol from the LCM paper:
 * 1. Normal LLM summarization
 * 2. Aggressive LLM summarization (0.6× token budget)
 * 3. Deterministic binary-search prefix truncation (guaranteed convergence)
 *
 * Convergence guarantee: output token count is always strictly less than input
 * token count under the same counting function. All byterover-cli tokenizers use
 * char-per-token heuristics, so the binary search in Level 3 always terminates.
 *
 * This strategy is designed to be prepended to the compression chain (before
 * MiddleRemoval + OldestRemoval) so that LLM-quality summaries are attempted
 * first, with hard-cut fallbacks after.
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../../../core/interfaces/i-content-generator.js'
import type {ITokenizer} from '../../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/message-types.js'
import type {ICompressionStrategy} from './types.js'

import {
  buildDeterministicFallbackCompaction,
  isCompactionOutputValid,
  withAggressiveCompactionDirective,
} from '../../../../../shared/utils/escalation-utils.js'
import {
  countHistoryTokens,
  findTurnBoundaries,
  formatMessagesForSummary,
} from './compression-helpers.js'

/**
 * Options for EscalatedCompressionStrategy.
 */
export interface EscalatedCompressionOptions {
  /** IContentGenerator for LLM summarization passes */
  generator: IContentGenerator
  /** Model name for generateContent requests (default: 'default') */
  model?: string
  /** Number of recent user turns to protect from summarization (default: 2) */
  preserveTurns?: number
  /** Maximum output tokens for summary (default: 2200) */
  summaryMaxOutputTokens?: number
}

const SUMMARIZE_PROMPT = `Summarize the following conversation concisely, preserving:
- Key decisions made and rationale
- Important actions taken and their results
- Critical context for continuing the conversation
- Any unresolved questions or pending tasks
- File paths, function names, and technical details that are still relevant

Keep the summary focused and actionable. Do not include unnecessary narrative.

Conversation:
`

/**
 * Escalated Compression Strategy implementing ICompressionStrategy.
 *
 * Three-level escalation ensures practical convergence:
 * - Level 1 & 2: LLM-based — may not reach maxHistoryTokens in one pass
 * - Level 3: Deterministic — binary search always produces output < input
 *
 * ContextManager runs strategies sequentially and stops when totalTokens ≤ maxInputTokens,
 * so MiddleRemoval + OldestRemoval after this strategy serve as hard-cut fallbacks.
 */
export class EscalatedCompressionStrategy implements ICompressionStrategy {
  private readonly generator: IContentGenerator
  private readonly model: string
  private readonly preserveTurns: number
  private readonly summaryMaxOutputTokens: number

  constructor(options: EscalatedCompressionOptions) {
    this.generator = options.generator
    this.model = options.model ?? 'default'
    this.preserveTurns = options.preserveTurns ?? 2
    this.summaryMaxOutputTokens = options.summaryMaxOutputTokens ?? 2200
  }

  async compress(
    history: InternalMessage[],
    maxHistoryTokens: number,
    tokenizer: ITokenizer,
  ): Promise<InternalMessage[]> {
    const currentTokens = countHistoryTokens(history, tokenizer)
    if (currentTokens <= maxHistoryTokens) {
      return history
    }

    // Separate system messages from non-system messages
    const systemMessages = history.filter((m) => m.role === 'system')
    const nonSystemMessages = history.filter((m) => m.role !== 'system')

    // Find turn boundaries and split into summarize/keep
    const turnBoundaries = findTurnBoundaries(nonSystemMessages)
    const turnsToPreserve = Math.min(this.preserveTurns, turnBoundaries.length)
    const preserveFromIndex = turnsToPreserve > 0
      ? turnBoundaries[turnBoundaries.length - turnsToPreserve]
      : nonSystemMessages.length

    const messagesToSummarize = nonSystemMessages.slice(0, preserveFromIndex)
    const messagesToKeep = nonSystemMessages.slice(preserveFromIndex)

    // Need messages to summarize
    if (messagesToSummarize.length === 0) {
      return history
    }

    const inputText = formatMessagesForSummary(messagesToSummarize)
    const inputTokens = tokenizer.countTokens(inputText)

    // Try Level 1: Normal summarization
    const level1Result = await this.tryLlmSummarization(inputText, inputTokens, tokenizer, false)
    if (level1Result) {
      return this.buildResult(systemMessages, level1Result, messagesToSummarize.length, messagesToKeep)
    }

    // Try Level 2: Aggressive summarization
    const level2Result = await this.tryLlmSummarization(inputText, inputTokens, tokenizer, true)
    if (level2Result) {
      return this.buildResult(systemMessages, level2Result, messagesToSummarize.length, messagesToKeep)
    }

    // Level 3: Deterministic fallback (guaranteed convergence)
    const level3Result = buildDeterministicFallbackCompaction({
      inputTokens,
      sourceText: inputText,
      suffixLabel: 'escalated-compression',
      tokenizer,
    })

    return this.buildResult(systemMessages, level3Result, messagesToSummarize.length, messagesToKeep)
  }

  getName(): string {
    return 'EscalatedCompression'
  }

  /**
   * Build the final compressed history with a summary message.
   */
  private buildResult(
    systemMessages: InternalMessage[],
    summaryContent: string,
    summarizedCount: number,
    messagesToKeep: InternalMessage[],
  ): InternalMessage[] {
    const summaryMessage: InternalMessage = {
      content: `[Conversation Summary]\n${summaryContent}`,
      metadata: {
        compactedAt: Date.now(),
        isSummary: true,
        strategy: 'escalated-compression',
        summarizedMessageCount: summarizedCount,
      },
      role: 'system',
    }

    return [...systemMessages, summaryMessage, ...messagesToKeep]
  }

  /**
   * Attempt LLM summarization at a given escalation level.
   *
   * @returns Summary text if accepted, undefined if escalation needed
   */
  private async tryLlmSummarization(
    inputText: string,
    inputTokens: number,
    tokenizer: ITokenizer,
    aggressive: boolean,
  ): Promise<string | undefined> {
    try {
      const prompt = aggressive
        ? withAggressiveCompactionDirective(SUMMARIZE_PROMPT + inputText)
        : SUMMARIZE_PROMPT + inputText

      const maxTokens = aggressive
        ? Math.floor(0.6 * this.summaryMaxOutputTokens)
        : this.summaryMaxOutputTokens

      const response = await this.generator.generateContent({
        config: {maxTokens, temperature: 0},
        contents: [{content: prompt, role: 'user'}],
        model: this.model,
        systemPrompt: 'You are a conversation summarizer. Produce concise, information-dense summaries.',
        taskId: randomUUID(),
      })

      const result = response.content
      if (
        result &&
        tokenizer.countTokens(result) < inputTokens &&
        isCompactionOutputValid(result)
      ) {
        return result
      }

      return undefined
    } catch {
      return undefined
    }
  }
}
