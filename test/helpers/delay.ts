/**
 * Shared `delay` helper for tests that need to simulate async work or
 * wait on cooperative AbortSignal cancellation. Extracted in Phase 2 to
 * avoid duplication across curate-flow tests (PHASE-2-CODE-REVIEW I1).
 */

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    })
  })
}
