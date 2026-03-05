export const ReviewEvents = {
  NOTIFY: 'review:notify',
} as const

export interface ReviewNotifyEvent {
  pendingCount: number
  reviewUrl: string
  taskId: string
}
