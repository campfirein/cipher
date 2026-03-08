export const VcEvents = {
  INIT: 'vc:init',
  LOG: 'vc:log',
  STATUS: 'vc:status',
} as const

export interface IVcInitResponse {
  gitDir: string
  reinitialized: boolean
}

export interface IVcStatusResponse {
  branch?: string
  initialized: boolean
  staged: {added: string[]; deleted: string[]; modified: string[]}
  unstaged: {deleted: string[]; modified: string[]}
  untracked: string[]
}

export interface IVcLogRequest {
  all: boolean
  limit: number
  ref?: string
}

export interface IVcLogResponse {
  commits: Array<{
    author: {
      email: string
      name: string
    }
    message: string
    sha: string
    timestamp: string
  }>
  currentBranch?: string
}
