// --- Base ---
export type BaseGitParams = {
  directory: string
}

// --- Entity / Return types ---
export type GitStatusFile = {
  path: string
  staged: boolean
  status: 'added' | 'deleted' | 'modified' | 'untracked'
}

export type GitStatus = {
  /** Only contains files with changes. Empty when the working tree is clean. */
  files: GitStatusFile[]
  isClean: boolean
}

export type GitCommit = {
  author: {email: string; name: string}
  message: string
  sha: string
  timestamp: Date
}

export type GitBranch = {
  isCurrent: boolean
  isRemote: boolean
  name: string
}

export type GitConflict = {
  path: string
  type: 'both_added' | 'both_modified' | 'deleted_modified'
}

export type GitRemote = {
  remote: string
  url: string
}

export type PushResult =
  | {alreadyUpToDate?: boolean; success: true}
  | {message?: string; reason: 'non_fast_forward'; success: false}

export type PullResult = {alreadyUpToDate?: boolean; success: true} | {conflicts: GitConflict[]; success: false}

export type MergeResult = {alreadyUpToDate?: boolean; success: true} | {conflicts: GitConflict[]; success: false}

export type TrackingBranch = {remote: string; remoteBranch: string}

export type AheadBehind = {ahead: number; behind: number}

// --- Params types ---
export type InitGitParams = BaseGitParams & {defaultBranch?: string}
export type AddGitParams = BaseGitParams & {filePaths: string[]}
export type CommitGitParams = BaseGitParams & {author?: {email: string; name: string}; message: string}
export type LogGitParams = BaseGitParams & {depth?: number; filepath?: string; ref?: string}
export type PushGitParams = BaseGitParams & {branch?: string; remote?: string}
export type PullGitParams = BaseGitParams & {allowUnrelatedHistories?: boolean; author?: {email: string; name: string}; branch?: string; remote?: string}
export type FetchGitParams = BaseGitParams & {ref?: string; remote?: string}
export type AbortMergeGitParams = BaseGitParams
export type MergeGitParams = BaseGitParams & {
  allowUnrelatedHistories?: boolean
  author?: {email: string; name: string}
  branch: string
  message?: string
}
export type CreateBranchGitParams = BaseGitParams & {
  branch: string
  checkout?: boolean
  /** Ref (branch name, tag, or SHA) to create the new branch from. Defaults to HEAD. */
  startPoint?: string
}
export type DeleteBranchGitParams = BaseGitParams & {branch: string}
export type ListBranchesGitParams = BaseGitParams & {remote?: string}
export type CheckoutGitParams = BaseGitParams & {force?: boolean; ref: string}
export type AddRemoteGitParams = BaseGitParams & {remote: string; url: string}
export type RemoveRemoteGitParams = BaseGitParams & {remote: string}
export type GetRemoteUrlGitParams = BaseGitParams & {remote: string}
export type GetTrackingBranchParams = BaseGitParams & {branch: string}
export type SetTrackingBranchParams = BaseGitParams & {branch: string; remote: string; remoteBranch: string}
export type GetAheadBehindParams = BaseGitParams & {localRef: string; remoteRef: string}
export type ResetMode = 'hard' | 'mixed' | 'soft'
export type ResetGitParams = BaseGitParams & {
  filePaths?: string[]
  mode?: ResetMode
  ref?: string
}
export type ResetResult = {
  filesChanged: number
  headSha: string
}

export type CloneGitParams = BaseGitParams & {
  onProgress?: (progress: {loaded: number; phase: string; total?: number}) => void
  url: string
}

// --- Interface ---
export interface IGitService {
  abortMerge(params: AbortMergeGitParams): Promise<void>
  add(params: AddGitParams): Promise<void>
  addRemote(params: AddRemoteGitParams): Promise<void>
  checkout(params: CheckoutGitParams): Promise<void>
  clone(params: CloneGitParams): Promise<void>
  commit(params: CommitGitParams): Promise<GitCommit>
  createBranch(params: CreateBranchGitParams): Promise<void>
  deleteBranch(params: DeleteBranchGitParams): Promise<void>
  fetch(params: FetchGitParams): Promise<void>
  /** Returns how many commits the local ref is ahead/behind relative to the remote ref. */
  getAheadBehind(params: GetAheadBehindParams): Promise<AheadBehind>
  /**
   * Returns conflicts currently present in the working tree.
   * Detects all three conflict types (both_modified, both_added, deleted_modified)
   * by inspecting the git status matrix.
   *
   * Returns an empty array when no merge is in progress (MERGE_HEAD absent).
   *
   * Use this to inspect conflict state when the original `merge()` / `pull()` result is
   * no longer available — e.g. after a process restart or when refreshing a conflict UI.
   */
  getConflicts(params: BaseGitParams): Promise<GitConflict[]>
  /** Returns the current branch name, or `undefined` when in detached HEAD state. */
  getCurrentBranch(params: BaseGitParams): Promise<string | undefined>
  /**
   * Scans tracked files for git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
   * Unlike `getConflicts()`, this works regardless of merge state — it detects
   * leftover markers even after a merge is completed or aborted.
   */
  getFilesWithConflictMarkers(params: BaseGitParams): Promise<string[]>
  getRemoteUrl(params: GetRemoteUrlGitParams): Promise<string | undefined>
  /** Returns the upstream tracking branch config, or `undefined` if not configured. */
  getTrackingBranch(params: GetTrackingBranchParams): Promise<TrackingBranch | undefined>
  init(params: InitGitParams): Promise<void>
  /** Returns true if `ancestor` commit is reachable from `commit`. */
  isAncestor(params: BaseGitParams & {ancestor: string; commit: string}): Promise<boolean>
  /** Returns true if the repository is freshly initialized with no commits, remotes, branches, tags, or untracked files. */
  isEmptyRepository(params: BaseGitParams): Promise<boolean>
  /** Returns true if a git repository (.git directory) exists at the given directory. */
  isInitialized(params: BaseGitParams): Promise<boolean>
  /** Lists local branches. When `remote` is specified, also includes remote-tracking branches. */
  listBranches(params: ListBranchesGitParams): Promise<GitBranch[]>
  listRemotes(params: BaseGitParams): Promise<GitRemote[]>
  log(params: LogGitParams): Promise<GitCommit[]>
  merge(params: MergeGitParams): Promise<MergeResult>
  pull(params: PullGitParams): Promise<PullResult>
  /**
   * Pushes local commits to the remote.
   * Returns `{success: false, reason: 'non_fast_forward'}` when the remote has
   * diverged (recoverable — caller can pull or force-push).
   * Throws for unrecoverable failures (network error, auth failure, remote not found).
   */
  push(params: PushGitParams): Promise<PushResult>
  removeRemote(params: RemoveRemoteGitParams): Promise<void>
  /**
   * Resets the index and/or HEAD.
   * - filePaths provided: unstages specific files (always mixed, ignores mode)
   * - mode=mixed (default): resets index to ref. If ref is HEAD, unstages all.
   *   If ref is a commit (e.g. HEAD~1), moves HEAD back and unstages.
   * - mode=soft: moves HEAD to ref, keeps index and working tree intact
   * - mode=hard: moves HEAD to ref, resets index and working tree
   */
  reset(params: ResetGitParams): Promise<ResetResult>
  /** Writes upstream tracking config: `branch.<name>.remote` and `branch.<name>.merge`. */
  setTrackingBranch(params: SetTrackingBranchParams): Promise<void>
  status(params: BaseGitParams): Promise<GitStatus>
}
