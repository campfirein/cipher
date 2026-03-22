/**
 * Curation harness service — orchestrates AutoHarness for curation.
 *
 * Coordinates: template selection → execution → feedback → refinement.
 * Used by CurateExecutor as an optional dependency.
 */

import type {CurateLogOperation} from '../../../core/domain/entities/curate-log-entry.js'
import type {HarnessNode} from '../../../core/interfaces/harness/i-harness-tree-store.js'

import {HarnessEngine} from '../harness-engine.js'
import {buildCurationFeedback, extractPredictionsFromTemplate, scoreShadow} from './curation-feedback-collector.js'

/**
 * Result from template selection.
 */
export interface CurationTemplateSelection {
  /** Execution mode */
  mode: 'fast' | 'shadow'
  /** Selected template node */
  node: HarnessNode
}

/**
 * Service that wraps HarnessEngine for curation-specific concerns.
 */
export class CurationHarnessService {
  constructor(private readonly engine: HarnessEngine) {}

  /**
   * Record an execution-level failure for fast-path runs that terminated after
   * a mutate-capable tool had already started. This penalizes the template even
   * when curate operations alone would look successful or when no operations
   * could be extracted from the partial run.
   */
  async recordExecutionFailure(
    nodeId: string,
    operations: CurateLogOperation[],
    terminalReason: string,
  ): Promise<void> {
    const successes = operations.filter((op) => op.status === 'success').length
    const failures = operations.filter((op) => op.status !== 'success').length

    await this.engine.recordOutcome({
      details: {
        failures,
        mode: 'fast',
        successes,
        terminalReason,
        total: operations.length,
      },
      nodeId,
      success: false,
      timestamp: Date.now(),
    })
  }

  /**
   * Record feedback from a curation execution (fast path or normal path).
   *
   * Returns without updating if operations is empty (neutral signal).
   */
  async recordFeedback(nodeId: string, operations: CurateLogOperation[]): Promise<void> {
    const feedback = buildCurationFeedback(nodeId, operations)
    if (!feedback) return

    await this.engine.recordOutcome(feedback)
  }

  /**
   * Record shadow-mode feedback by comparing template predictions vs actual operations.
   *
   * Extracts predictions from the template's YAML content by matching keywords
   * against the input context, then scores via F1 against actual operations.
   * Uses fractional alpha/beta updates via recordOutcomeF1().
   *
   * @param node - The template node that was shadow-evaluated
   * @param effectiveContext - The input context that was curated
   * @param actuals - Actual CurateLogOperation[] from the real execution
   */
  async recordShadowFeedback(
    node: HarnessNode,
    effectiveContext: string,
    actuals: CurateLogOperation[],
  ): Promise<void> {
    const predictions = extractPredictionsFromTemplate(node.templateContent, effectiveContext)
    const update = scoreShadow(predictions, actuals)
    if (!update) return

    const feedback = {
      details: {
        actuals: actuals.length,
        f1: update.alpha,
        mode: 'shadow',
        predictions: predictions.length,
      },
      nodeId: node.id,
      success: update.alpha > update.beta,
      timestamp: Date.now(),
    }

    // Use fractional F1 updates, not binary success/failure
    await this.engine.recordOutcomeF1(node.id, update.alpha, update.beta, feedback)
  }

  /**
   * Trigger async refinement if cooldown passed and failures exist.
   * Call this non-blocking (fire-and-forget with .catch(() => {})).
   */
  async refineIfNeeded(nodeId: string): Promise<HarnessNode | null> {
    return this.engine.runRefinementCycle(nodeId)
  }

  /**
   * Select the best curation template via Thompson sampling.
   * Returns null if no templates exist.
   */
  async selectTemplate(): Promise<CurationTemplateSelection | null> {
    const selection = await this.engine.selectTemplate('curation')
    if (!selection) return null

    return {
      mode: selection.mode,
      node: selection.node,
    }
  }

  /**
   * Set the content generator for critic/refiner LLM calls.
   * Call after the agent starts to enable refinement.
   */
  setContentGenerator(generator: import('../../../../agent/core/interfaces/i-content-generator.js').IContentGenerator): void {
    this.engine.setContentGenerator(generator)
  }
}
