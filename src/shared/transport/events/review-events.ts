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
  /** When provided, only operations targeting this context-tree-relative path are affected. */
  filePath?: string
  taskId: string
}

export interface ReviewDecideTaskResponse {
  files: Array<{path: string; reverted: boolean}>
  totalCount: number
}
