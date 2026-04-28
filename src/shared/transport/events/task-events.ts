/**
 * Persisted-entry schema version. Bumped only on shape-breaking changes to
 * `TaskHistoryEntry`. The Zod schema in `server/core/domain/entities/` uses
 * `z.literal(TASK_HISTORY_SCHEMA_VERSION)` to refuse mismatched on-disk lines.
 */
export const TASK_HISTORY_SCHEMA_VERSION = 1

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
export type ReasoningContentItem = {
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
export type ToolCallEvent = {
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
    name: string
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
  /**
   * Tiebreaker for `before` when multiple tasks share the same `createdAt`
   * (same-millisecond bursts). Pass back the `nextCursorTaskId` from the
   * previous response together with `before = nextCursor`.
   */
  beforeTaskId?: string
  limit?: number
  projectPath?: string
  status?: TaskListItemStatus[]
  type?: string[]
}

export interface TaskListResponse {
  nextCursor?: number
  /** Companion tiebreaker for `nextCursor` — see `TaskListRequest.beforeTaskId`. */
  nextCursorTaskId?: string
  tasks: TaskListItem[]
}

export type TaskClearCompletedRequest = {
  projectPath?: string
}

export type TaskClearCompletedResponse = {
  deletedCount: number
  error?: string
}

export type TaskDeleteBulkRequest = {
  taskIds: string[]
}

export type TaskDeleteBulkResponse = {
  deletedCount: number
  error?: string
}

export type TaskDeleteRequest = {
  taskId: string
}

export type TaskDeleteResponse = {
  error?: string
  /**
   * `true` when the task was actually removed (was live or persisted),
   * `false` when the call was a no-op (taskId unknown or already tombstoned).
   * `task:deleteBulk` uses this to compute an accurate `deletedCount`.
   */
  removed?: boolean
  success: boolean
}

export type TaskDeletedEvent = {
  taskId: string
}

export type TaskGetRequest = {
  taskId: string
}

export type TaskGetResponse = {
  task: null | TaskHistoryEntry
}

/**
 * Full per-task error payload — superset of `TaskListItem.error`, adds the
 * optional `details` bag. Mirrors `TaskErrorDataSchema` in
 * `src/server/core/domain/entities/task-history-entry.ts`; the server schema
 * carries `satisfies z.ZodType<TaskErrorData>` to keep them aligned.
 */
export type TaskErrorData = {
  code?: string
  details?: Record<string, unknown>
  message: string
  name: string
}

/**
 * Discriminated-union shape for a persisted task. The server-side Zod schema
 * (`TaskHistoryEntrySchema`) is the runtime source of truth and carries
 * `satisfies z.ZodType<TaskHistoryEntry>` so any drift between the two
 * representations is a typecheck error.
 *
 * Lives in `shared/` so webui + tui can consume it without inverting the
 * dependency direction onto `server/`.
 */
type TaskHistoryEntryBase = {
  clientCwd?: string
  content: string
  createdAt: number
  files?: string[]
  folderPath?: string
  id: string
  logId?: string
  model?: string
  projectPath: string
  provider?: string
  reasoningContents?: ReasoningContentItem[]
  responseContent?: string
  schemaVersion: typeof TASK_HISTORY_SCHEMA_VERSION
  sessionId?: string
  taskId: string
  toolCalls?: ToolCallEvent[]
  type: string
  worktreeRoot?: string
}

export type TaskHistoryEntry =
  | (TaskHistoryEntryBase & {
      completedAt: number
      error: TaskErrorData
      startedAt?: number
      status: 'error'
    })
  | (TaskHistoryEntryBase & {
      completedAt: number
      result?: string
      startedAt?: number
      status: 'completed'
    })
  | (TaskHistoryEntryBase & {
      completedAt: number
      startedAt?: number
      status: 'cancelled'
    })
  | (TaskHistoryEntryBase & {startedAt: number; status: 'started'})
  | (TaskHistoryEntryBase & {status: 'created'})

export type TaskHistoryStatus = TaskHistoryEntry['status']
