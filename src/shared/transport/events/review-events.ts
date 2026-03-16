export const ReviewEvents = {
  DECIDE_TASK: 'review:decideTask',
  NOTIFY: 'review:notify',
} as const

export interface ReviewNotifyEvent {
  pendingCount: number
  reviewUrl: string
  taskId: string
}

export interface ReviewDecideTaskRequest {
  decision: 'approved' | 'rejected'
  /** When provided, only operations targeting these context-tree-relative paths are affected. */
  filePaths?: string[]
  taskId: string
}

export interface ReviewDecideTaskResponse {
  files: Array<{path: string; reverted: boolean}>
  totalCount: number
}
