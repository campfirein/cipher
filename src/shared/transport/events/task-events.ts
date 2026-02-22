export const TaskEvents = {
  ACK: 'task:ack',
  CANCELLED: 'task:cancelled',
  COMPLETED: 'task:completed',
  CREATE: 'task:create',
  CREATED: 'task:created',
  ERROR: 'task:error',
  STARTED: 'task:started',
} as const

export interface TaskCreateRequest {
  clientCwd?: string
  content: string
  files?: string[]
  taskId: string
  type: 'curate' | 'query'
}

export interface TaskAckResponse {
  taskId: string
}
