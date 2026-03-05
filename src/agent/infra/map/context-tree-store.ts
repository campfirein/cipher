/**
 * Context Tree Store.
 *
 * In-memory store implementing bounded buffer with automatic compaction.
 * Two-tier architecture: synchronous buffering with bounded eviction + async final compaction.
 *
 * Hot path (store): synchronous, no LLM calls. If buffer exceeds τ_hard,
 * entries are evicted, summaries consolidated, and single summaries truncated
 * via deterministic truncation in a loop until totalTokens ≤ τ_hard or no
 * further reduction is possible (single entry with no summary).
 *
 * Cold path (compact): called ONCE after worker pool completes.
 * Runs full 3-level escalation to produce high-quality summary.
 *
 * Memory bound: after store() completes, totalTokens ≤ τ_hard + maxSingleLabeledEntrySize
 * where labeled entry size = countTokens("[Item N]: content").
 * The single-entry overshoot covers the item that triggered eviction.
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'
import type {ITokenizer} from '../../core/interfaces/i-tokenizer.js'

import {
  buildDeterministicFallbackCompaction,
  isCompactionOutputValid,
  withAggressiveCompactionDirective,
} from '../../../shared/utils/escalation-utils.js'

/**
 * Options for ContextTreeStore.
 */
export interface ContextTreeStoreOptions {
  /** IContentGenerator for LLM summarization in compact() */
  generator: IContentGenerator
  /** Maximum compaction rounds to prevent infinite loops (default: 10) */
  maxCompactionRounds?: number
  /** Maximum tokens for the final summaryHandle (default: 2000) */
  summaryBudget?: number
  /** Hard limit triggering synchronous eviction */
  tauHard: number
  /** Tokenizer for token counting */
  tokenizer: ITokenizer
}

interface StoreEntry {
  content: string
  tokens: number
}

const SUMMARY_PROMPT = `Summarize the following map processing results concisely, preserving:
- Key findings and patterns across items
- Important values, counts, and statistics
- Any errors or anomalies worth noting
- Actionable insights for the next processing step

Keep the summary focused and information-dense.

Results:
`

/**
 * Context Tree Store with bounded buffer and 3-level compaction.
 */
export class ContextTreeStore {
  private readonly entries: Map<number, StoreEntry> = new Map()
  private readonly generator: IContentGenerator
  private readonly maxCompactionRounds: number
  private readonly summaries: string[] = []
  private readonly summaryBudget: number
  private summaryHandle: string | undefined
  private summaryTokens = 0
  private readonly tauHard: number
  private readonly tokenizer: ITokenizer
  private totalTokens = 0

  constructor(options: ContextTreeStoreOptions) {
    this.generator = options.generator
    this.tokenizer = options.tokenizer
    this.tauHard = options.tauHard
    this.summaryBudget = options.summaryBudget ?? 2000
    this.maxCompactionRounds = options.maxCompactionRounds ?? 10
  }

  /**
   * Canonical entry format — single source of truth for labeled entries.
   * Used in store(), evictOldest(), and compact().
   */
  private static formatEntry(index: number, content: string): string {
    return `[Item ${index}]: ${content}`
  }

  /**
   * Cold path — called ONCE after worker pool completes.
   * Runs full 3-level escalation (may involve LLM calls) to produce
   * high-quality summary from remaining entries + prior summaries.
   */
  async compact(): Promise<void> {
    // Join all summaries + remaining entries into source text
    const parts: string[] = [...this.summaries]
    const sortedEntries = [...this.entries.entries()].sort(([a], [b]) => a - b)
    for (const [index, entry] of sortedEntries) {
      parts.push(ContextTreeStore.formatEntry(index, entry.content))
    }

    const sourceText = parts.join('\n')
    if (!sourceText.trim()) {
      return
    }

    const inputTokens = this.tokenizer.countTokens(sourceText)

    // If already within budget, use directly
    if (inputTokens <= this.summaryBudget) {
      this.summaryHandle = sourceText

      return
    }

    // Level 1: Normal LLM summarization
    const level1 = await this.tryLlmSummarization(sourceText, false)
    if (level1 && this.tokenizer.countTokens(level1) <= this.summaryBudget) {
      this.summaryHandle = level1

      return
    }

    // Level 2: Aggressive LLM summarization
    const level2 = await this.tryLlmSummarization(sourceText, true)
    if (level2 && this.tokenizer.countTokens(level2) <= this.summaryBudget) {
      this.summaryHandle = level2

      return
    }

    // Level 3: Deterministic truncation to fit within summaryBudget
    this.summaryHandle = buildDeterministicFallbackCompaction({
      inputTokens: this.summaryBudget,
      sourceText: level2 ?? level1 ?? sourceText,
      suffixLabel: 'context-tree-compact',
      tokenizer: this.tokenizer,
    })
  }

  /**
   * Returns compact summary text, bounded to summaryBudget tokens.
   * Must call compact() first for LLM-quality output.
   */
  getSummaryHandle(): string | undefined {
    return this.summaryHandle
  }

  /**
   * Hot path — called from processItem(). Synchronous, no LLM calls.
   * If buffer exceeds τ_hard, evicts entries and consolidates summaries
   * until totalTokens ≤ τ_hard or no further reduction is possible.
   */
  store(index: number, content: string): void {
    const tokens = this.tokenizer.countTokens(ContextTreeStore.formatEntry(index, content))

    // Handle index overwrite — subtract old tokens before adding new
    const existing = this.entries.get(index)
    if (existing) {
      this.totalTokens -= existing.tokens
    }

    this.entries.set(index, {content, tokens})
    this.totalTokens += tokens

    // Eviction loop: keep reducing until within budget or stuck
    let rounds = 0
    while (this.totalTokens > this.tauHard && rounds < this.maxCompactionRounds) {
      const before = this.totalTokens
      if (this.entries.size > 1) {
        this.evictOldest()
      } else if (this.summaries.length > 1) {
        this.consolidateSummaries()
      } else if (this.summaries.length === 1 && this.summaryTokens > 0) {
        this.truncateSingleSummary()
      } else {
        break // Single entry + no summaries — can't reduce further
      }

      // Guard: if eviction didn't reduce tokens, stop to prevent infinite loop
      if (this.totalTokens >= before) {
        break
      }

      rounds++
    }
  }

  /**
   * Consolidate all summaries into a single truncated summary.
   * Called when entries alone can't bring totalTokens below τ_hard.
   * Synchronous — uses deterministic truncation only.
   */
  private consolidateSummaries(): void {
    if (this.summaries.length <= 1) {
      return
    }

    const sourceText = this.summaries.join('\n')
    const oldSummaryTokens = this.summaryTokens

    // Deterministic truncation to half of current summary size
    const targetTokens = Math.max(1, Math.floor(oldSummaryTokens / 2))
    const consolidated = buildDeterministicFallbackCompaction({
      inputTokens: targetTokens,
      sourceText,
      suffixLabel: 'context-tree-consolidation',
      tokenizer: this.tokenizer,
    })

    // Replace all summaries with single consolidated one
    this.summaries.length = 0
    this.summaryTokens = 0
    this.totalTokens -= oldSummaryTokens

    if (consolidated) {
      const tokens = this.tokenizer.countTokens(consolidated)
      this.summaries.push(consolidated)
      this.summaryTokens = tokens
      this.totalTokens += tokens
    }
  }

  /**
   * Synchronous eviction of oldest entries via deterministic truncation.
   * Truncates oldest half of entries into a compact summary chunk.
   */
  private evictOldest(): void {
    const sortedKeys = [...this.entries.keys()].sort((a, b) => a - b)
    const evictCount = Math.max(1, Math.floor(sortedKeys.length / 2))
    const keysToEvict = sortedKeys.slice(0, evictCount)

    // Build source text from entries to evict
    const parts: string[] = []
    let evictedTokens = 0
    for (const key of keysToEvict) {
      const entry = this.entries.get(key)!
      parts.push(ContextTreeStore.formatEntry(key, entry.content))
      evictedTokens += entry.tokens
    }

    const sourceText = parts.join('\n')

    // Target = evicted canonical budget (NOT countTokens(sourceText))
    // Since entry.tokens now counts the labeled form, evictedTokens ≈ countTokens(sourceText)
    // minus \n joiners. The binary search guarantees countTokens(summary) < evictedTokens.
    const summary = buildDeterministicFallbackCompaction({
      inputTokens: evictedTokens,
      sourceText,
      suffixLabel: 'context-tree-eviction',
      tokenizer: this.tokenizer,
    })

    // Remove evicted entries
    for (const key of keysToEvict) {
      this.entries.delete(key)
    }

    this.totalTokens -= evictedTokens

    // Store summary chunk — hard safety: drop if not strictly smaller than evicted budget
    if (summary) {
      const summaryTokens = this.tokenizer.countTokens(summary)
      if (summaryTokens < evictedTokens) {
        this.summaries.push(summary)
        this.summaryTokens += summaryTokens
        this.totalTokens += summaryTokens
      }

      // else: drop summary entirely — eviction is still strictly reducing
    }
  }

  /**
   * Truncate a single remaining summary to fit within budget.
   * Called when entries.size <= 1 and summaries.length === 1 but still over τ_hard.
   * Halves the summary via deterministic truncation each round.
   */
  private truncateSingleSummary(): void {
    if (this.summaries.length !== 1 || this.summaryTokens === 0) {
      return
    }

    const sourceText = this.summaries[0]
    const oldTokens = this.summaryTokens

    // Target: budget minus current entry tokens, or half of summary — whichever is smaller
    const entryTokens = this.totalTokens - this.summaryTokens
    const budgetTarget = Math.max(1, this.tauHard - entryTokens)
    const halfTarget = Math.max(1, Math.floor(oldTokens / 2))
    const targetTokens = Math.min(budgetTarget, halfTarget)

    const truncated = buildDeterministicFallbackCompaction({
      inputTokens: targetTokens,
      sourceText,
      suffixLabel: 'context-tree-single-truncation',
      tokenizer: this.tokenizer,
    })

    // Replace summary
    this.summaries.length = 0
    this.summaryTokens = 0
    this.totalTokens -= oldTokens

    if (truncated) {
      const tokens = this.tokenizer.countTokens(truncated)
      this.summaries.push(truncated)
      this.summaryTokens = tokens
      this.totalTokens += tokens
    }
  }

  /**
   * Attempt LLM summarization for compact().
   */
  private async tryLlmSummarization(
    sourceText: string,
    aggressive: boolean,
  ): Promise<string | undefined> {
    try {
      const prompt = aggressive
        ? withAggressiveCompactionDirective(SUMMARY_PROMPT + sourceText)
        : SUMMARY_PROMPT + sourceText

      const maxTokens = aggressive
        ? Math.floor(0.6 * this.summaryBudget)
        : this.summaryBudget

      const response = await this.generator.generateContent({
        config: {maxTokens, temperature: 0},
        contents: [{content: prompt, role: 'user'}],
        model: 'default',
        systemPrompt: 'You are a data summarizer. Produce concise, information-dense summaries of map processing results.',
        taskId: randomUUID(),
      })

      const result = response.content
      if (result && isCompactionOutputValid(result)) {
        return result
      }

      return undefined
    } catch {
      return undefined
    }
  }
}
