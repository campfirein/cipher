export const VcEvents = {
  INIT: 'vc:init',
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
