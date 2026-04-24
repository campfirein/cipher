export const VcErrorCode = {
  ALREADY_INITIALIZED: 'ERR_VC_ALREADY_INITIALIZED',
  AUTH_FAILED: 'ERR_VC_AUTH_FAILED',
  BRANCH_ALREADY_EXISTS: 'ERR_VC_BRANCH_ALREADY_EXISTS',
  BRANCH_NOT_FOUND: 'ERR_VC_BRANCH_NOT_FOUND',
  BRANCH_NOT_MERGED: 'ERR_VC_BRANCH_NOT_MERGED',
  CANNOT_DELETE_CURRENT_BRANCH: 'ERR_VC_CANNOT_DELETE_CURRENT_BRANCH',
  CLONE_FAILED: 'ERR_VC_CLONE_FAILED',
  CONFIG_KEY_NOT_SET: 'ERR_VC_CONFIG_KEY_NOT_SET',
  CONFLICT_MARKERS_PRESENT: 'ERR_VC_CONFLICT_MARKERS_PRESENT',
  FETCH_FAILED: 'ERR_VC_FETCH_FAILED',
  FILE_NOT_FOUND: 'ERR_VC_FILE_NOT_FOUND',
  GIT_NOT_INITIALIZED: 'ERR_VC_GIT_NOT_INITIALIZED',
  INVALID_ACTION: 'ERR_VC_INVALID_ACTION',
  INVALID_BRANCH_NAME: 'ERR_VC_INVALID_BRANCH_NAME',
  INVALID_CONFIG_KEY: 'ERR_VC_INVALID_CONFIG_KEY',
  INVALID_REF: 'ERR_VC_INVALID_REF',
  INVALID_REMOTE_URL: 'ERR_VC_INVALID_REMOTE_URL',
  MERGE_CONFLICT: 'ERR_VC_MERGE_CONFLICT',
  MERGE_IN_PROGRESS: 'ERR_VC_MERGE_IN_PROGRESS',
  NETWORK_ERROR: 'ERR_VC_NETWORK_ERROR',
  NO_BRANCH_RESOLVED: 'ERR_VC_NO_BRANCH_RESOLVED',
  NO_COMMITS: 'ERR_VC_NO_COMMITS',
  NO_MERGE_IN_PROGRESS: 'ERR_VC_NO_MERGE_IN_PROGRESS',
  NO_REMOTE: 'ERR_VC_NO_REMOTE',
  NO_UPSTREAM: 'ERR_VC_NO_UPSTREAM',
  NON_FAST_FORWARD: 'ERR_VC_NON_FAST_FORWARD',
  NOTHING_STAGED: 'ERR_VC_NOTHING_STAGED',
  NOTHING_TO_PUSH: 'ERR_VC_NOTHING_TO_PUSH',
  NOTHING_TO_RESET: 'ERR_VC_NOTHING_TO_RESET',
  PULL_FAILED: 'ERR_VC_PULL_FAILED',
  PUSH_FAILED: 'ERR_VC_PUSH_FAILED',
  REMOTE_ALREADY_EXISTS: 'ERR_VC_REMOTE_ALREADY_EXISTS',
  UNCOMMITTED_CHANGES: 'ERR_VC_UNCOMMITTED_CHANGES',
  UNRELATED_HISTORIES: 'ERR_VC_UNRELATED_HISTORIES',
  USER_NOT_CONFIGURED: 'ERR_VC_USER_NOT_CONFIGURED',
} as const

export type VcErrorCodeType = (typeof VcErrorCode)[keyof typeof VcErrorCode]

export const VcEvents = {
  ADD: 'vc:add',
  BRANCH: 'vc:branch',
  CHECKOUT: 'vc:checkout',
  CLONE: 'vc:clone',
  CLONE_PROGRESS: 'vc:clone:progress',
  COMMIT: 'vc:commit',
  CONFIG: 'vc:config',
  DIFF: 'vc:diff',
  DIFFS: 'vc:diffs',
  DISCARD: 'vc:discard',
  FETCH: 'vc:fetch',
  INIT: 'vc:init',
  LOG: 'vc:log',
  MERGE: 'vc:merge',
  PULL: 'vc:pull',
  PUSH: 'vc:push',
  REMOTE: 'vc:remote',
  RESET: 'vc:reset',
  STATUS: 'vc:status',
} as const

export interface IVcInitResponse {
  gitDir: string
  reinitialized: boolean
}

export interface IVcStatusResponse {
  ahead?: number
  behind?: number
  branch?: string
  conflictMarkerFiles?: string[]
  hasCommits?: boolean
  initialized: boolean
  mergeInProgress?: boolean
  staged: {added: string[]; deleted: string[]; modified: string[]}
  trackingBranch?: string
  unmerged?: Array<{path: string; type: string}>
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
  setUpstream?: boolean
}

export interface IVcPushResponse {
  alreadyUpToDate?: boolean
  branch: string
  upstreamSet?: boolean
}

export interface IVcFetchRequest {
  ref?: string
  remote?: string
}

export interface IVcFetchResponse {
  remote: string
}

export interface IVcPullRequest {
  allowUnrelatedHistories?: boolean
  branch?: string
  remote?: string
}

export interface IVcPullResponse {
  alreadyUpToDate?: boolean
  branch: string
  conflicts?: Array<{path: string; type: string}>
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

export type VcRemoteSubcommand = 'add' | 'remove' | 'set-url' | 'show'

export const VC_REMOTE_SUBCOMMANDS: readonly string[] = [
  'add',
  'remove',
  'set-url',
  'show',
] satisfies readonly VcRemoteSubcommand[]

export const VC_REMOTE_SUBCOMMAND_REQUIRES_URL: Record<VcRemoteSubcommand, boolean> = {
  add: true,
  remove: false,
  'set-url': true,
  show: false,
}

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

export type IVcCloneRequest =
  | {spaceId: string; spaceName: string; teamId: string; teamName: string; url?: never}
  | {spaceId?: string; spaceName?: string; teamId?: string; teamName?: string; url: string}

export interface IVcCloneResponse {
  gitDir: string
  spaceName?: string
  teamName?: string
}

export interface IVcCloneProgressEvent {
  message: string
  step: 'cloning' | 'saving'
}

export type VcBranchAction = 'create' | 'delete' | 'list' | 'set-upstream'

export type IVcBranchRequest =
  | {action: 'create'; name: string; startPoint?: string}
  | {action: 'delete'; name: string}
  | {action: 'list'; all?: boolean}
  | {action: 'set-upstream'; upstream: string}

export interface VcBranch {
  isCurrent: boolean
  isRemote: boolean
  name: string
}

export type IVcBranchResponse =
  | {action: 'create'; created: string}
  | {action: 'delete'; deleted: string}
  | {action: 'list'; branches: VcBranch[]}
  | {action: 'set-upstream'; branch: string; upstream: string}

export interface IVcCheckoutRequest {
  branch: string
  create?: boolean
  force?: boolean
  /** Ref to create the new branch from when `create` is true. Ignored otherwise. */
  startPoint?: string
}

export interface IVcCheckoutResponse {
  branch: string
  created: boolean
  previousBranch?: string
}

export type VcMergeAction = 'abort' | 'continue' | 'merge'

export interface IVcMergeRequest {
  action: VcMergeAction
  allowUnrelatedHistories?: boolean
  branch?: string
  message?: string
}

export interface IVcMergeResponse {
  action: VcMergeAction
  alreadyUpToDate?: boolean
  branch?: string
  conflicts?: Array<{path: string; type: string}>
  defaultMessage?: string
}

export type VcResetMode = 'hard' | 'mixed' | 'soft'

export interface IVcResetRequest {
  filePaths?: string[]
  mode?: VcResetMode
  ref?: string
}

export interface IVcResetResponse {
  filesUnstaged?: number
  headSha?: string
  mode: VcResetMode
}

/**
 * Diff sides:
 * - `'staged'` → compare HEAD blob (old) against index blob (new)
 * - `'unstaged'` → compare index blob (old) against working tree content (new)
 */
export type VcDiffSide = 'staged' | 'unstaged'

export interface IVcDiffRequest {
  path: string
  side: VcDiffSide
}

export interface IVcDiffResponse {
  /** Content on the "new" side (working tree or index depending on `side`). */
  newContent: string
  /** Content on the "old" side (index or HEAD depending on `side`). */
  oldContent: string
  path: string
}

/**
 * Batched diff — returns diffs for multiple paths on the same side in one round-trip.
 * Preserves the order of the input `paths`.
 */
export interface IVcDiffsRequest {
  paths: string[]
  side: VcDiffSide
}

export interface IVcDiffsResponse {
  diffs: IVcDiffResponse[]
}

/**
 * Discards unstaged changes in the working tree.
 * - Tracked files: working tree is restored from the index (or HEAD if not in index).
 * - Untracked files: removed from disk.
 * Staged changes in the index are preserved.
 */
export interface IVcDiscardRequest {
  filePaths: string[]
}

export interface IVcDiscardResponse {
  count: number
}

