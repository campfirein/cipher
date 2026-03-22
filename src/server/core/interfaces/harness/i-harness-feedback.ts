/**
 * Interface for domain-specific feedback collection in the AutoHarness loop.
 *
 * Each domain (curation, reorg, query) implements its own feedback collector
 * that converts domain-specific outcomes into HarnessFeedback entries.
 */

/**
 * A single feedback entry from an environment rollout.
 */
export interface HarnessFeedback {
  /** Domain-specific feedback data (e.g., operation counts, tier used) */
  details: Record<string, unknown>
  /** The node ID that was selected for this rollout */
  nodeId: string
  /** Whether the rollout was successful */
  success: boolean
  /** Timestamp when feedback was collected (ms) */
  timestamp: number
}

/**
 * Collects feedback from domain-specific execution outcomes.
 *
 * @typeParam TInput - The input type for the domain operation
 * @typeParam TOutput - The output type from the domain operation
 */
export interface IHarnessFeedbackCollector<TInput, TOutput> {
  /** Convert domain-specific input/output into feedback entries. */
  collectFeedback(input: TInput, output: TOutput, nodeId: string): Promise<HarnessFeedback[]>
}
