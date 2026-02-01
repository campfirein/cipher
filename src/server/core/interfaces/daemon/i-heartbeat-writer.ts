/**
 * File-based heartbeat writer.
 * Writes the current epoch timestamp to a file at regular intervals,
 * allowing external processes to detect if the daemon is alive.
 */
export interface IHeartbeatWriter {
  /**
   * Writes the heartbeat immediately without starting the periodic timer.
   * Useful for refreshing after sleep/wake detection.
   */
  refresh(): void

  /**
   * Starts periodic heartbeat writes.
   * Writes immediately on start, then schedules recursive timeouts.
   *
   * Idempotent: calling when already running is a no-op.
   */
  start(): void

  /**
   * Stops periodic heartbeat writes and deletes the heartbeat file.
   *
   * Idempotent: calling when not running is a no-op.
   */
  stop(): void
}
