export const PullEvents = {
  EXECUTE: 'pull:execute',
  PREPARE: 'pull:prepare',
  PROGRESS: 'pull:progress',
} as const

export interface PullPrepareRequest {
  branch: string
}

export interface PullPrepareResponse {
  hasChanges: boolean
  summary: string
}

export interface PullExecuteRequest {
  branch: string
}

export interface PullExecuteResponse {
  success: boolean
}

export interface PullProgressEvent {
  message: string
  step: string
}
