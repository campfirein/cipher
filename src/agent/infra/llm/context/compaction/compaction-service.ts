import type {CompactionResult} from '../../../../core/domain/storage/message-storage-types.js'
import type {IContentGenerator} from '../../../../core/interfaces/i-content-generator.js'
import type {ITokenizer} from '../../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/message-types.js'
import type {MessageStorageService} from '../../../storage/message-storage-service.js'

/**
 * Configuration for compaction behavior.
 */
export interface CompactionConfig {
  /**
   * Percentage of context tokens that triggers compaction (0.0 - 1.0).
   * Default: 0.85 (85%)
   */
  overflowThreshold?: number

  /**
   * Number of recent user turns to protect from pruning.
   * Based on OpenCode's turn-based protection pattern.
   * Tool outputs in these turns will not be compacted.
   * Default: 2
   */
  protectedTurns?: number

  /**
   * Number of tokens to keep in tool outputs after pruning.
   * Based on OpenCode's PRUNE_PROTECT constant.
   * Default: 40000
   */
  pruneKeepTokens?: number

  /**
   * Minimum tokens that must be recoverable to perform pruning.
   * Based on OpenCode's PRUNE_MINIMUM constant.
   * If pruning would save less than this, skip it.
   * Default: 20000
   */
  pruneMinimumTokens?: number

  /**
   * System prompt for generating compaction summaries.
   */
  summaryPrompt?: string
}

/**
 * Default prompt for generating conversation summaries.
 * Based on OpenCode's PROMPT_COMPACTION.
 */
const DEFAULT_SUMMARY_PROMPT = `You are a helpful assistant that summarizes conversations.
Given the conversation history, provide a detailed summary that captures:
1. The main tasks or goals discussed
2. Key decisions and outcomes
3. Important context that should be preserved
4. Any unfinished work or pending items

Format the summary as a clear, comprehensive prompt that could be used to continue the conversation.
Focus on the "what" and "why" rather than the step-by-step "how".`

/**
 * Result of checking for context overflow.
 */
export interface OverflowCheckResult {
  /** Current token count */
  currentTokens: number
  /** Whether overflow threshold is exceeded */
  isOverflow: boolean
  /** Maximum allowed tokens */
  maxTokens: number
  /** Recommended action */
  recommendation: 'compact' | 'none' | 'prune'
}

/**
 * Input for compaction operations.
 */
export interface CompactionInput {
  /** Maximum context tokens allowed */
  contextLimit: number
  /** Current token count (including all messages) */
  currentTokens: number
  /** Session ID to compact */
  sessionId: string
}

/**
 * Service for managing context compaction in granular history storage.
 *
 * Compaction reduces context size through two mechanisms:
 * 1. Tool output pruning - marks old tool outputs as compacted
 * 2. Compaction boundaries - summarizes old history and creates a boundary
 *
 * Based on OpenCode's compaction patterns:
 * - isOverflow() checks if context exceeds threshold
 * - prune() marks old tool outputs as compacted
 * - insertCompactionBoundary() creates a summary boundary
 */
export class CompactionService {
  private readonly config: Required<CompactionConfig>

  constructor(
    private readonly messageStorage: MessageStorageService,
    private readonly tokenizer: ITokenizer,
    config?: CompactionConfig,
  ) {
    this.config = {
      overflowThreshold: config?.overflowThreshold ?? 0.85,
      protectedTurns: config?.protectedTurns ?? 2,
      pruneKeepTokens: config?.pruneKeepTokens ?? 40_000,
      pruneMinimumTokens: config?.pruneMinimumTokens ?? 20_000,
      summaryPrompt: config?.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
    }
  }

  /**
   * Perform automatic compaction based on current context state.
   * This is a convenience method that checks overflow and takes appropriate action.
   *
   * @returns CompactionResult if action was taken, undefined if no action needed
   */
  async autoCompact(input: CompactionInput): Promise<CompactionResult | undefined> {
    const {contextLimit, currentTokens, sessionId} = input
    const overflowCheck = this.checkOverflow(currentTokens, contextLimit)

    if (!overflowCheck.isOverflow) {
      return undefined
    }

    if (overflowCheck.recommendation === 'prune') {
      return this.pruneToolOutputs(sessionId)
    }

    // For full compaction, we need the caller to generate the summary
    // via the LLM, then call createCompactionBoundary
    // Return a result indicating compaction is needed
    return {
      compactedCount: 0,
      compactionMessageId: undefined,
      tokensSaved: 0,
    }
  }

  /**
   * Check if context is overflowing and recommend action.
   */
  checkOverflow(currentTokens: number, contextLimit: number): OverflowCheckResult {
    const threshold = contextLimit * this.config.overflowThreshold
    const isOverflow = currentTokens > threshold

    let recommendation: 'compact' | 'none' | 'prune' = 'none'
    if (isOverflow) {
      // First try pruning tool outputs
      recommendation = 'prune'
      // If we're significantly over, suggest full compaction
      if (currentTokens > contextLimit * 0.95) {
        recommendation = 'compact'
      }
    }

    return {
      currentTokens,
      isOverflow,
      maxTokens: contextLimit,
      recommendation,
    }
  }

  /**
   * Create a compaction boundary with the given summary.
   * The boundary acts as a marker - history loading stops here.
   */
  async createCompactionBoundary(sessionId: string, summary: string): Promise<void> {
    await this.messageStorage.insertCompactionBoundary(sessionId, summary)
  }

  /**
   * Estimate tokens for a text string.
   * Uses the configured tokenizer.
   */
  async estimateTokens(text: string): Promise<number> {
    return this.tokenizer.countTokens(text)
  }

  /**
   * Generate a compaction summary using the LLM.
   * Called when context overflow requires full compaction (not just pruning).
   *
   * @param generator - The content generator to use for LLM calls
   * @param messages - The conversation history to summarize
   * @param taskId - Task ID from usecase for billing tracking
   * @param model - The model ID to use for generation
   * @returns The generated summary text
   */
  async generateSummary(
    generator: IContentGenerator,
    messages: InternalMessage[],
    taskId: string,
    model: string,
  ): Promise<string> {
    const {systemPrompt, userMessage} = this.getSummaryPromptParts()

    // Bound messages to prevent the summary call itself from overflowing.
    // Keep first 5 messages (initial context) + last 35 messages (recent work).
    const MAX_MESSAGES_FOR_SUMMARY = 40
    const boundedMessages = messages.length > MAX_MESSAGES_FOR_SUMMARY
      ? [
          ...messages.slice(0, 5),
          {
            content: `[${messages.length - MAX_MESSAGES_FOR_SUMMARY} messages omitted for summarization]`,
            role: 'system' as const,
          },
          ...messages.slice(-(MAX_MESSAGES_FOR_SUMMARY - 5)),
        ]
      : messages

    try {
      const response = await generator.generateContent({
        config: {
          maxTokens: 4096, // Reasonable limit for summaries
          temperature: 0.3, // Lower temperature for more focused summaries
        },
        contents: [...boundedMessages, {content: userMessage, role: 'user'}],
        model,
        systemPrompt,
        taskId,
        tools: {}, // No tools for summary generation
      })

      return typeof response.content === 'string' ? response.content : '[Summary generation failed]'
    } catch {
      return '[Summary generation failed due to error]'
    }
  }

  /**
   * Get the current compaction configuration.
   */
  getConfig(): Readonly<Required<CompactionConfig>> {
    return this.config
  }

  /**
   * Generate a summary prompt for the LLM to create a compaction summary.
   * This returns the system prompt and user message to send to the LLM.
   */
  getSummaryPromptParts(): {systemPrompt: string; userMessage: string} {
    return {
      systemPrompt: this.config.summaryPrompt,
      userMessage:
        'Provide a detailed prompt for continuing our conversation above. ' +
        'Focus on information that would be helpful for continuing the conversation, including ' +
        'what we did, what we are doing, which files we are working on, and what we are going to do next ' +
        'considering a new session will not have access to our conversation.',
    }
  }

  /**
   * Prune old tool outputs to reduce context size.
   * Keeps the most recent tool outputs up to the configured token limit.
   * Only executes if minimum token threshold can be recovered.
   *
   * @param sessionId - The session to prune
   * @returns CompactionResult with count and tokens saved (or zeros if below threshold)
   */
  async pruneToolOutputs(sessionId: string): Promise<CompactionResult> {
    const result = await this.messageStorage.pruneToolOutputs({
      keepTokens: this.config.pruneKeepTokens,
      minimumTokens: this.config.pruneMinimumTokens,
      protectedTurns: this.config.protectedTurns,
      sessionId,
    })

    return result
  }
}

/**
 * Factory function to create CompactionService.
 */
export function createCompactionService(
  messageStorage: MessageStorageService,
  tokenizer: ITokenizer,
  config?: CompactionConfig,
): CompactionService {
  return new CompactionService(messageStorage, tokenizer, config)
}
