/**
 * Thompson sampling functions for AutoHarness template selection.
 *
 * Provides pure, stateless functions for:
 * - Beta distribution sampling (exploration/exploitation balance)
 * - Node selection via Thompson sampling
 * - Beta parameter updates after observing outcomes
 *
 * Follows the same pure-function pattern as memory-scoring.ts.
 */

import type {HarnessNode} from '../../core/interfaces/harness/i-harness-tree-store.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum alpha/beta to prevent degenerate distributions */
export const MIN_BETA_PARAM = 0.1

/** Default prior: slightly optimistic (encourages exploration of new nodes) */
export const DEFAULT_ALPHA = 1
export const DEFAULT_BETA = 1

/** Heuristic threshold for fast-path execution */
export const FAST_PATH_THRESHOLD = 0.9

// ---------------------------------------------------------------------------
// Beta distribution sampling
// ---------------------------------------------------------------------------

/**
 * Sample from a Beta(alpha, beta) distribution using the Jönk algorithm.
 *
 * Returns a value in [0, 1] representing the sampled success probability.
 * Used for exploration/exploitation balance in template selection.
 *
 * @param alpha - Success count (must be > 0)
 * @param beta - Failure count (must be > 0)
 * @returns Sampled value in [0, 1]
 */
export function sampleBeta(alpha: number, beta: number): number {
  const a = Math.max(alpha, MIN_BETA_PARAM)
  const b = Math.max(beta, MIN_BETA_PARAM)

  // Use the gamma distribution method: Beta(a,b) = Ga(a)/(Ga(a)+Ga(b))
  const x = sampleGamma(a)
  const y = sampleGamma(b)

  if (x + y === 0) return 0.5 // degenerate case
  return x / (x + y)
}

/**
 * Sample from a Gamma(shape, 1) distribution using the Marsaglia-Tsang method.
 *
 * @param shape - Shape parameter (must be > 0)
 * @returns Sampled value >= 0
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a+1) * U^(1/a)
    const u = Math.random()
    return sampleGamma(shape + 1) * u ** (1 / shape)
  }

  // Marsaglia-Tsang method for shape >= 1
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  for (;;) {
    let x: number
    let v: number

    do {
      x = gaussianRandom()
      v = 1 + c * x
    } while (v <= 0)

    v *= v * v
    const u = Math.random()

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v
    }
  }
}

/**
 * Generate a standard normal random variable using the Box-Muller transform.
 */
function gaussianRandom(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// ---------------------------------------------------------------------------
// Node selection
// ---------------------------------------------------------------------------

/**
 * Select the best node via Thompson sampling from a set of candidates.
 *
 * Each node is sampled from its Beta(alpha, beta) distribution.
 * The node with the highest sample is selected. This naturally
 * balances exploration (uncertain nodes get sampled high sometimes)
 * with exploitation (high-performing nodes get sampled high often).
 *
 * @param nodes - Candidate nodes to select from
 * @returns The selected node, or null if the array is empty
 */
export function thompsonSelect(nodes: HarnessNode[]): HarnessNode | null {
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0]

  let bestNode: HarnessNode | null = null
  let bestSample = -1

  for (const node of nodes) {
    const sample = sampleBeta(node.alpha, node.beta)
    if (sample > bestSample) {
      bestSample = sample
      bestNode = node
    }
  }

  return bestNode
}

/**
 * Determine execution mode based on a node's heuristic value.
 *
 * @param node - The selected node
 * @returns 'fast' if heuristic >= threshold, 'shadow' otherwise
 */
export function determineMode(node: HarnessNode): 'fast' | 'shadow' {
  return node.heuristic >= FAST_PATH_THRESHOLD ? 'fast' : 'shadow'
}

// ---------------------------------------------------------------------------
// Beta parameter updates
// ---------------------------------------------------------------------------

/**
 * Update alpha/beta parameters after observing a success or failure.
 *
 * @param node - Current node state
 * @param success - Whether the rollout was successful
 * @returns Updated alpha and beta values
 */
export function updateBetaParams(
  node: HarnessNode,
  success: boolean,
): {alpha: number; beta: number; heuristic: number} {
  const newAlpha = node.alpha + (success ? 1 : 0)
  const newBeta = node.beta + (success ? 0 : 1)
  const heuristic = newAlpha / (newAlpha + newBeta)

  return {alpha: newAlpha, beta: newBeta, heuristic}
}

/**
 * Update alpha/beta parameters with fractional F1-score feedback (shadow mode).
 *
 * @param node - Current node state
 * @param f1Alpha - F1-derived alpha increment (precision*recall blend)
 * @param f1Beta - F1-derived beta increment (1 - F1)
 * @returns Updated alpha, beta, and heuristic
 */
export function updateBetaParamsF1(
  node: HarnessNode,
  f1Alpha: number,
  f1Beta: number,
): {alpha: number; beta: number; heuristic: number} {
  const newAlpha = node.alpha + f1Alpha
  const newBeta = node.beta + f1Beta
  const heuristic = newAlpha / (newAlpha + newBeta)

  return {alpha: newAlpha, beta: newBeta, heuristic}
}

/**
 * Apply importance decay to a node's heuristic (stale templates lose priority).
 *
 * @param node - Current node state
 * @param daysSinceLastUpdate - Days since the node was last updated
 * @param decayFactor - Per-day decay multiplier (default: 0.995, matching memory-scoring)
 * @returns Decayed heuristic value
 */
export function applyHeuristicDecay(
  node: HarnessNode,
  daysSinceLastUpdate: number,
  decayFactor = 0.995,
): number {
  return node.heuristic * (decayFactor ** daysSinceLastUpdate)
}
