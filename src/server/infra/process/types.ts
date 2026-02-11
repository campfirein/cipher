/**
 * Shared types for the process module (TransportHandlers, TaskRouter, ConnectionCoordinator).
 */

/**
 * Tracked task metadata used by TaskRouter for routing events
 * and by ConnectionCoordinator for agent disconnect cleanup.
 */
export type TaskInfo = {
  /** Client's working directory for file validation */
  clientCwd?: string
  clientId: string
  content: string
  createdAt: number
  files?: string[]
  /** Project path this task belongs to (for multi-project routing) */
  projectPath?: string
  taskId: string
  type: string
}
