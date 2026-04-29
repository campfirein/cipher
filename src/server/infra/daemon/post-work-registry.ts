/**
 * Per-project serialized fire-and-forget queue with bounded shutdown drain.
 * Different projects run concurrently; same project runs serially so two
 * writers cannot race on `_index.md`. Thunk errors are swallowed (via
 * `onError`) so one bad thunk cannot block the chain.
 */

export type PostWorkThunk = () => Promise<void>

export type PostWorkRegistryOptions = {
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
   * Wait on the snapshot of tails captured at call time across all projects.
   * Submissions arriving during the await are not awaited.
   */
  public async awaitAll(): Promise<void> {
    const tails = [...this.tails.values()]
    if (tails.length === 0) return
    await Promise.all(tails)
  }

  /**
   * Wait on the project's tail captured at call time. Submissions arriving
   * during the await are not awaited — keeps `--wait-finalize` deterministic.
   */
  public async awaitProject(projectPath: string): Promise<void> {
    const tail = this.tails.get(projectPath)
    if (tail) {
      await tail
    }
  }

  /**
   * Wait up to `timeoutMs` for in-flight work across all projects.
   * Errored thunks count as `drained` (work resolved, surfaced to onError);
   * thunks still running at the deadline count as `abandoned`.
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
      })
      .finally(() => {
        // Drop the map entry only if no follow-up submission appended.
        if (this.tails.get(projectPath) === newTail) {
          this.tails.delete(projectPath)
        }
      })
    this.tails.set(projectPath, newTail)
  }
}
