import type {StatusRow} from 'isomorphic-git'

import * as git from 'isomorphic-git'
import fs from 'node:fs'
import {join} from 'node:path'

import type {
  AbortMergeGitParams,
  AddGitParams,
  AddRemoteGitParams,
  AheadBehind,
  BaseGitParams,
  CheckoutGitParams,
  CloneGitParams,
  CommitGitParams,
  CreateBranchGitParams,
  DeleteBranchGitParams,
  FetchGitParams,
  GetAheadBehindParams,
  GetRemoteUrlGitParams,
  GetTrackingBranchParams,
  GitBranch,
  GitCommit,
  GitConflict,
  GitRemote,
  GitStatus,
  GitStatusFile,
  IGitService,
  InitGitParams,
  ListBranchesGitParams,
  LogGitParams,
  MergeGitParams,
  MergeResult,
  PullGitParams,
  PullResult,
  PushGitParams,
  PushResult,
  RemoveRemoteGitParams,
  SetTrackingBranchParams,
  TrackingBranch,
} from '../../core/interfaces/services/i-git-service.js'
import type {IAuthStateStore} from '../../core/interfaces/state/i-auth-state-store.js'

import {GitAuthError, GitError} from '../../core/domain/errors/git-error.js'
import {gitHttpWrapper as http} from './git-http-wrapper.js'

/** Max commit depth for ahead/behind calculation. Counts beyond this are truncated. */
const MAX_AHEAD_BEHIND_DEPTH = 500

/** Shape of isomorphic-git's MergeConflictError.data property. */
type IsomorphicGitConflictData = {
  bothModified: string[]
  deleteByTheirs: string[]
  deleteByUs: string[]
  filepaths: string[]
}

/** isomorphic-git's MergeConflictError — extends Error with a typed `data` property. */
type IsomorphicGitMergeConflictError = Error & {data?: IsomorphicGitConflictData}

export class IsomorphicGitService implements IGitService {
  public constructor(private readonly authStateStore: IAuthStateStore) {}

  private static isConflictError(error: Error): error is IsomorphicGitMergeConflictError {
    return 'data' in error
  }

  private static isMergeConflictData(data: unknown): data is IsomorphicGitConflictData {
    if (typeof data !== 'object' || data === null) return false
    return 'filepaths' in data && Array.isArray(data.filepaths)
  }

  async abortMerge(params: AbortMergeGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    const mergeHeadPath = join(dir, '.git', 'MERGE_HEAD')
    const mergeMsgPath = join(dir, '.git', 'MERGE_MSG')
    await git.checkout({dir, force: true, fs, ref: 'HEAD'})
    await fs.promises.unlink(mergeHeadPath).catch(() => {})
    await fs.promises.unlink(mergeMsgPath).catch(() => {})
  }

  async add(params: AddGitParams): Promise<void> {
    const dir = this.requireDirectory(params)

    // Identify deleted files (exist in HEAD + index but not on disk: [1,0,1])
    // git.add() silently ignores missing files; git.remove() is required to stage deletions
    const matrix = await git.statusMatrix({dir, fs})
    // Covers [1,0,1] (unstaged deletion) and [1,0,2] (post-merge-conflict absent file).
    // stage !== 0 excludes [1,0,0] which is already staged as deletion — no git.remove() needed.
    const deletedInIndex = new Set(
      matrix
        .filter(([, head, workdir, stage]) => head === 1 && workdir === 0 && stage !== 0)
        .map(([filepath]) => String(filepath)),
    )

    // Files not present on disk at all (workdir=0): covers both [1,0,1] (unstaged deletion)
    // and [1,0,0] (already staged deletion). git.add() on these exact paths throws; skip toAdd.
    const notOnDisk = new Set(matrix.filter((row) => row[2] === 0).map((row) => String(row[0])))

    const toRemove: string[] = []
    const toAdd: string[] = []

    for (const rp of params.filePaths) {
      const matchesDelete = (filepath: string) => {
        if (rp === '.') return true
        if (filepath === rp) return true
        const prefix = rp.endsWith('/') ? rp : `${rp}/`
        return filepath.startsWith(prefix)
      }

      for (const deleted of deletedInIndex) {
        if (matchesDelete(deleted)) toRemove.push(deleted)
      }

      // Don't call git.add() for exact paths not on disk — git.remove() handles [1,0,1] above,
      // and [1,0,0] (already staged deletion) needs no further action.
      // git.add('.') and directory patterns are fine (silently skip missing files).
      if (!notOnDisk.has(rp)) {
        toAdd.push(rp)
      }
    }

    const results = await Promise.allSettled([
      ...toRemove.map((filepath) => git.remove({dir, filepath, fs})),
      ...toAdd.map((filepath) => git.add({dir, filepath, fs})),
    ])

    const allPaths = [...toRemove, ...toAdd]
    const failed = results
      .map((r, i) => ({path: allPaths[i], result: r}))
      .filter((x): x is {path: string; result: PromiseRejectedResult} => x.result.status === 'rejected')

    if (failed.length > 0) {
      const paths = failed.map((f) => f.path).join(', ')
      throw new GitError(`Failed to stage: ${paths}`)
    }
  }

  async addRemote(params: AddRemoteGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.addRemote({dir, fs, remote: params.remote, url: params.url})
  }

  async checkout(params: CheckoutGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.checkout({dir, force: params.force, fs, ref: params.ref})
  }

  async clone(params: CloneGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    const token = this.requireToken()
    await git.clone({
      dir,
      fs,
      headers: this.buildBasicAuthHeaders(token.userId, token.sessionKey),
      http,
      onAuth: this.getOnAuth(),
      onAuthFailure: this.getOnAuthFailure(),
      onProgress: params.onProgress,
      url: params.url,
    })
  }

  async commit(params: CommitGitParams): Promise<GitCommit> {
    const dir = this.requireDirectory(params)
    const author = params.author ?? this.getAuthor()

    // If MERGE_HEAD exists, create a proper merge commit with two parents
    const mergeHeadPath = join(dir, '.git', 'MERGE_HEAD')
    const mergeMsgPath = join(dir, '.git', 'MERGE_MSG')
    const mergeHeadContent = await fs.promises.readFile(mergeHeadPath, 'utf8').catch(() => null)
    const mergeHead = mergeHeadContent?.trim() ?? null

    let parent: string[] | undefined
    if (mergeHead) {
      const headSha = await git.resolveRef({dir, fs, ref: 'HEAD'})
      parent = [headSha, mergeHead]
    }

    let sha: string
    try {
      sha = await git.commit({author, dir, fs, message: params.message, ...(parent ? {parent} : {})})
    } catch (error) {
      if (error instanceof git.Errors.UnmergedPathsError) {
        const paths = error.data.filepaths.join(', ')
        throw new GitError(`Unmerged files must be resolved before committing: ${paths}`)
      }

      throw error
    }

    const {commit: commitObj} = await git.readCommit({dir, fs, oid: sha})

    // Clean up MERGE_HEAD and MERGE_MSG (isomorphic-git does not remove them automatically)
    await fs.promises.unlink(mergeHeadPath).catch(() => {})
    await fs.promises.unlink(mergeMsgPath).catch(() => {})

    return {
      author,
      message: params.message,
      sha,
      timestamp: new Date(commitObj.author.timestamp * 1000),
    }
  }

  async createBranch(params: CreateBranchGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.branch({checkout: params.checkout, dir, fs, ref: params.branch})
  }

  async deleteBranch(params: DeleteBranchGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.deleteBranch({dir, fs, ref: params.branch})
  }

  async fetch(params: FetchGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    const token = this.requireToken()
    await git.fetch({
      dir,
      fs,
      headers: this.buildBasicAuthHeaders(token.userId, token.sessionKey),
      http,
      onAuth: this.getOnAuth(),
      onAuthFailure: this.getOnAuthFailure(),
      remote: params.remote ?? 'origin',
    })
  }

  async getAheadBehind(params: GetAheadBehindParams): Promise<AheadBehind> {
    const dir = this.requireDirectory(params)

    const localSha = await git.resolveRef({dir, fs, ref: params.localRef}).catch(() => null)
    const remoteSha = await git.resolveRef({dir, fs, ref: params.remoteRef}).catch(() => null)
    if (!localSha || !remoteSha) return {ahead: 0, behind: 0}
    if (localSha === remoteSha) return {ahead: 0, behind: 0}

    const [localLog, remoteLog] = await Promise.all([
      git.log({depth: MAX_AHEAD_BEHIND_DEPTH, dir, fs, ref: params.localRef}).catch(() => []),
      git.log({depth: MAX_AHEAD_BEHIND_DEPTH, dir, fs, ref: params.remoteRef}).catch(() => []),
    ])

    const localShas = new Set(localLog.map((c) => c.oid))
    const remoteShas = new Set(remoteLog.map((c) => c.oid))

    const ahead = localLog.filter((c) => !remoteShas.has(c.oid)).length
    const behind = remoteLog.filter((c) => !localShas.has(c.oid)).length
    return {ahead, behind}
  }

  async getConflicts(params: BaseGitParams): Promise<GitConflict[]> {
    const dir = this.requireDirectory(params)

    // Only report conflicts when a merge is actually in progress
    const mergeInProgress = await fs.promises
      .access(join(dir, '.git', 'MERGE_HEAD'))
      .then(() => true)
      .catch(() => false)

    if (!mergeInProgress) return []

    const matrix = await git.statusMatrix({dir, fs})
    const conflicts: GitConflict[] = []

    await Promise.all(
      matrix.map(async ([filepath, head, workdir]) => {
        const path = String(filepath)

        // deleted_modified: file was in HEAD but gone from workdir
        if (head === 1 && workdir === 0) {
          conflicts.push({path, type: 'deleted_modified'})
          return
        }

        // both_added or both_modified: look for conflict markers in file content
        if (workdir === 2) {
          try {
            const content = await fs.promises.readFile(join(dir, path), 'utf8')
            if (content.includes('<<<<<<<')) {
              const type: GitConflict['type'] = head === 0 ? 'both_added' : 'both_modified'
              conflicts.push({path, type})
            }
          } catch {
            // skip binary or unreadable files
          }
        }
      }),
    )

    return conflicts.sort((a, b) => a.path.localeCompare(b.path))
  }

  async getCurrentBranch(params: BaseGitParams): Promise<string | undefined> {
    const dir = this.requireDirectory(params)
    const branch = await git.currentBranch({dir, fs})
    return branch ?? undefined
  }

  async getRemoteUrl(params: GetRemoteUrlGitParams): Promise<string | undefined> {
    const dir = this.requireDirectory(params)
    const result = await git.getConfig({dir, fs, path: `remote.${params.remote}.url`})
    return result === undefined || result === null ? undefined : String(result)
  }

  async getTrackingBranch(params: GetTrackingBranchParams): Promise<TrackingBranch | undefined> {
    const dir = this.requireDirectory(params)
    const remote = await git.getConfig({dir, fs, path: `branch.${params.branch}.remote`})
    if (remote === undefined || remote === null) return undefined

    const merge = await git.getConfig({dir, fs, path: `branch.${params.branch}.merge`})
    if (merge === undefined || merge === null) return undefined

    // merge is stored as refs/heads/<branch> — extract the branch name
    const mergeStr = String(merge)
    const remoteBranch = mergeStr.startsWith('refs/heads/') ? mergeStr.slice('refs/heads/'.length) : mergeStr
    return {remote: String(remote), remoteBranch}
  }

  async init(params: InitGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.init({defaultBranch: params.defaultBranch ?? 'main', dir, fs})
  }

  async isInitialized(params: BaseGitParams): Promise<boolean> {
    const dir = this.requireDirectory(params)
    return fs.promises
      .access(join(dir, '.git'))
      .then(() => true)
      .catch(() => false)
  }

  async listBranches(params: ListBranchesGitParams): Promise<GitBranch[]> {
    const dir = this.requireDirectory(params)
    const current = await this.getCurrentBranch(params)
    const branches = await git.listBranches({dir, fs})
    const result: GitBranch[] = branches.map((name) => ({isCurrent: name === current, isRemote: false, name}))

    if (params.remote) {
      try {
        const remoteBranches = await git.listBranches({dir, fs, remote: params.remote})
        for (const name of remoteBranches) {
          if (name === 'HEAD') continue
          result.push({isCurrent: false, isRemote: true, name: `${params.remote}/${name}`})
        }
      } catch {
        // No remote configured or no refs fetched yet — return local-only.
        // Mirrors `git branch -a`: never auto-fetches, reads cached refs only.
      }
    }

    return result
  }

  async listRemotes(params: BaseGitParams): Promise<GitRemote[]> {
    const dir = this.requireDirectory(params)
    const remotes = await git.listRemotes({dir, fs})
    return remotes.map((r) => ({remote: r.remote, url: r.url}))
  }

  async log(params: LogGitParams): Promise<GitCommit[]> {
    const dir = this.requireDirectory(params)
    try {
      const commits = await git.log({depth: params.depth, dir, fs, ref: params.ref})
      return commits.map((c) => ({
        author: {email: c.commit.author.email, name: c.commit.author.name},
        message: c.commit.message.trim(),
        sha: c.oid,
        timestamp: new Date(c.commit.author.timestamp * 1000),
      }))
    } catch (error) {
      // No commits yet — HEAD ref does not exist
      if (error instanceof git.Errors.NotFoundError) return []
      throw error
    }
  }

  async merge(params: MergeGitParams): Promise<MergeResult> {
    const dir = this.requireDirectory(params)
    const mergeHeadPath = join(dir, '.git', 'MERGE_HEAD')
    const mergeMsgPath = join(dir, '.git', 'MERGE_MSG')
    const author = this.getAuthor()
    const message = params.message ?? `Merge branch '${params.branch}'`
    try {
      await git.merge({
        abortOnConflict: false,
        author,
        committer: author,
        dir,
        fs,
        message,
        theirs: params.branch,
      })
      return {success: true}
    } catch (error) {
      if (error instanceof git.Errors.MergeConflictError) {
        // isomorphic-git does not write MERGE_HEAD/MERGE_MSG — write them so
        // getConflicts() and --continue work post-restart
        const theirsOid = await git.resolveRef({dir, fs, ref: params.branch})
        await fs.promises.writeFile(mergeHeadPath, `${theirsOid}\n`)
        await fs.promises.writeFile(mergeMsgPath, `${message}\n`)
        return {conflicts: this.conflictsFromError(error), success: false}
      }

      throw error
    }
  }

  async pull(params: PullGitParams): Promise<PullResult> {
    const dir = this.requireDirectory(params)
    const token = this.requireToken()
    const remote = params.remote ?? 'origin'

    // Guard: if MERGE_HEAD exists, a previous merge is unresolved — refuse to pull
    const hasPendingMerge = await fs.promises
      .readFile(join(dir, '.git', 'MERGE_HEAD'), 'utf8')
      .then(() => true)
      .catch(() => false)
    if (hasPendingMerge) {
      throw new GitError(
        'You have unresolved merge conflicts. Resolve them, stage the files, and commit before pulling again.',
      )
    }

    // Fetch from remote
    await git.fetch({
      dir,
      fs,
      headers: this.buildBasicAuthHeaders(token.userId, token.sessionKey),
      http,
      onAuth: this.getOnAuth(),
      onAuthFailure: this.getOnAuthFailure(),
      remote,
      ...(params.branch ? {remoteRef: params.branch} : {}),
    })

    // Determine which remote-tracking branch to merge
    const localBranch = params.branch ?? (await this.getCurrentBranch(params))
    if (!localBranch) throw new GitError('Cannot determine branch for pull')

    // After fetch, check if already up to date
    const localSha = await git.resolveRef({dir, fs, ref: `refs/heads/${localBranch}`}).catch(() => null)
    const remoteSha = await git.resolveRef({dir, fs, ref: `refs/remotes/${remote}/${localBranch}`}).catch(() => null)
    if (localSha && remoteSha && localSha === remoteSha) {
      return {alreadyUpToDate: true, success: true}
    }

    // Step 2: working tree safety check (isomorphic-git does not do this automatically)
    // Abort if any dirty local file would be overwritten by the incoming changes
    if (localSha && remoteSha) {
      const matrix = await git.statusMatrix({dir, fs})
      const dirtyFiles = matrix.filter((row) => row[2] !== 1 || row[3] !== 1).map((row) => String(row[0]))

      const localRef = localSha
      const remoteRef = remoteSha
      const wouldBeOverwritten = await Promise.all(
        dirtyFiles.map(async (filepath) => {
          const [localFileOid, remoteFileOid] = await Promise.all([
            git
              .readBlob({dir, filepath, fs, oid: localRef})
              .then((r) => r.oid)
              .catch(() => null),
            git
              .readBlob({dir, filepath, fs, oid: remoteRef})
              .then((r) => r.oid)
              .catch(() => null),
          ])
          return localFileOid !== remoteFileOid
        }),
      )
      if (wouldBeOverwritten.some(Boolean)) {
        throw new GitError('Local changes would be overwritten by pull. Commit or discard your changes first.')
      }
    }

    const author = this.getAuthor()
    try {
      const mergeResult = await git.merge({
        abortOnConflict: false,
        author,
        committer: author,
        dir,
        fs,
        theirs: `${remote}/${localBranch}`,
      })
      // isomorphic-git merge only updates refs/commits — checkout to apply file changes to workdir.
      await git.checkout({dir, fs, ref: localBranch})
      return {alreadyUpToDate: mergeResult.alreadyMerged, success: true}
    } catch (error) {
      if (error instanceof git.Errors.MergeConflictError) {
        // isomorphic-git does not write MERGE_HEAD — write it so getConflicts() works post-restart
        const theirsOid = await git.resolveRef({dir, fs, ref: `refs/remotes/${remote}/${localBranch}`})
        await fs.promises.writeFile(join(dir, '.git', 'MERGE_HEAD'), `${theirsOid}\n`)
        return {conflicts: this.conflictsFromError(error), success: false}
      }

      if (error instanceof git.Errors.CheckoutConflictError) {
        // Undo the merge commit — restore HEAD to pre-merge state so repo is left clean
        if (localSha) {
          await git.writeRef({dir, force: true, fs, ref: `refs/heads/${localBranch}`, value: localSha})
        }

        throw new GitError('Local changes would be overwritten by pull. Commit or discard your changes first.')
      }

      throw error
    }
  }

  async push(params: PushGitParams): Promise<PushResult> {
    const dir = this.requireDirectory(params)
    const token = this.requireToken()
    try {
      const branch = params.branch ?? (await git.currentBranch({dir, fs})) ?? 'main'
      const remote = params.remote ?? 'origin'

      const localSha = await git.resolveRef({dir, fs, ref: `refs/heads/${branch}`}).catch(() => null)
      const remoteSha = await git.resolveRef({dir, fs, ref: `refs/remotes/${remote}/${branch}`}).catch(() => null)
      if (localSha && remoteSha && localSha === remoteSha) {
        return {alreadyUpToDate: true, success: true}
      }

      await git.push({
        dir,
        fs,
        headers: this.buildBasicAuthHeaders(token.userId, token.sessionKey),
        http,
        onAuth: this.getOnAuth(),
        onAuthFailure: this.getOnAuthFailure(),
        ref: params.branch,
        remote,
      })
      return {alreadyUpToDate: false, success: true}
    } catch (error) {
      if (error instanceof git.Errors.PushRejectedError) {
        return {message: error.message, reason: 'non_fast_forward', success: false}
      }

      throw error
    }
  }

  async removeRemote(params: RemoveRemoteGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.deleteRemote({dir, fs, remote: params.remote})
  }

  async setTrackingBranch(params: SetTrackingBranchParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.setConfig({dir, fs, path: `branch.${params.branch}.remote`, value: params.remote})
    await git.setConfig({dir, fs, path: `branch.${params.branch}.merge`, value: `refs/heads/${params.remoteBranch}`})
  }

  async status(params: BaseGitParams): Promise<GitStatus> {
    const dir = this.requireDirectory(params)
    const matrix = await git.statusMatrix({dir, fs})
    const files = this.parseMatrix(matrix)
    return {files, isClean: files.length === 0}
  }

  private buildBasicAuthHeaders(userId: string, sessionKey: string): Record<string, string> {
    const credentials = Buffer.from(`${userId}:${sessionKey}`).toString('base64')
    return {Authorization: `Basic ${credentials}`}
  }

  private conflictsFromError(error: Error): GitConflict[] {
    if (!IsomorphicGitService.isConflictError(error)) return []
    const conflictData = error.data
    if (!IsomorphicGitService.isMergeConflictData(conflictData)) return []

    const deletedPaths = new Set([...(conflictData.deleteByTheirs ?? []), ...(conflictData.deleteByUs ?? [])])
    const bothModifiedPaths = new Set(conflictData.bothModified ?? [])

    return conflictData.filepaths
      .map(
        (path): GitConflict => ({
          path,
          type: deletedPaths.has(path)
            ? 'deleted_modified'
            : bothModifiedPaths.has(path)
              ? 'both_modified'
              : 'both_added',
        }),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  private getAuthor(): {email: string; name: string} {
    const token = this.authStateStore.getToken()
    if (!token) throw new GitAuthError()
    return {
      email: token.userEmail,
      name: token.userName ?? token.userEmail,
    }
  }

  private getOnAuth() {
    return () => {
      const token = this.authStateStore.getToken()
      if (!token) throw new GitAuthError()
      return {
        password: token.sessionKey,
        username: token.userId,
      }
    }
  }

  private getOnAuthFailure() {
    return () => {
      throw new GitAuthError('Authentication failed. Try /login again.')
    }
  }

  // eslint-disable-next-line complexity
  private parseMatrix(matrix: StatusRow[]): GitStatusFile[] {
    const files: GitStatusFile[] = []
    for (const [filepath, head, workdir, stage] of matrix) {
      const path = String(filepath)
      if (head === 1 && workdir === 0 && stage === 0) {
        files.push({path, staged: true, status: 'deleted'}) // [1,0,0] staged deletion (git rm)
      } else if (head === 1 && workdir === 0 && stage === 1) {
        files.push({path, staged: false, status: 'deleted'}) // [1,0,1] unstaged deletion (rm without git rm)
      } else if (head === 1 && workdir === 0 && stage === 2) {
        files.push({path, staged: false, status: 'deleted'}) // [1,0,2] absent from disk, index differs from HEAD (e.g. post-merge-conflict)
      } else if (head === 1 && workdir === 1 && stage === 0) {
        files.push({path, staged: true, status: 'deleted'}, {path, staged: false, status: 'untracked'}) // [1,1,0] git rm --cached: staged deletion + file still in workdir → untracked
      } else if (head === 1 && workdir === 2 && stage === 1) {
        files.push({path, staged: false, status: 'modified'}) // [1,2,1] unstaged modification
      } else if (head === 1 && workdir === 2 && stage === 2) {
        files.push({path, staged: true, status: 'modified'}) // [1,2,2] staged modification
      } else if (head === 1 && workdir === 2 && stage === 3) {
        files.push({path, staged: true, status: 'modified'}, {path, staged: false, status: 'modified'}) // [1,2,3] partially staged modification
      } else if (head === 0 && workdir === 2 && stage === 0) {
        files.push({path, staged: false, status: 'untracked'}) // [0,2,0] untracked new file
      } else if (head === 0 && workdir === 2 && stage === 2) {
        files.push({path, staged: true, status: 'added'}) // [0,2,2] staged new file
      } else if (head === 0 && workdir === 2 && stage === 3) {
        files.push({path, staged: true, status: 'added'}, {path, staged: false, status: 'modified'}) // [0,2,3] partially staged new file
      }
      // [1,1,1] unmodified → skip
    }

    return files
  }

  private requireDirectory(params: BaseGitParams): string {
    // Guard against empty string — undefined/null are caught by TypeScript at compile time
    if (!params.directory) throw new GitError('directory is required for git operations')
    return params.directory
  }

  private requireToken(): NonNullable<ReturnType<IAuthStateStore['getToken']>> {
    const token = this.authStateStore.getToken()
    if (!token) throw new GitAuthError()
    return token
  }
}
