import type {InstanceInfo} from '../../domain/instance/types.js'

/**
 * Result of attempting to acquire an instance lock.
 */
export type AcquireResult =
  | {acquired: false; existingInstance: InstanceInfo; reason: 'already_running'}
  | {acquired: true; instance: InstanceInfo}

/**
 * Interface for managing instance lifecycle.
 *
 * Architecture notes (Section 6 - Instance Lock):
 * - 1 FOLDER = 1 TRANSPORT SERVER
 * - Handles acquire/release semantics for instance.json
 * - Verifies PID to detect crashed instances (no status field needed)
 */
export interface IInstanceManager {
  /**
   * Attempts to acquire an instance lock for the given project root.
   *
   * Flow:
   * 1. Check if instance.json exists
   * 2. If exists and pid alive → return already_running
   * 3. If exists but stale (pid dead) → overwrite
   * 4. Create new instance.json
   *
   * @param projectRoot - Root directory containing .brv/
   * @param port - Port the transport server will use
   * @returns AcquireResult indicating success or existing instance
   */
  acquire: (projectRoot: string, port: number) => Promise<AcquireResult>

  /**
   * Reads instance info from the project root.
   * Returns undefined if instance.json doesn't exist.
   *
   * @param projectRoot - Root directory containing .brv/
   */
  load: (projectRoot: string) => Promise<InstanceInfo | undefined>

  /**
   * Releases the instance lock by deleting instance.json.
   *
   * Called during graceful shutdown.
   *
   * @param projectRoot - Root directory containing .brv/
   */
  release: (projectRoot: string) => Promise<void>

  /**
   * Updates the current session ID in instance.json.
   *
   * @param projectRoot - Root directory containing .brv/
   * @param sessionId - New session ID to set
   */
  updateSessionId: (projectRoot: string, sessionId: string) => Promise<void>
}
