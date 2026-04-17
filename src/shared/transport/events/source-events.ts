export const SourceEvents = {
  ADD: 'source:add',
  LIST: 'source:list',
  REMOVE: 'source:remove',
} as const

export interface SourceAddRequest {
  alias?: string
  targetPath: string
}

export interface SourceAddResponse {
  message: string
  success: boolean
}

export interface SourceRemoveRequest {
  aliasOrPath: string
}

export interface SourceRemoveResponse {
  message: string
  success: boolean
}

export type SourceListRequest = void

export interface SourceListResponse {
  error?: string
  statuses: Array<{alias: string; contextTreeSize?: number; projectRoot: string; valid: boolean}>
}
