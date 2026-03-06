import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import fs from 'node:fs'
import {join} from 'node:path'

import type {
  AddGitParams,
  AddRemoteGitParams,
  BaseGitParams,
  CheckoutGitParams,
  CommitGitParams,
  CreateBranchGitParams,
  FetchGitParams,
  GetRemoteUrlGitParams,
  GitBranch,
  GitCommit,
  GitConflict,
  GitRemote,
  GitStatus,
  GitStatusFile,
  IGitService,
  InitGitParams,
  LogGitParams,
  MergeGitParams,
  MergeResult,
  PullGitParams,
  PullResult,
  PushGitParams,
  PushResult,
  RemoveRemoteGitParams,
} from '../../core/interfaces/services/i-git-service.js'
import type {IAuthStateStore} from '../../core/interfaces/state/i-auth-state-store.js'

import {GitAuthError, GitError} from '../../core/domain/errors/git-error.js'

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

  async add(params: AddGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await Promise.all(params.filePaths.map((filepath) => git.add({dir, filepath, fs})))
  }

  async addRemote(params: AddRemoteGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.addRemote({dir, fs, remote: params.remote, url: params.url})
  }

  async checkout(params: CheckoutGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.checkout({dir, fs, ref: params.ref})
  }

  async commit(params: CommitGitParams): Promise<GitCommit> {
    const dir = this.requireDirectory(params)
    const author = params.author ?? this.getAuthor()
    const sha = await git.commit({author, dir, fs, message: params.message})
    const {commit: commitObj} = await git.readCommit({dir, fs, oid: sha})

    // Clean up MERGE_HEAD if present (isomorphic-git does not remove it automatically)
    await fs.promises.unlink(join(dir, '.git', 'MERGE_HEAD')).catch(() => {})

    return {
      author,
      message: params.message,
      sha,
      timestamp: new Date(commitObj.author.timestamp * 1000),
    }
  }

  async createBranch(params: CreateBranchGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.branch({dir, fs, ref: params.branch})
  }

  async fetch(params: FetchGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    this.requireToken()
    await git.fetch({
      dir,
      fs,
      http,
      onAuth: this.getOnAuth(),
      onAuthFailure: this.getOnAuthFailure(),
      remote: params.remote ?? 'origin',
    })
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

  async listBranches(params: BaseGitParams): Promise<GitBranch[]> {
    const dir = this.requireDirectory(params)
    const current = await this.getCurrentBranch(params)
    const branches = await git.listBranches({dir, fs})
    return branches.map((name) => ({isCurrent: name === current, name}))
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
    const author = this.getAuthor()
    try {
      await git.merge({
        abortOnConflict: false,
        author,
        committer: author,
        dir,
        fs,
        theirs: params.branch,
      })
      return {success: true}
    } catch (error) {
      if (error instanceof git.Errors.MergeConflictError) {
        // isomorphic-git does not write MERGE_HEAD — write it so getConflicts() works post-restart
        const theirsOid = await git.resolveRef({dir, fs, ref: params.branch})
        await fs.promises.writeFile(join(dir, '.git', 'MERGE_HEAD'), `${theirsOid}\n`)
        return {conflicts: this.conflictsFromError(error), success: false}
      }

      throw error
    }
  }

  async pull(params: PullGitParams): Promise<PullResult> {
    const dir = this.requireDirectory(params)
    this.requireToken()
    const remote = params.remote ?? 'origin'

    // Fetch from remote
    await git.fetch({
      dir,
      fs,
      http,
      onAuth: this.getOnAuth(),
      onAuthFailure: this.getOnAuthFailure(),
      remote,
      ...(params.branch ? {remoteRef: params.branch} : {}),
    })

    // Determine which remote-tracking branch to merge
    const localBranch = params.branch ?? (await this.getCurrentBranch(params))
    if (!localBranch) throw new GitError('Cannot determine branch for pull')

    const author = this.getAuthor()
    try {
      await git.merge({
        abortOnConflict: false,
        author,
        committer: author,
        dir,
        fs,
        theirs: `${remote}/${localBranch}`,
      })
      return {success: true}
    } catch (error) {
      if (error instanceof git.Errors.MergeConflictError) {
        // isomorphic-git does not write MERGE_HEAD — write it so getConflicts() works post-restart
        const theirsOid = await git.resolveRef({dir, fs, ref: `refs/remotes/${remote}/${localBranch}`})
        await fs.promises.writeFile(join(dir, '.git', 'MERGE_HEAD'), `${theirsOid}\n`)
        return {conflicts: this.conflictsFromError(error), success: false}
      }

      throw error
    }
  }

  async push(params: PushGitParams): Promise<PushResult> {
    const dir = this.requireDirectory(params)
    this.requireToken()
    try {
      await git.push({
        dir,
        fs,
        http,
        onAuth: this.getOnAuth(),
        onAuthFailure: this.getOnAuthFailure(),
        ref: params.branch,
        remote: params.remote ?? 'origin',
      })
      return {success: true}
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

  async status(params: BaseGitParams): Promise<GitStatus> {
    const dir = this.requireDirectory(params)
    const matrix = await git.statusMatrix({dir, fs})
    const files: GitStatusFile[] = []

    for (const [filepath, head, workdir, stage] of matrix) {
      const path = String(filepath)
      if (head === 1 && workdir === 0 && stage === 0) {
        files.push({path, staged: true, status: 'deleted'}) // [1,0,0] staged deletion (git rm)
      } else if (head === 1 && workdir === 0 && stage === 1) {
        files.push({path, staged: false, status: 'deleted'}) // [1,0,1] unstaged deletion (rm without git rm)
      } else if (head === 1 && workdir === 1 && stage === 0) {
        files.push({path, staged: true, status: 'deleted'}, {path, staged: false, status: 'untracked'}) //          file still in workdir → untracked
      } else if (head === 1 && workdir === 2 && stage === 1) {
        files.push({path, staged: false, status: 'modified'}) // [1,2,1] unstaged modification
      } else if (head === 1 && workdir === 2 && stage === 2) {
        files.push({path, staged: true, status: 'modified'}) // [1,2,2] staged modification
      } else if (head === 1 && workdir === 2 && stage === 3) {
        files.push({path, staged: true, status: 'modified'}, {path, staged: false, status: 'modified'}) //          plus additional unstaged changes
      } else if (head === 0 && workdir === 2 && stage === 0) {
        files.push({path, staged: false, status: 'untracked'}) // [0,2,0] untracked new file
      } else if (head === 0 && workdir === 2 && stage === 2) {
        files.push({path, staged: true, status: 'added'}) // [0,2,2] staged new file
      } else if (head === 0 && workdir === 2 && stage === 3) {
        files.push({path, staged: true, status: 'added'}, {path, staged: false, status: 'modified'}) //          with additional unstaged changes
      }
      // [1,1,1] unmodified → skip
    }

    return {files, isClean: files.length === 0}
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
      name: token.userEmail,
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
