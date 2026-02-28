/**
 * Pre-Compaction Service — Three-Level Escalation for curation context.
 *
 * Compacts large source context BEFORE the curation agent sees it,
 * saving the agent from wasting iterations on chunking/extraction code.
 *
 * Fail-open: any error returns the original context unchanged.
 */

import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'

import {CURATION_CHAR_THRESHOLD} from '../../../../shared/constants/curation.js'
import {
  buildDeterministicFallbackCompaction,
  type CompactionEscalationTier,
  estimateTokens,
  isCompactionOutputValid,
  shouldAcceptCompactionOutput,
} from './compaction-escalation.js'
import {buildCompactionSystemPrompt, buildCompactionUserMessage} from './prompts.js'

/**
 * Character threshold below which compaction is skipped.
 * Re-exported from shared constant for backwards compatibility.
 */
export const PRE_COMPACTION_CHAR_THRESHOLD = CURATION_CHAR_THRESHOLD

/**
 * Result of a pre-compaction operation.
 */
export interface PreCompactionResult {
  /** The (possibly compacted) context text */
  context: string
  /** Original character count before compaction */
  originalCharCount: number
  /** Whether compaction was actually applied */
  preCompacted: boolean
  /** Which escalation tier succeeded (only set if preCompacted is true) */
  preCompactionTier?: CompactionEscalationTier
}

/**
 * Service that pre-compacts curation context using three-level escalation.
 *
 * Level 1 (Normal): LLM compaction with standard prompt
 * Level 2 (Aggressive): LLM compaction with aggressive prompt
 * Level 3 (Fallback): Deterministic truncation (no LLM, always converges)
 */
export class PreCompactionService {
  /**
   * Compact context if it exceeds the character threshold.
   *
   * Fail-open: any error during compaction returns the original context.
   * Deterministic fallback is only used when the LLM responded but with
   * unacceptable output — never when the LLM itself errored.
   * Manages its own session lifecycle (creates + deletes a task session).
   *
   * @param agent - The CipherAgent to use for LLM calls
   * @param context - The source context to compact
   * @param taskId - Parent task ID (compaction uses `${taskId}__compact`)
   * @returns PreCompactionResult with the (possibly compacted) context
   */
  async compact(agent: ICipherAgent, context: string, taskId: string): Promise<PreCompactionResult> {
    const originalCharCount = context.length
    const failOpen: PreCompactionResult = {context, originalCharCount, preCompacted: false}

    if (originalCharCount <= PRE_COMPACTION_CHAR_THRESHOLD) {
      return failOpen
    }

    const inputTokens = estimateTokens(context)
    const compactionTaskId = `${taskId}__compact`

    try {
      const sessionId = await agent.createTaskSession(compactionTaskId, 'query')
      try {
        // --- Pass 1: Normal compaction ---
        const normalPass = await this.executeCompactionPass({agent, aggressive: false, context, sessionId, taskId: compactionTaskId})
        if (normalPass.errored) return failOpen
        if (normalPass.output && shouldAcceptCompactionOutput(normalPass.output, inputTokens) && isCompactionOutputValid(normalPass.output)) {
          return {
            context: normalPass.output.trim(),
            originalCharCount,
            preCompacted: true,
            preCompactionTier: 'normal',
          }
        }

        // --- Pass 2: Aggressive compaction ---
        const aggressivePass = await this.executeCompactionPass({agent, aggressive: true, context, sessionId, taskId: compactionTaskId})
        if (aggressivePass.errored) return failOpen
        if (aggressivePass.output && shouldAcceptCompactionOutput(aggressivePass.output, inputTokens) && isCompactionOutputValid(aggressivePass.output)) {
          return {
            context: aggressivePass.output.trim(),
            originalCharCount,
            preCompacted: true,
            preCompactionTier: 'aggressive',
          }
        }

        // --- Pass 3: Deterministic fallback ---
        // Only reached when both passes got LLM responses but output was unacceptable
        const fallbackResult = buildDeterministicFallbackCompaction({
          inputTokens,
          sourceText: context,
          suffixLabel: 'pre-curation compaction',
        })

        return {
          context: fallbackResult,
          originalCharCount,
          preCompacted: true,
          preCompactionTier: 'fallback',
        }
      } finally {
        await agent.deleteTaskSession(sessionId)
      }
    } catch {
      // Fail-open: return original context on ANY error
      return failOpen
    }
  }

  /**
   * Execute a single compaction pass via the agent.
   *
   * Returns a discriminated result so the caller can distinguish
   * "LLM responded with bad output" from "LLM errored" — the former
   * should escalate to the next tier, the latter should fail-open.
   */
  private async executeCompactionPass(
    options: {agent: ICipherAgent; aggressive: boolean; context: string; sessionId: string; taskId: string},
  ): Promise<CompactionPassResult> {
    try {
      const systemPrompt = buildCompactionSystemPrompt()
      const userMessage = buildCompactionUserMessage(options.context, options.aggressive)
      const prompt = `${systemPrompt}\n\n${userMessage}`

      const response = await options.agent.executeOnSession(options.sessionId, prompt, {
        executionContext: {
          clearHistory: true,
          commandType: 'query',
          maxIterations: 1,
          maxTokens: 4096,
          temperature: 0.3,
        },
        taskId: options.taskId,
      })

      return {errored: false, output: response || undefined}
    } catch {
      return {errored: true, output: undefined}
    }
  }
}

/**
 * Discriminated result from a compaction pass.
 * - errored: true  → LLM call failed (caller should fail-open)
 * - errored: false → LLM responded (output may still be unacceptable)
 */
interface CompactionPassResult {
  errored: boolean
  output: string | undefined
}
