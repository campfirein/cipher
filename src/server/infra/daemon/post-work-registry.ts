/**
 * PostWorkRegistry
 *
 * Tracks fire-and-forget work that runs after `task:completed` is emitted to
 * the user — primarily the post-curate Phase 4 (summary regeneration, manifest
 * rebuild, dream-state increment, background drain).
 *
 * Three guarantees:
 *   - Work submitted for the same project runs serially (per-project mutex).
 *     Two concurrent curates' Phase 4 cannot race on snapshot pre-state or
 *     `_index.md` writes.
 *   - Work for different projects runs concurrently. No global lock.
 *   - The daemon can `drain()` on shutdown — wait for in-flight thunks to
 *     finish, abandoning any that exceed the timeout. Without this, SIGTERM
 *     during a propagateStaleness call could truncate a partially-written
 *     `_index.md`.
 *
 * Errors inside a thunk are swallowed (logged via the optional `onError`).
 * The registry is fail-open — one bad thunk must not block subsequent work.
 */

export type PostWorkThunk = () => Promise<void>

export type PostWorkRegistryOptions = {
  /** Optional logger called on thunk errors. Stays light to keep the registry test-friendly. */
  onError?: (projectPath: string, error: unknown) => void
}

export class PostWorkRegistry {
  /** Optional logger called when a thunk throws. */
  private readonly onError?: (projectPath: string, error: unknown) => void
  /**
   * Per-project tail promise. Each `submit(project, thunk)` chains the new
   * thunk after the previous tail. The tail is replaced atomically so the
   * next submission picks up the latest one without races.
   */
  private readonly tails = new Map<string, Promise<void>>()

  public constructor(options: PostWorkRegistryOptions = {}) {
    this.onError = options.onError
  }

  /**
   * Wait until all currently-queued work across all projects completes. New
   * submissions arriving during the await are NOT awaited — only the tails
   * captured at call time. Used by the deferred hot-swap path so the agent
   * is not rebuilt while a Phase 4 thunk is mid-LLM-call (ENG-2522).
   */
  public async awaitAll(): Promise<void> {
    const tails = [...this.tails.values()]
    if (tails.length === 0) return
    // Tails are guaranteed not to reject — submit() swallows errors via onError.
    await Promise.all(tails)
  }

  /**
   * Wait until all currently-queued work for `projectPath` completes. New
   * submissions arriving during the await are NOT awaited — only the tail
   * captured at call time. This makes `--wait-finalize` deterministic.
   */
  public async awaitProject(projectPath: string): Promise<void> {
    const tail = this.tails.get(projectPath)
    if (tail) {
      await tail
    }
  }

  /**
   * Drain all in-flight work across all projects. Returns counts of
   * thunks that completed (`drained`) and that exceeded the timeout
   * (`abandoned`). Errored thunks count as `drained` because the work
   * has resolved (the error has surfaced to onError).
   *
   * Used by the daemon's shutdown handler to give post-curate work a
   * bounded grace window before exit.
   */
  public async drain(timeoutMs: number): Promise<{abandoned: number; drained: number}> {
    const tails = [...this.tails.values()]
    if (tails.length === 0) {
      return {abandoned: 0, drained: 0}
    }

    let timeoutHandle: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs)
    })

    const results = await Promise.all(
      tails.map(async (tail) => {
        const outcome = await Promise.race([tail.then(() => 'done' as const), timeoutPromise])
        return outcome
      }),
    )

    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)

    const drained = results.filter((r) => r === 'done').length
    const abandoned = results.filter((r) => r === 'timeout').length
    return {abandoned, drained}
  }

  /**
   * Submit a thunk to run after any prior work for `projectPath` finishes.
   * Returns synchronously; the thunk runs on the microtask queue.
   */
  public submit(projectPath: string, thunk: PostWorkThunk): void {
    const previousTail = this.tails.get(projectPath) ?? Promise.resolve()
    const newTail = previousTail
      .then(thunk)
      .catch((error: unknown) => {
        this.onError?.(projectPath, error)
        // Swallow so subsequent submissions still run.
      })
      .finally(() => {
        // Clean up the map entry if our tail is the latest (no follow-up
        // submission appended). Keeps the registry from leaking entries.
        if (this.tails.get(projectPath) === newTail) {
          this.tails.delete(projectPath)
        }
      })
    this.tails.set(projectPath, newTail)
  }
}
