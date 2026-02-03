function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Checks if a process with the given PID is alive.
 *
 * Uses process.kill(pid, 0) which doesn't actually send a signal,
 * but throws an error if the process doesn't exist.
 *
 * @param pid - Process ID to check
 * @returns true if process exists, false otherwise
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH means "No such process"
    // EPERM means "Permission denied" (process exists but we can't signal it)
    if (isNodeError(error)) {
      if (error.code === 'ESRCH') {
        return false
      }

      if (error.code === 'EPERM') {
        // Process exists but we don't have permission to signal it
        // This shouldn't happen for our own child processes, but handle it
        return true
      }
    }

    // Unknown error, assume process doesn't exist
    return false
  }
}
