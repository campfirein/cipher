/**
 * Daemon instance info stored globally.
 */
export interface DaemonInstanceInfo {
  readonly pid: number
  readonly port: number
  readonly startedAt: number
  readonly version: string
}

/**
 * Result of attempting to acquire the global daemon instance lock.
 */
export type DaemonAcquireResult =
  | {acquired: false; existingInstance: DaemonInstanceInfo; reason: 'already_running'}
  | {acquired: false; reason: 'write_failed'}
  | {acquired: true; instance: DaemonInstanceInfo}

/**
 * Manages the global daemon instance lock.
 * Ensures only one daemon runs at a time via atomic file operations.
 */
export interface IGlobalInstanceManager {
  /**
   * Attempts to acquire the daemon instance lock.
   * If a live instance exists (PID alive), returns acquired: false.
   * If stale or none, writes atomically and returns acquired: true.
   */
  acquire(port: number, version: string): DaemonAcquireResult

  /**
   * Loads daemon instance info from disk.
   * Returns undefined if missing, corrupted, or invalid schema.
   */
  load(): DaemonInstanceInfo | undefined

  /**
   * Releases the daemon instance lock by deleting the instance file.
   * Best-effort: does not throw if file is already missing.
   */
  release(): void
}
