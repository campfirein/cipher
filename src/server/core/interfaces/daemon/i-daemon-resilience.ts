/**
 * Daemon resilience management.
 * Installs process-level error and signal handlers that keep
 * the daemon alive through uncaught exceptions, unhandled rejections,
 * and sleep/wake cycles.
 */
export interface IDaemonResilience {
  /**
   * Installs all resilience handlers:
   * - uncaughtException (log + continue)
   * - unhandledRejection (log + continue)
   * - SIGHUP (no-op, survive terminal close)
   * - Sleep/wake detection timer
   *
   * Idempotent: calling when already installed is a no-op.
   */
  install(): void

  /**
   * Removes all resilience handlers and stops sleep/wake detection.
   *
   * Idempotent: calling when not installed is a no-op.
   */
  uninstall(): void
}
