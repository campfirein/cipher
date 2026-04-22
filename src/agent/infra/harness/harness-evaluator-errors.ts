/**
 * AutoHarness V2 — evaluator errors.
 *
 * Structured error for the HarnessEvaluator:
 *
 * - `WRITE_BLOCKED_DURING_EVAL` — the candidate tried to call a
 *   write-only tool (e.g. `ctx.tools.curate`) while dryRun was active.
 * - `CANDIDATE_LOAD_FAILED` — the candidate code failed to parse or
 *   its `meta()` didn't validate through `HarnessModuleBuilder.build`.
 */

export type HarnessEvaluatorErrorCode =
  | 'CANDIDATE_LOAD_FAILED'
  | 'WRITE_BLOCKED_DURING_EVAL'

export class HarnessEvaluatorError extends Error {
  constructor(
    public readonly code: HarnessEvaluatorErrorCode,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(`HarnessEvaluatorError: ${code}`)
    this.name = 'HarnessEvaluatorError'
  }
}
