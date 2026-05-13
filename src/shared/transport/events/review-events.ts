 
import type {CliMetadata} from '../../analytics/cli-metadata-schema.js'

export const ReviewEvents = {
  DECIDE_TASK: 'review:decideTask',
  GET_DISABLED: 'review:getDisabled',
  NOTIFY: 'review:notify',
  PENDING: 'review:pending',
  SET_DISABLED: 'review:setDisabled',
} as const

export interface ReviewGetDisabledResponse {
  reviewDisabled: boolean
}

export interface ReviewSetDisabledRequest {
  cli_metadata?: CliMetadata
  reviewDisabled: boolean
}

export interface ReviewSetDisabledResponse {
  reviewDisabled: boolean
}

export interface ReviewNotifyEvent {
  pendingCount: number
  reviewUrl: string
  taskId: string
}

export interface ReviewDecideTaskRequest {
  cli_metadata?: CliMetadata
  decision: 'approved' | 'rejected'
  /** When provided, only operations targeting these context-tree-relative paths are affected. */
  filePaths?: string[]
  taskId: string
}

export interface ReviewDecideTaskResponse {
  files: Array<{path: string; reverted: boolean}>
  totalCount: number
}

export interface ReviewPendingOperation {
  /** Context-tree-relative file path (e.g. architecture/daemon/lifecycle.md). Used with --file flag. */
  filePath?: string
  impact?: 'high' | 'low'
  path: string
  previousSummary?: string
  reason?: string
  summary?: string
  type: 'ADD' | 'DELETE' | 'MERGE' | 'UPDATE' | 'UPSERT'
}

export interface ReviewPendingTask {
  operations: ReviewPendingOperation[]
  taskId: string
}

export interface ReviewPendingResponse {
  pendingCount: number
  tasks: ReviewPendingTask[]
}
