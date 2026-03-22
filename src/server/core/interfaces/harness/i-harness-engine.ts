/**
 * Interface for the core AutoHarness engine.
 *
 * The engine coordinates the Thompson-sampling-based template selection,
 * feedback recording, and LLM-based refinement cycle.
 */

import type {IContentGenerator} from '../../../../agent/core/interfaces/i-content-generator.js'
import type {HarnessFeedback} from './i-harness-feedback.js'
import type {HarnessNode} from './i-harness-tree-store.js'

/**
 * Configuration for a harness engine instance.
 */
export interface HarnessEngineConfig {
  /** Heuristic value at which to stop refining (default: 1.0) */
  convergenceThreshold: number
  /** Domain identifier (e.g., 'curation', 'reorg', 'query/decompose') */
  domain: string
  /** Maximum children per node before pruning */
  maxChildren: number
  /** Maximum refinement iterations per feedback batch */
  maxIterations: number
  /** Minimum operations between refinement attempts */
  refinementCooldown: number
}

/**
 * Selection result from the harness engine.
 */
export interface HarnessSelection {
  /** Execution mode based on heuristic threshold */
  mode: 'fast' | 'shadow'
  /** The selected template node */
  node: HarnessNode
}

/**
 * Core harness engine interface.
 *
 * @typeParam TInput - Domain-specific input type
 * @typeParam TOutput - Domain-specific output type
 */
export interface IHarnessEngine {
  /** Record feedback from an environment rollout. Updates alpha/beta and heuristic. */
  recordOutcome(feedback: HarnessFeedback): Promise<void>
  /** Refine a node based on consolidated error feedback. Returns new child node. */
  refine(nodeId: string, feedbackSummary: string): Promise<HarnessNode>
  /** Select the best template via Thompson sampling. Returns null if no templates exist. */
  selectTemplate(domain: string): Promise<HarnessSelection | null>
  /** Set or replace the content generator used for critic/refiner calls. */
  setContentGenerator(generator: IContentGenerator): void
  /** Check if refinement should be triggered for the domain. */
  shouldRefine(domain: string, nodeId?: string): boolean
}
