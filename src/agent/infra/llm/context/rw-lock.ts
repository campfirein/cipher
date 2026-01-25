/**
 * Reader-Writer Lock with Disposable pattern support.
 *
 * Provides concurrent read access while ensuring exclusive write access.
 * Multiple readers can hold the lock simultaneously, but writers get
 * exclusive access (no readers or other writers).
 *
 * Follows OpenCode's lock pattern with ES2022 'using' keyword support
 * for automatic release.
 *
 * Usage:
 * ```typescript
 * // Read lock (allows concurrent reads)
 * using _readLock = await RWLock.read('session:123')
 * const data = await storage.get(key)
 *
 * // Write lock (exclusive access)
 * using _writeLock = await RWLock.write('session:123')
 * await storage.set(key, value)
 * ```
 */

interface LockState {
  readers: number
  waitingReaders: Array<() => void>
  waitingWriters: Array<() => void>
  writer: boolean
}

/**
 * Global lock manager for coordinating concurrent access.
 * Uses per-target locks to allow independent locking of different resources.
 */
class RWLockManager {
  private readonly locks = new Map<string, LockState>()

  /**
   * Get current lock statistics for debugging.
   */
  getStats(): {activeLocks: number; targets: string[]} {
    return {
      activeLocks: this.locks.size,
      targets: [...this.locks.keys()],
    }
  }

  /**
   * Acquire a read lock.
   * Multiple readers can hold the lock simultaneously.
   * Will wait if a writer holds the lock or is waiting.
   *
   * @param target - Resource identifier to lock
   * @returns Disposable that releases the lock when disposed
   */
  async read(target: string): Promise<Disposable> {
    const state = this.getLockState(target)

    // Wait for any pending/active writer (writers have priority to prevent starvation)
    while (state.writer || state.waitingWriters.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        state.waitingReaders.push(resolve)
      })
    }

    state.readers++

    return {
      [Symbol.dispose]: () => {
        state.readers--

        // If no more readers and writers are waiting, wake a writer
        if (state.readers === 0 && state.waitingWriters.length > 0) {
          const next = state.waitingWriters.shift()
          next?.()
        }

        this.cleanupIfEmpty(target)
      },
    }
  }

  /**
   * Acquire a write lock.
   * Writers get exclusive access - no readers or other writers.
   * Writers have priority over readers to prevent writer starvation.
   *
   * @param target - Resource identifier to lock
   * @returns Disposable that releases the lock when disposed
   */
  async write(target: string): Promise<Disposable> {
    const state = this.getLockState(target)

    // Wait for all readers and any active writer
    while (state.writer || state.readers > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        state.waitingWriters.push(resolve)
      })
    }

    state.writer = true

    return {
      [Symbol.dispose]: () => {
        state.writer = false

        // Prefer writers over readers to prevent writer starvation
        if (state.waitingWriters.length > 0) {
          const next = state.waitingWriters.shift()
          next?.()
        } else {
          // Wake all pending readers at once
          while (state.waitingReaders.length > 0) {
            const next = state.waitingReaders.shift()
            next?.()
          }
        }

        this.cleanupIfEmpty(target)
      },
    }
  }

  /**
   * Clean up lock state if no longer needed.
   */
  private cleanupIfEmpty(target: string): void {
    const state = this.locks.get(target)
    if (
      state &&
      state.readers === 0 &&
      !state.writer &&
      state.waitingReaders.length === 0 &&
      state.waitingWriters.length === 0
    ) {
      this.locks.delete(target)
    }
  }

  /**
   * Get or create lock state for a target.
   */
  private getLockState(target: string): LockState {
    let state = this.locks.get(target)

    if (!state) {
      state = {
        readers: 0,
        waitingReaders: [],
        waitingWriters: [],
        writer: false,
      }
      this.locks.set(target, state)
    }

    return state
  }
}

/**
 * Global RWLock instance for coordinating storage access.
 * Use this for all storage operations to prevent race conditions.
 */
export const RWLock = new RWLockManager()

/**
 * Helper function to create a lock key from a storage key.
 * Converts ["message", "session123", "msg456"] to "message:session123:msg456"
 */
export function lockKeyFromStorageKey(storageKey: readonly string[]): string {
  return storageKey.join(':')
}
