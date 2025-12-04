/**
 * AsyncMutex - Simple asynchronous mutex for thread safety in parallel execution.
 *
 * Provides mutual exclusion for async operations, ensuring that only one
 * operation can execute the critical section at a time. Uses a FIFO queue
 * to ensure fairness among waiting operations.
 *
 * @example
 * ```typescript
 * const mutex = new AsyncMutex()
 *
 * // Option 1: Manual acquire/release
 * await mutex.acquire()
 * try {
 *   // Critical section
 * } finally {
 *   mutex.release()
 * }
 *
 * // Option 2: Using withLock (recommended)
 * await mutex.withLock(async () => {
 *   // Critical section - automatically released
 * })
 * ```
 */
export class AsyncMutex {
  private locked = false
  private readonly queue: Array<() => void> = []

  /**
   * Acquire the mutex lock.
   * If the mutex is already locked, the caller will wait in a FIFO queue.
   *
   * @returns Promise that resolves when the lock is acquired
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  /**
   * Get the number of operations waiting for the lock.
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * Check if the mutex is currently locked.
   */
  isLocked(): boolean {
    return this.locked
  }

  /**
   * Release the mutex lock.
   * If there are waiting operations, the next one in the queue will be granted the lock.
   *
   * @throws Error if the mutex is not currently locked
   */
  release(): void {
    if (!this.locked) {
      throw new Error('AsyncMutex: Cannot release a mutex that is not locked')
    }

    const next = this.queue.shift()
    if (next) {
      // Pass lock to next waiter (mutex stays locked)
      next()
    } else {
      // No waiters, unlock
      this.locked = false
    }
  }

  /**
   * Execute a function with the mutex lock held.
   * The lock is automatically released when the function completes or throws.
   *
   * @param fn - Async function to execute with the lock held
   * @returns The result of the function
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
