/**
 * Reactive Overflow compression strategy.
 *
 * This strategy uses an LLM to generate intelligent summaries of older messages
 * when the context window overflows. Unlike simple truncation strategies, it
 * preserves the semantic meaning of the conversation.
 *
 * Algorithm:
 * 1. Check if overflow (currentTokens > maxHistoryTokens)
 * 2. Select oldest non-system messages to summarize
 * 3. Generate LLM summary of selected messages
 * 4. Return: systemMessages + summaryMessage + remainingMessages
 * 5. Summary message has metadata.isSummary = true
 *
 * Key design principles:
 * - Uses same model as conversation (per user configuration)
 * - Summary message marks compaction boundary
 * - filterCompacted() excludes old messages at read-time
 * - Full history preserved in storage for audit
 *
 */

import type {ILlmProvider} from '../../../../core/interfaces/i-llm-provider.js'
import type {ITokenizer} from '../../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/message-types.js'
import type {ICompressionStrategy} from './types.js'

import {
  countHistoryTokens,
  extractTextContent,
  findTurnBoundaries,
  formatMessagesForSummary,
} from './compression-helpers.js'

/**
 * Options for the ReactiveOverflowStrategy.
 */
export interface ReactiveOverflowOptions {
  /** LLM provider for generating summaries */
  llmProvider: ILlmProvider

  /**
   * Minimum messages to consider for summarization.
   * If fewer messages are available, compression is skipped.
   * Default: 10
   */
  minMessagesToSummarize?: number

  /**
   * Model to use for summarization.
   * Default: uses same model as conversation (passed via generate params)
   */
  model?: string

  /**
   * Number of recent turns to always preserve (not summarize).
   * Default: 2
   */
  preserveLastNTurns?: number

  /**
   * Target token count for the summary.
   * Default: 2000
   */
  summaryTargetTokens?: number
}

/**
 * Default configuration values.
 */
const DEFAULTS = {
  minMessagesToSummarize: 10,
  preserveLastNTurns: 2,
  summaryTargetTokens: 2000,
}

/**
 * Reactive Overflow compression strategy.
 *
 * Uses an LLM to generate intelligent summaries when context overflows.
 */
export class ReactiveOverflowStrategy implements ICompressionStrategy {
  private readonly llmProvider: ILlmProvider
  private readonly minMessagesToSummarize: number
  private readonly model?: string
  private readonly preserveLastNTurns: number
  private readonly summaryTargetTokens: number

  constructor(options: ReactiveOverflowOptions) {
    this.llmProvider = options.llmProvider
    this.model = options.model
    this.summaryTargetTokens = options.summaryTargetTokens ?? DEFAULTS.summaryTargetTokens
    this.minMessagesToSummarize = options.minMessagesToSummarize ?? DEFAULTS.minMessagesToSummarize
    this.preserveLastNTurns = options.preserveLastNTurns ?? DEFAULTS.preserveLastNTurns
  }

  async compress(
    history: InternalMessage[],
    maxHistoryTokens: number,
    tokenizer: ITokenizer,
  ): Promise<InternalMessage[]> {
    // Calculate current token count
    const currentTokens = countHistoryTokens(history, tokenizer)

    // Check if compression is needed
    if (currentTokens <= maxHistoryTokens) {
      return history
    }

    // Separate system messages from non-system messages
    const systemMessages = history.filter((m) => m.role === 'system')
    const nonSystemMessages = history.filter((m) => m.role !== 'system')

    // Check if we have enough messages to summarize
    if (nonSystemMessages.length < this.minMessagesToSummarize) {
      // Not enough messages, can't use this strategy
      return history
    }

    // Calculate how many messages to keep (preserve last N turns)
    const turnBoundaries = findTurnBoundaries(nonSystemMessages)
    const turnsToPreserve = Math.min(this.preserveLastNTurns, turnBoundaries.length)
    const preserveFromIndex = turnsToPreserve > 0
      ? turnBoundaries[turnBoundaries.length - turnsToPreserve]
      : nonSystemMessages.length

    // Split messages into "to summarize" and "to keep"
    const messagesToSummarize = nonSystemMessages.slice(0, preserveFromIndex)
    const messagesToKeep = nonSystemMessages.slice(preserveFromIndex)

    // Need enough messages to summarize
    if (messagesToSummarize.length < this.minMessagesToSummarize) {
      return history
    }

    // Generate summary using LLM
    const summaryContent = await this.generateSummary(messagesToSummarize)

    // Create summary message with metadata
    const summaryMessage: InternalMessage = {
      content: `[Conversation Summary]\n${summaryContent}`,
      metadata: {
        compactedAt: Date.now(),
        isSummary: true,
        summarizedMessageCount: messagesToSummarize.length,
      },
      role: 'system',
    }

    // Return: system messages + summary + kept messages
    return [...systemMessages, summaryMessage, ...messagesToKeep]
  }

  getName(): string {
    return 'ReactiveOverflow'
  }

  /**
   * Generate a fallback summary without LLM.
   */
  private generateFallbackSummary(messages: InternalMessage[]): string {
    const userMessages = messages.filter((m) => m.role === 'user')
    const assistantMessages = messages.filter((m) => m.role === 'assistant')
    const toolMessages = messages.filter((m) => m.role === 'tool')

    const lines: string[] = [
      `Summarized ${messages.length} messages:`,
      `- ${userMessages.length} user messages`,
      `- ${assistantMessages.length} assistant responses`,
      `- ${toolMessages.length} tool results`,
    ]

    // Extract key topics from user messages
    const topics = new Set<string>()

    for (const msg of userMessages.slice(0, 5)) {
      const content = extractTextContent(msg)
      const words = content.split(/\s+/).slice(0, 10).join(' ')

      if (words) {
        topics.add(words)
      }
    }

    if (topics.size > 0) {
      const topicLines = ['', 'Key topics discussed:']

      for (const topic of topics) {
        topicLines.push(`- ${topic}...`)
      }

      lines.push(...topicLines)
    }

    return lines.join('\n')
  }

  /**
   * Generate a summary of messages using the LLM.
   */
  private async generateSummary(messages: InternalMessage[]): Promise<string> {
    const conversationText = formatMessagesForSummary(messages)

    const prompt = `You are a conversation summarizer. Summarize the following conversation concisely, preserving:
- Key decisions made
- Important actions taken
- Critical context for continuing the conversation
- Any unresolved questions or tasks

Keep the summary focused and actionable. Do not include unnecessary details.

Conversation:
${conversationText}

Summary:`

    try {
      const summary = await this.llmProvider.generate({
        maxTokens: this.summaryTargetTokens,
        prompt,
        ...(this.model && {model: this.model}),
        temperature: 0.3, // Lower temperature for more consistent summaries
      })

      return summary.trim() || 'Unable to generate summary.'
    } catch {
      // Fallback if LLM fails
      const fallbackSummary = this.generateFallbackSummary(messages)
      return fallbackSummary
    }
  }
}

/**
 * Create a ReactiveOverflowStrategy instance.
 */
export function createReactiveOverflowStrategy(options: ReactiveOverflowOptions): ReactiveOverflowStrategy {
  return new ReactiveOverflowStrategy(options)
}
