export const PushEvents = {
  EXECUTE: 'push:execute',
  PREPARE: 'push:prepare',
  PROGRESS: 'push:progress',
} as const

export interface PushPrepareRequest {
  branch: string
}

export interface PushPrepareResponse {
  fileCount: number
  hasChanges: boolean
  summary: string
}

export interface PushExecuteRequest {
  branch: string
}

export interface PushExecuteResponse {
  added: number
  deleted: number
  edited: number
  success: boolean
  url: string
}

export interface PushProgressEvent {
  message: string
  step: string
}
