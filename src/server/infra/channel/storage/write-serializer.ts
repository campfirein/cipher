/**
 * Per-key write serializer (BRV-204).
 *
 * Concurrent `run(key, fn)` calls with the *same* key chain — the second
 * waits for the first to settle before its `fn` runs. Calls with *different*
 * keys are independent.
 *
 * Failure isolation: if a writer throws, the next writer queued behind it
 * still runs. Each caller's error surfaces only to that caller.
 *
 * Use cases in v1:
 *  - Per-artifact-path serialisation when two agents write to the same
 *    artifact (`channel/<id>/artifacts/plan.md`).
 *  - Per-(channel, turn) event-jsonl appends when the orchestrator stages
 *    multiple events in flight.
 */
export class WriteSerializer {
  private readonly tails = new Map<string, Promise<void>>()

  public async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()

    let resolveTail!: () => void
    const ourTail = new Promise<void>((resolve) => {
      resolveTail = resolve
    })
    this.tails.set(key, ourTail)

    // Wait for the previous tail to settle. We swallow its rejection so the
    // chain isn't broken by an upstream caller's failure — the upstream
    // caller owns its own error handling.
    try {
      await previous
    } catch {
      /* upstream failure is upstream's problem */
    }

    try {
      return await fn()
    } finally {
      resolveTail()
      // Best-effort cleanup: if no one queued behind us, drop our entry so
      // the map doesn't grow unbounded.
      if (this.tails.get(key) === ourTail) {
        this.tails.delete(key)
      }
    }
  }
}
