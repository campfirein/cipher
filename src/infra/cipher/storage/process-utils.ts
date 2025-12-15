/**
 * Process detection utilities for orphan cleanup
 *
 * Used by cleanupStaleConsumers() to detect dead query processes.
 * Provides cross-platform process existence checks.
 */

/**
 * Check if a process is still running
 *
 * Uses signal 0 to check process existence without actually sending a signal.
 * This is a POSIX standard way to check if a process exists.
 *
 * @param pid - Process ID to check
 * @returns true if running, false if dead, null if can't determine
 */
export function isProcessRunning(pid: number): boolean | null {
  // Guard against invalid PIDs
  // - Must be positive integer (PIDs are always > 0)
  // - Negative PIDs are dangerous: kill(-1, 0) signals ALL processes!
  // - PID 0 refers to current process group - not what we want
  if (!Number.isInteger(pid) || pid <= 0) {
    return null // Can't determine → fallback to activity check
  }

  try {
    // Signal 0 = check existence without killing
    // If process exists and we have permission, this succeeds silently
    process.kill(pid, 0)
    return true
  } catch (error) {
    const {code} = error as NodeJS.ErrnoException
    if (code === 'ESRCH') {
      // ESRCH = No such process - definitely dead
      return false
    }

    if (code === 'EPERM') {
      // EPERM = No permission to signal, but process exists
      return true
    }

    // Unknown error - can't determine (return null for fallback to activity check)
    return null
  }
}
