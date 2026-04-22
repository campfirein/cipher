import {HarnessModeCError} from './harness-mode-c-errors.js'

/**
 * Per-outer-invocation counter for harness-initiated `ctx.tools.*` calls.
 * The cap is the Tier 1 X1 brutal-review gate — 50 ops per
 * `harness.curate()` / `harness.query()` call, regardless of mode.
 *
 * Scope is per-construction: every `SandboxService.buildHarnessTools()`
 * call creates a fresh counter, so the reset boundary is the outer
 * harness invocation. No explicit `.reset()` method — callers replace
 * the instance, not its state.
 */
export const MODE_C_OPS_CAP = 50

export class OpsCounter {
  private readonly cap: number
  private count = 0

  constructor(cap: number = MODE_C_OPS_CAP) {
    this.cap = cap
  }

  /**
   * Increment the counter. Throws `HarnessModeCError` with code
   * `'OPS_CAP_EXCEEDED'` on the `cap + 1`-th call. Caller is
   * responsible for invoking this BEFORE delegating to the real
   * tool — so a cap hit prevents the side effect from landing.
   */
  increment(): void {
    this.count++
    if (this.count > this.cap) {
      throw new HarnessModeCError(
        `Harness Mode C ops cap exceeded: ${this.count} > ${this.cap} tool calls in a single harness.curate() invocation`,
        'OPS_CAP_EXCEEDED',
        {cap: this.cap, count: this.count},
      )
    }
  }
}
