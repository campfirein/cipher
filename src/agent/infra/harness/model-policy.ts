/**
 * AutoHarness V2 — Weak-model refinement block-list.
 *
 * Models <10B parameters are skipped for refinement — they produce
 * too many syntactically-invalid Refiner outputs to be worth the
 * cost in v1.0. Users can override via `config.harness.refinementModel`.
 *
 * See `v1-design-decisions.md §2.6` for the full list with rationale.
 */

/**
 * Models known to produce low-quality refiner output.
 * Substring-matched against the runtime model ID (case-insensitive).
 */
export const REFINEMENT_MODEL_BLOCKLIST: readonly string[] = [
  'gemma-2-9b-it',
  'llama-3.1-8b-instruct',
  'mistral-7b-instruct',
  'phi-3-mini',
  'qwen-2.5-7b-instruct',
] as const

/**
 * Returns `true` when `modelId` matches any entry in the blocklist.
 * Comparison is case-insensitive substring match so provider-specific
 * prefixes (e.g., `together/llama-3.1-8b-instruct`) are handled.
 */
export function isBlocklistedForRefinement(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return REFINEMENT_MODEL_BLOCKLIST.some((blocked) => lower.includes(blocked))
}
