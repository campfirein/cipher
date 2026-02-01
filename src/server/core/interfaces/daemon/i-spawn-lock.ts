/**
 * Result of attempting to acquire the spawn lock.
 */
export type SpawnLockAcquireResult =
  | {acquired: false; reason: 'held_by_another_process' | 'write_failed'}
  | {acquired: true}

/**
 * File-based spawn lock to prevent multiple clients from
 * spawning multiple daemon processes simultaneously.
 */
export interface ISpawnLock {
  /**
   * Attempts to acquire the spawn lock atomically.
   * Returns acquired: false if the lock is held by another live process.
   */
  acquire(): SpawnLockAcquireResult

  /**
   * Releases the spawn lock.
   * Best-effort: does not throw if lock file is already missing.
   * No-op if lock was not acquired by this instance.
   */
  release(): void
}
