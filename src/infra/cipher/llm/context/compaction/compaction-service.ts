import type {CompactionResult} from '../../../../../core/domain/cipher/storage/message-storage-types.js'
import type {ITokenizer} from '../../../../../core/interfaces/cipher/i-tokenizer.js'
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
   * Number of tokens to keep in tool outputs after pruning.
   * Default: 40000
   */
  pruneKeepTokens?: number

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
      pruneKeepTokens: config?.pruneKeepTokens ?? 40_000,
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
        'Based on our conversation so far, provide a detailed summary that captures all important context. ' +
        'This summary will be used to continue the conversation without the full history.',
    }
  }

  /**
   * Prune old tool outputs to reduce context size.
   * Keeps the most recent tool outputs up to the configured token limit.
   */
  async pruneToolOutputs(sessionId: string): Promise<CompactionResult> {
    return this.messageStorage.pruneToolOutputs({
      keepTokens: this.config.pruneKeepTokens,
      sessionId,
    })
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
