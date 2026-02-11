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
  success: boolean
}

export interface PushProgressEvent {
  message: string
  step: string
}
