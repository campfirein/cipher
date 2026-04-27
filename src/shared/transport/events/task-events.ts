import type {TaskHistoryEntry} from '../../../server/core/domain/entities/task-history-entry.js'

export type {TaskHistoryEntry} from '../../../server/core/domain/entities/task-history-entry.js'

export const TaskEvents = {
  ACK: 'task:ack',
  CANCEL: 'task:cancel',
  CANCELLED: 'task:cancelled',
  CLEAR_COMPLETED: 'task:clearCompleted',
  COMPLETED: 'task:completed',
  CREATE: 'task:create',
  CREATED: 'task:created',
  DELETE: 'task:delete',
  DELETE_BULK: 'task:deleteBulk',
  DELETED: 'task:deleted',
  ERROR: 'task:error',
  GET: 'task:get',
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

/**
 * Reasoning/thinking content item with timestamp for ordering.
 * Shared between webui, tui, and the server-side TaskHistoryEntry.
 */
export interface ReasoningContentItem {
  content: string
  /** Whether this reasoning item is still being streamed */
  isThinking?: boolean
  timestamp: number
}

/**
 * Persisted tool-call lifecycle entry — distinct from the wire-payload
 * `LlmToolCallEventSchema` in `core/domain/transport/schemas.ts`. This shape
 * carries the `running | completed | error` state machine and is the form
 * stored in `TaskHistoryEntry.toolCalls`.
 */
export interface ToolCallEvent {
  args: Record<string, unknown>
  callId?: string
  error?: string
  errorType?: string
  result?: unknown
  sessionId: string
  status: 'completed' | 'error' | 'running'
  timestamp: number
  toolName: string
}

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
  /** Active model id at task creation time */
  model?: string
  projectPath?: string
  /** Active provider id at task creation time */
  provider?: string
  result?: string
  startedAt?: number
  status: TaskListItemStatus
  taskId: string
  type: string
}

export interface TaskListRequest {
  before?: number
  limit?: number
  projectPath?: string
}

export interface TaskListResponse {
  nextCursor?: number
  tasks: TaskListItem[]
}

export interface TaskClearCompletedRequest {
  projectPath?: string
}

export interface TaskClearCompletedResponse {
  deletedCount: number
  error?: string
}

export interface TaskDeleteBulkRequest {
  taskIds: string[]
}

export interface TaskDeleteBulkResponse {
  deletedCount: number
  error?: string
}

export interface TaskDeleteRequest {
  taskId: string
}

export interface TaskDeleteResponse {
  error?: string
  success: boolean
}

export interface TaskDeletedEvent {
  taskId: string
}

export interface TaskGetRequest {
  taskId: string
}

export interface TaskGetResponse {
  task: null | TaskHistoryEntry
}
