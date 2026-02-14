/**
 * Deferred effects pattern for ensuring side-effects (like event emissions)
 * only execute after database operations succeed.
 *
 * Usage:
 *   const effects = new DeferredEffects()
 *   effects.defer(() => bus.emit('event', data))
 *   await databaseOperation()
 *   effects.flush()  // Only fires events after DB success
 *
 * On error:
 *   effects.discard()  // Silently drops queued effects
 */
export class DeferredEffects {
  private queue: Array<() => void> = []

  /**
   * Queue a callback to execute later.
   *
   * @param fn - Side-effect callback to defer
   */
  defer(fn: () => void): void {
    this.queue.push(fn)
  }

  /**
   * Discard all queued effects without executing them.
   */
  discard(): void {
    this.queue = []
  }

  /**
   * Execute all queued effects and clear the queue.
   */
  flush(): void {
    const effects = this.queue
    this.queue = []
    for (const fn of effects) {
      fn()
    }
  }
}
