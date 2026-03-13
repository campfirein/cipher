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
  taskId: string
}

export interface ReviewDecideTaskResponse {
  files: Array<{path: string; reverted: boolean}>
  totalCount: number
}
