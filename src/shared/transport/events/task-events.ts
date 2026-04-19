export const TaskEvents = {
  ACK: 'task:ack',
  CANCEL: 'task:cancel',
  CANCELLED: 'task:cancelled',
  COMPLETED: 'task:completed',
  CREATE: 'task:create',
  CREATED: 'task:created',
  ERROR: 'task:error',
  LIST: 'task:list',
  STARTED: 'task:started',
} as const

export interface TaskCreateRequest {
  clientCwd?: string
  content: string
  files?: string[]
  folderPath?: string
  projectPath?: string
  taskId: string
  type: 'curate' | 'curate-folder' | 'query' | 'search'
  worktreeRoot?: string
}

export interface TaskAckResponse {
  taskId: string
}

export interface TaskCancelRequest {
  taskId: string
}

export interface TaskCancelResponse {
  error?: string
  success: boolean
}

export type TaskListItemStatus = 'cancelled' | 'completed' | 'created' | 'error' | 'started'

export interface TaskListItem {
  completedAt?: number
  content: string
  createdAt: number
  error?: {
    code?: string
    message: string
    name?: string
  }
  /** Optional file paths from `curate --files` */
  files?: string[]
  /** Folder path for `curate-folder` tasks */
  folderPath?: string
  projectPath?: string
  result?: string
  startedAt?: number
  status: TaskListItemStatus
  taskId: string
  type: string
}

export interface TaskListRequest {
  projectPath?: string
}

export interface TaskListResponse {
  tasks: TaskListItem[]
}
