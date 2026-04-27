import {AsyncLocalStorage} from 'node:async_hooks'

/**
 * Async-context scope for the daemon-stamped `reviewDisabled` value.
 *
 * The daemon snapshots the project's reviewDisabled flag once at task-create
 * and forwards it via TaskExecute. The agent process opens an
 * `AsyncLocalStorage` scope around the task body so any descendant async
 * callsite — direct curate-tool invocation, sandbox `tools.curate(...)` via
 * CurateService, or anything else awaiting under the same chain — observes the
 * single snapshot value instead of re-reading `.brv/config.json` (which can
 * race with mid-task user toggles).
 *
 * Same propagation pattern as `CurateResultCollector`
 * (src/agent/infra/sandbox/curate-result-collector.ts): AsyncLocalStorage flows
 * through the LLM streaming pipeline and the in-process sandbox, so callers
 * without an explicit taskId still see the right value.
 *
 * Outside any scope, `getCurrentReviewDisabled()` returns `undefined` and the
 * caller falls back to its own resolution path (currently a `.brv/config.json`
 * read in `executeCurate`).
 */
const reviewDisabledStorage = new AsyncLocalStorage<boolean>()

export function runWithReviewDisabled<T>(reviewDisabled: boolean, fn: () => Promise<T>): Promise<T> {
  return reviewDisabledStorage.run(reviewDisabled, fn)
}

export function getCurrentReviewDisabled(): boolean | undefined {
  return reviewDisabledStorage.getStore()
}
