import type {TaskExecute} from '../../domain/transport/schemas.js'

/**
 * Result of submitting a task to the pool.
 * Uses discriminated union (success field) instead of thrown errors.
 */
export type SubmitTaskResult =
  | {message: string; reason: 'create_failed' | 'invalid_task'; success: false}
  | {success: true}

/**
 * Read-only snapshot of a managed agent entry for monitoring.
 */
export type AgentEntryInfo = {
  readonly childPid: number | undefined
  readonly createdAt: number
  readonly hasActiveTask: boolean
  readonly isIdle: boolean
  readonly lastUsedAt: number
  readonly projectPath: string
}

/**
 * Manages up to N forked child process agents, one per active project.
 *
 * Each agent is a separate Node.js process (child_process.fork())
 * associated with a projectPath. When the pool is full, the LRU idle
 * agent is evicted. If all agents are busy and a new project needs one,
 * the task is queued with a timeout before force-evicting the LRU busy agent.
 *
 * Pool is pure lifecycle management — zero knowledge of auth, project config,
 * or agent internals. Each child process handles all agent setup independently.
 *
 * Consumed by:
 * - server-main.ts: instantiation and wiring
 * - TransportHandlers: delegates task submission via submitTask()
 * - ClientManager.onProjectEmpty → markIdle() for LRU eviction
 */
export interface IAgentPool {
  /**
   * Get pool entries for monitoring/debugging.
   */
  getEntries(): readonly AgentEntryInfo[]

  /**
   * Get current pool size (number of managed agents).
   */
  getSize(): number

  /**
   * Check if the pool has an agent for a given project.
   */
  hasAgent(projectPath: string): boolean

  /**
   * Mark a project's agent as idle (no external clients).
   * Called by wiring code in response to ClientManager.onProjectEmpty.
   * Idle agents are candidates for LRU eviction when pool is full.
   */
  markIdle(projectPath: string): void

  /**
   * Notify pool that a task has completed (or errored) for a project.
   * Clears busy flag and drains queued tasks for the project.
   * Called by TransportHandlers on task:completed / task:error events.
   */
  notifyTaskCompleted(projectPath: string): void

  /**
   * Graceful shutdown: stop all agent processes and clear the pool.
   * Called during daemon shutdown sequence.
   */
  shutdown(): Promise<void>

  /**
   * Submit a task for execution.
   *
   * The pool acquires or forks an agent process for the task's project,
   * then sends the task via the transport server. If the agent is busy,
   * the task is queued in a per-project FIFO queue.
   */
  submitTask(task: TaskExecute): Promise<SubmitTaskResult>
}
