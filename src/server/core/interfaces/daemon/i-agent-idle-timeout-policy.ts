/**
 * Idle timeout policy for agent process cleanup.
 * Tracks agent activity to kill idle agents after a period of inactivity.
 */
export interface IAgentIdleTimeoutPolicy {
  /**
   * Returns idle status for all tracked agents.
   * Used by debug command to show countdown timers.
   *
   * @returns Array of idle status per agent (empty if no agents tracked)
   */
  getIdleStatus(): Array<{
    idleMs: number
    projectPath: string
    remainingMs: number
  }>

  /**
   * Notifies that an agent completed a task (was active).
   * Resets the idle timer for the given project.
   */
  onAgentActivity(projectPath: string): void

  /**
   * Removes an agent from tracking (e.g., when agent is manually killed).
   * Prevents firing onAgentIdle for removed agents.
   */
  removeAgent(projectPath: string): void

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
