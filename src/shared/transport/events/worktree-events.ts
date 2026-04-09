export const WorktreeEvents = {
  ADD: 'worktree:add',
  LIST: 'worktree:list',
  REMOVE: 'worktree:remove',
} as const

export interface WorktreeAddRequest {
  force?: boolean
  worktreePath: string
}

export interface WorktreeAddResponse {
  backedUp?: boolean
  message: string
  success: boolean
}

export interface WorktreeRemoveRequest {
  worktreePath?: string
}

export interface WorktreeRemoveResponse {
  message: string
  success: boolean
}

export type WorktreeListRequest = void

export interface WorktreeListResponse {
  projectRoot: string
  source: 'direct' | 'flag' | 'linked'
  worktreeRoot: string
  worktrees: Array<{name: string; worktreePath: string}>
}
