export const VcErrorCode = {
  ALREADY_INITIALIZED: 'ERR_VC_ALREADY_INITIALIZED',
  AUTH_FAILED: 'ERR_VC_AUTH_FAILED',
  BRANCH_NOT_FOUND: 'ERR_VC_BRANCH_NOT_FOUND',
  CLONE_FAILED: 'ERR_VC_CLONE_FAILED',
  CONFIG_KEY_NOT_SET: 'ERR_VC_CONFIG_KEY_NOT_SET',
  GIT_NOT_INITIALIZED: 'ERR_VC_GIT_NOT_INITIALIZED',
  INVALID_BRANCH_NAME: 'ERR_VC_INVALID_BRANCH_NAME',
  INVALID_CONFIG_KEY: 'ERR_VC_INVALID_CONFIG_KEY',
  INVALID_REMOTE_URL: 'ERR_VC_INVALID_REMOTE_URL',
  NO_REMOTE: 'ERR_VC_NO_REMOTE',
  NON_FAST_FORWARD: 'ERR_VC_NON_FAST_FORWARD',
  NOTHING_STAGED: 'ERR_VC_NOTHING_STAGED',
  NOTHING_TO_PUSH: 'ERR_VC_NOTHING_TO_PUSH',
  PUSH_FAILED: 'ERR_VC_PUSH_FAILED',
  REMOTE_ALREADY_EXISTS: 'ERR_VC_REMOTE_ALREADY_EXISTS',
  USER_NOT_CONFIGURED: 'ERR_VC_USER_NOT_CONFIGURED',
} as const

export type VcErrorCodeType = (typeof VcErrorCode)[keyof typeof VcErrorCode]

export const VcEvents = {
  ADD: 'vc:add',
  CLONE: 'vc:clone',
  CLONE_PROGRESS: 'vc:clone:progress',
  COMMIT: 'vc:commit',
  CONFIG: 'vc:config',
  INIT: 'vc:init',
  LOG: 'vc:log',
  PUSH: 'vc:push',
  REMOTE: 'vc:remote',
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

export interface IVcAddRequest {
  filePaths?: string[]
}

export interface IVcAddResponse {
  count: number
}

export interface IVcCommitRequest {
  message: string
}

export interface IVcCommitResponse {
  message: string
  sha: string
}

export type VcConfigKey = 'user.email' | 'user.name'

export const VC_CONFIG_KEYS: readonly string[] = ['user.name', 'user.email'] satisfies readonly VcConfigKey[]

export function isVcConfigKey(key: string): key is VcConfigKey {
  return VC_CONFIG_KEYS.includes(key)
}

export interface IVcConfigRequest {
  key: VcConfigKey
  value?: string
}

export interface IVcConfigResponse {
  key: string
  value: string
}

export interface IVcPushRequest {
  branch?: string
}

export interface IVcPushResponse {
  branch: string
}

export interface IVcLogRequest {
  all?: boolean
  limit?: number
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

export type VcRemoteSubcommand = 'add' | 'set-url' | 'show'

export const VC_REMOTE_SUBCOMMANDS: readonly string[] = [
  'add',
  'set-url',
  'show',
] satisfies readonly VcRemoteSubcommand[]

export function isVcRemoteSubcommand(value: string): value is VcRemoteSubcommand {
  return VC_REMOTE_SUBCOMMANDS.includes(value)
}

export interface IVcRemoteRequest {
  subcommand: VcRemoteSubcommand
  url?: string
}

export interface IVcRemoteResponse {
  action: VcRemoteSubcommand
  url?: string
}

export interface IVcCloneRequest {
  spaceId: string
  spaceName: string
  teamId: string
  teamName: string
}

export interface IVcCloneResponse {
  gitDir: string
  spaceName: string
  teamName: string
}

export interface IVcCloneProgressEvent {
  message: string
  step: 'cloning' | 'saving'
}
