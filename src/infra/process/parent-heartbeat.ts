/**
 * Parent Heartbeat Monitoring - Shared utility for worker processes.
 *
 * Why this is needed:
 * - When main process receives SIGKILL, it dies immediately
 * - SIGKILL cannot be caught, so no cleanup happens
 * - IPC 'disconnect' event may not fire
 * - Child processes become orphans (PPID = 1)
 *
 * This module provides a reusable heartbeat monitor that:
 * - Periodically checks if parent is still alive using signal 0
 * - Self-terminates the child process if parent dies
 * - Uses recursive setTimeout pattern (safer than setInterval)
 */

/** Parent heartbeat check interval in milliseconds */
const PARENT_HEARTBEAT_INTERVAL_MS = 2000

/**
 * Type guard for NodeJS.ErrnoException.
 * Used to safely access error.code without unsafe type assertions.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === 'object' && 'code' in error
}

/** State for the heartbeat monitor */
interface HeartbeatState {
  isRunning: boolean
  parentPid: number | undefined
}

/**
 * Configuration for the parent heartbeat monitor.
 */
export interface ParentHeartbeatConfig {
  /** Async cleanup function to call before exit */
  cleanup: () => Promise<void>
  /** Function to log messages */
  log: (message: string) => void
  /** Optional pre-cleanup function (e.g., stopInstancePolling) */
  preCleanup?: () => void
}

/**
 * Creates a parent heartbeat monitor.
 *
 * @param config - Configuration for the monitor
 * @returns Object with start() and stop() methods
 *
 * @example
 * ```typescript
 * const heartbeat = createParentHeartbeat({
 *   log: agentLog,
 *   cleanup: stopAgent,
 * })
 *
 * heartbeat.start()
 * // Later...
 * heartbeat.stop()
 * ```
 */
export function createParentHeartbeat(config: ParentHeartbeatConfig): {
  start: () => void
  stop: () => void
} {
  const state: HeartbeatState = {
    isRunning: false,
    parentPid: undefined,
  }

  const {cleanup, log, preCleanup} = config

  /**
   * Check if parent is alive and schedule next check.
   * Uses recursive setTimeout pattern:
   * - No callback overlap possible
   * - Clean cancellation (just set isRunning = false)
   * - No orphan timers
   */
  const checkParent = (): void => {
    // Stopped - don't schedule next check
    if (!state.isRunning || !state.parentPid) return

    // Check if parent is still alive using signal 0
    // Signal 0 doesn't send any signal, just checks if process exists
    try {
      process.kill(state.parentPid, 0)
    } catch (error: unknown) {
      // Only exit on ESRCH (No such process) - parent is genuinely dead
      // EPERM (Operation not permitted) means parent exists but different privileges
      const code = isNodeError(error) ? error.code : undefined
      if (code !== 'ESRCH') {
        log(`Parent check failed with ${code ?? 'unknown'} (not ESRCH) - continuing`)
        // Schedule next check (don't exit)
        if (state.isRunning) {
          setTimeout(checkParent, PARENT_HEARTBEAT_INTERVAL_MS)
        }

        return
      }

      // Parent is dead (ESRCH) - self-terminate
      log(`Parent process (${state.parentPid}) died - shutting down to prevent zombie`)
      state.isRunning = false

      // Run pre-cleanup if provided
      preCleanup?.()

      // Cleanup and exit
      cleanup()
        .catch(() => {})
        .finally(() => {
          // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
          process.exit(0)
        })
      return
    }

    // Schedule next check (only if still running)
    if (state.isRunning) {
      setTimeout(checkParent, PARENT_HEARTBEAT_INTERVAL_MS)
    }
  }

  return {
    /**
     * Start the parent heartbeat monitoring.
     * Safe to call multiple times - only starts once.
     */
    start(): void {
      // Already running - don't start another
      if (state.isRunning) return

      state.isRunning = true
      state.parentPid = process.ppid

      // Start first check after delay
      setTimeout(checkParent, PARENT_HEARTBEAT_INTERVAL_MS)
      log(`Parent heartbeat monitoring started (PPID: ${state.parentPid})`)
    },

    /**
     * Stop the parent heartbeat monitoring.
     * With recursive setTimeout, just set flag to false - next check won't schedule.
     */
    stop(): void {
      state.isRunning = false
    },
  }
}
