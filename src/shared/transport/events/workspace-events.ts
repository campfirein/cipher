export const WorkspaceEvents = {
  ADD: 'workspace:add',
  REMOVE: 'workspace:remove',
} as const

export interface WorkspaceAddRequest {
  targetPath: string
}

export interface WorkspaceRemoveRequest {
  path: string
}

export interface WorkspaceOperationResponse {
  message: string
  success: boolean
}
