import type {TaskType} from './schemas.js'

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
  /** Folder path for curate-folder tasks */
  folderPath?: string
  /** Log entry ID set by lifecycle hook after onTaskCreate */
  logId?: string
  /** Project path this task belongs to (for multi-project routing) */
  projectPath?: string
  taskId: string
  type: TaskType
  /** Workspace root (linked subdir or projectRoot if unlinked) */
  workspaceRoot?: string
}
