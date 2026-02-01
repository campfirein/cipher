/**
 * Idle timeout policy for daemon auto-shutdown.
 * Tracks client connections to shut down the daemon
 * after a period of inactivity.
 */
export interface IIdleTimeoutPolicy {
  /** Notifies that a client has connected. Resets the idle timer. */
  onClientConnected(): void

  /** Notifies that a client has disconnected. Resets the idle timer. */
  onClientDisconnected(): void

  /**
   * Starts idle timeout checking.
   *
   * Idempotent: calling when already running is a no-op.
   */
  start(): void

  /**
   * Stops idle timeout checking.
   *
   * Idempotent: calling when not running is a no-op.
   */
  stop(): void
}
