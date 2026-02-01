/**
 * Ordered graceful shutdown handler for the daemon.
 */
export interface IShutdownHandler {
  /**
   * Performs ordered graceful shutdown.
   * Idempotent: second call is a no-op.
   *
   * Shutdown sequence:
   * 1. Stop idle timeout checks
   * 2. Uninstall resilience handlers
   * 3. Stop heartbeat writer
   * 4. Stop transport server
   * 5. Release instance lock
   * 6. Schedule force exit safety net
   */
  shutdown(): Promise<void>
}
