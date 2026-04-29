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
export type CommitGitParams = {
  author?: {email: string; name: string}
  message: string
  /**
   * Optional sign callback — receives the raw commit payload (the text that would be signed)
   * and must return an armored SSH signature (-----BEGIN SSH SIGNATURE----- ... -----END SSH SIGNATURE-----).
   * When provided, the commit is created with a gpgsig header containing the returned signature.
   */
  onSign?: (payload: string) => Promise<string>
} & BaseGitParams
export type LogGitParams = BaseGitParams & {depth?: number; filepath?: string; ref?: string}
export type PushGitParams = BaseGitParams & {branch?: string; remote?: string}
export type PullGitParams = BaseGitParams & {
  allowUnrelatedHistories?: boolean
  author?: {email: string; name: string}
  branch?: string
  remote?: string
}
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

/**
 * Source of the blob content.
 * - `'STAGE'` → blob in the git index (staging area)
 * - `{commitish: string}` → blob at the resolved commit (branch name, tag, SHA, or `'HEAD'`)
 */
export type GitBlobRef = 'STAGE' | {commitish: string}

export type GetBlobContentParams = BaseGitParams & {
  path: string
  ref: GitBlobRef
}

export type GetBlobContentsParams = BaseGitParams & {
  paths: string[]
  ref: GitBlobRef
}

/** Map of path → blob content (utf8). Missing entries indicate the blob is absent at that ref. */
export type BlobContents = Record<string, string | undefined>

/**
 * Source of the side being diffed. Beyond `GitBlobRef`, also supports `'WORKDIR'`
 * (the working tree, used for unstaged and ref-vs-worktree comparisons).
 */
export type GitDiffSide = 'STAGE' | 'WORKDIR' | {commitish: string}

export type ListChangedFilesParams = BaseGitParams & {
  from: GitDiffSide
  to: GitDiffSide
}

export type ChangedFile = {
  path: string
  status: 'added' | 'deleted' | 'modified'
}

/** Content + short oid pair returned by {@link IGitService.getTextBlob}. */
export type TextBlob = {
  /** True when the blob contains a NUL byte; `content` is then empty. */
  binary?: boolean
  /** UTF-8 decoded blob content (empty string when binary). */
  content: string
  /** 7-char short oid. */
  oid: string
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
   * Reads the content of a file blob at a given git ref.
   * - `ref: 'STAGE'` → reads the blob staged in the index at `path`
   * - `ref: {commitish}` → resolves the commit-ish ref (branch name, tag, SHA, or `'HEAD'`), then reads the blob at `path`
   *
   * Returns `undefined` when no blob exists at that ref (e.g. file not yet committed,
   * or file not yet staged), or when the ref has no commits.
   */
  getBlobContent(params: GetBlobContentParams): Promise<string | undefined>
  /**
   * Batch version of {@link getBlobContent} — reads multiple blobs at the same ref in one pass.
   * For `STAGE`, walks the index once instead of once per path (avoids an N+1).
   * Returned map contains an entry for every requested path; `undefined` when no blob exists.
   */
  getBlobContents(params: GetBlobContentsParams): Promise<BlobContents>
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
  /**
   * Reads a UTF-8 text blob together with its short oid in a single pass.
   * Returns `undefined` when the blob is absent or detected as binary (contains a NUL byte).
   * Used by diff producers to avoid the double-read pattern of calling `getBlobContent`
   * and `git.hashBlob` separately.
   */
  getTextBlob(params: GetBlobContentParams): Promise<TextBlob | undefined>
  /** Returns the upstream tracking branch config, or `undefined` if not configured. */
  getTrackingBranch(params: GetTrackingBranchParams): Promise<TrackingBranch | undefined>
  /**
   * Returns the 7-character short oid that git would assign to the given content,
   * computed via `git.hashBlob`. Used to render the working-tree side of a
   * `git diff`-style `index <oid>..<oid>` header (the working tree has no stored oid).
   */
  hashBlob(content: Buffer): Promise<string>
  init(params: InitGitParams): Promise<void>
  /** Returns true if `ancestor` commit is reachable from `commit`. */
  isAncestor(params: BaseGitParams & {ancestor: string; commit: string}): Promise<boolean>
  /** Returns true if the repository is freshly initialized with no commits, remotes, branches, tags, or untracked files. */
  isEmptyRepository(params: BaseGitParams): Promise<boolean>
  /** Returns true if a git repository (.git directory) exists at the given directory. */
  isInitialized(params: BaseGitParams): Promise<boolean>
  /** Lists local branches. When `remote` is specified, also includes remote-tracking branches. */
  listBranches(params: ListBranchesGitParams): Promise<GitBranch[]>
  /**
   * Returns the set of files that differ between two diff sides, with their change status.
   *
   * Status mirrors `git diff` semantics:
   * - `'added'`   → present on `to` side, absent on `from` side
   * - `'deleted'` → present on `from` side, absent on `to` side
   * - `'modified'` → present on both, differs
   *
   * Untracked files (absent from both HEAD and STAGE) are excluded from the
   * unstaged case (`from='STAGE', to='WORKDIR'`) to match `git diff` no-args behavior.
   */
  listChangedFiles(params: ListChangedFilesParams): Promise<ChangedFile[]>
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
