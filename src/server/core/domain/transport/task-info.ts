import type {TaskErrorData, TaskListItemStatus, TaskType} from './schemas.js'

/**
 * Tracked task metadata used by TaskRouter for routing events
 * and by ConnectionCoordinator for agent disconnect cleanup.
 */
export type TaskInfo = {
  /** Client's working directory for file validation */
  clientCwd?: string
  clientId: string
  /** Set when task reaches a terminal state */
  completedAt?: number
  content: string
  createdAt: number
  /** Set when task ends in error */
  error?: TaskErrorData
  files?: string[]
  /** Folder path for curate-folder tasks */
  folderPath?: string
  /** Log entry ID set by lifecycle hook after onTaskCreate */
  logId?: string
  /** Project path this task belongs to (for multi-project routing) */
  projectPath?: string
  /** Set on successful completion */
  result?: string
  /** Set when agent picks up the task */
  startedAt?: number
  /** Lifecycle status — defaults to 'created' on construction */
  status?: TaskListItemStatus
  taskId: string
  type: TaskType
  /** Workspace root (linked subdir or projectRoot if unlinked) */
  worktreeRoot?: string
}
