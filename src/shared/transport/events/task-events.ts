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
  folderPath?: string
  projectPath?: string
  taskId: string
  type: 'curate' | 'curate-folder' | 'query'
  workspaceRoot?: string
}

export interface TaskAckResponse {
  taskId: string
}
