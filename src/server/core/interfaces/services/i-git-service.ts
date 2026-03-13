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

export type PushResult = {alreadyUpToDate?: boolean; success: true} | {message?: string; reason: 'non_fast_forward'; success: false}

export type PullResult = {alreadyUpToDate?: boolean; success: true} | {conflicts: GitConflict[]; success: false}

export type MergeResult = {conflicts: GitConflict[]; success: false} | {success: true}

// --- Params types ---
export type InitGitParams = BaseGitParams & {defaultBranch?: string}
export type AddGitParams = BaseGitParams & {filePaths: string[]}
export type CommitGitParams = BaseGitParams & {author?: {email: string; name: string}; message: string}
export type LogGitParams = BaseGitParams & {depth?: number; ref?: string}
export type PushGitParams = BaseGitParams & {branch?: string; remote?: string}
export type PullGitParams = BaseGitParams & {branch?: string; remote?: string}
export type FetchGitParams = BaseGitParams & {remote?: string}
export type MergeGitParams = BaseGitParams & {branch: string}
export type CreateBranchGitParams = BaseGitParams & {branch: string}
export type DeleteBranchGitParams = BaseGitParams & {branch: string}
export type ListBranchesGitParams = BaseGitParams & {remote?: string}
export type CheckoutGitParams = BaseGitParams & {ref: string}
export type AddRemoteGitParams = BaseGitParams & {remote: string; url: string}
export type RemoveRemoteGitParams = BaseGitParams & {remote: string}
export type GetRemoteUrlGitParams = BaseGitParams & {remote: string}
export type CloneGitParams = BaseGitParams & {
  onProgress?: (progress: {loaded: number; phase: string; total?: number}) => void
  url: string
}

// --- Interface ---
export interface IGitService {
  add(params: AddGitParams): Promise<void>
  addRemote(params: AddRemoteGitParams): Promise<void>
  checkout(params: CheckoutGitParams): Promise<void>
  clone(params: CloneGitParams): Promise<void>
  commit(params: CommitGitParams): Promise<GitCommit>
  createBranch(params: CreateBranchGitParams): Promise<void>
  deleteBranch(params: DeleteBranchGitParams): Promise<void>
  fetch(params: FetchGitParams): Promise<void>
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
  getRemoteUrl(params: GetRemoteUrlGitParams): Promise<string | undefined>
  init(params: InitGitParams): Promise<void>
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
  status(params: BaseGitParams): Promise<GitStatus>
}
