/**
 * Ordered graceful shutdown handler for the daemon.
 */
export interface IShutdownHandler {
  /**
   * Performs ordered graceful shutdown.
   * Idempotent: second call is a no-op.
   *
   * Shutdown sequence (8 steps):
   * 1. Stop server idle timeout checks
   * 2. Stop agent idle timeout checks
   * 3. Uninstall resilience handlers
   * 4. Stop heartbeat writer
   * 5. Stop agent pool
   * 6. Stop transport server
   * 7. Release daemon.json
   * 8. Schedule force exit safety net
   */
  shutdown(): Promise<void>
}
