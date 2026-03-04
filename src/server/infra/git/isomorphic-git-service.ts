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

export type IsomorphicGitServiceConfig = {
  cogitGitBaseUrl: string
}

export class IsomorphicGitService implements IGitService {
  public constructor(
    private readonly authStateStore: IAuthStateStore,
    private readonly config: IsomorphicGitServiceConfig,
  ) {}

  // --- Private helpers ---

  async add(params: AddGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await Promise.all(params.filePaths.map((filepath) => git.add({dir, filepath, fs})))
  }

  async addRemote(params: AddRemoteGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.addRemote({dir, fs, remote: params.remote, url: params.url})
  }

  /**
   * Build the CoGit Git remote URL for a given team and space.
   * Format: {cogitGitBaseUrl}/git/{teamId}/{spaceId}.git
   */
  buildCogitRemoteUrl(teamId: string, spaceId: string): string {
    const base = this.config.cogitGitBaseUrl.replace(/\/$/, '')
    return `${base}/git/${teamId}/${spaceId}.git`
  }

  async checkout(params: CheckoutGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.checkout({dir, fs, ref: params.ref})
  }

  async commit(params: CommitGitParams): Promise<GitCommit> {
    const dir = this.requireDirectory(params)
    const author = params.author ?? this.getAuthor()
    const sha = await git.commit({author, dir, fs, message: params.message})
    return {
      author,
      message: params.message,
      sha,
      timestamp: new Date(),
    }
  }

  async createBranch(params: CreateBranchGitParams): Promise<void> {
    const dir = this.requireDirectory(params)
    await git.branch({dir, fs, ref: params.branch})
  }

  // --- IGitService implementation ---

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
    const conflicts: GitConflict[] = []
    this.walkDir(dir, dir, conflicts)
    return conflicts
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
      if (error instanceof Error && error.name === 'NotFoundError') return []
      throw error
    }
  }

  async merge(params: MergeGitParams): Promise<MergeResult> {
    const dir = this.requireDirectory(params)
    const author = this.getAuthor()
    try {
      await git.merge({
        author,
        committer: author,
        dir,
        fs,
        theirs: params.branch,
      })
      return {success: true}
    } catch (error) {
      if (error instanceof Error && error.name === 'MergeConflictError') {
        const conflicts = await this.getConflicts(params)
        return {conflicts, success: false}
      }

      throw error
    }
  }

  async pull(params: PullGitParams): Promise<PullResult> {
    const dir = this.requireDirectory(params)
    this.requireToken()
    const author = this.getAuthor()
    try {
      await git.pull({
        author,
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
      if (error instanceof Error && error.name === 'MergeConflictError') {
        const conflicts = await this.getConflicts(params)
        return {conflicts, success: false}
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
      if (error instanceof Error && error.name === 'PushRejectedError') {
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
    const files = matrix
      .map(([filepath, head, workdir]) => {
        if (head === 0 && workdir === 2) return {path: filepath, status: 'added' as const}
        if (head === 1 && workdir === 2) return {path: filepath, status: 'modified' as const}
        if (head === 1 && workdir === 0) return {path: filepath, status: 'deleted' as const}
        return null
      })
      .filter((f): f is GitStatusFile => f !== null)
    return {files, isClean: files.length === 0}
  }

  private getAuthor(): {email: string; name: string} {
    const token = this.authStateStore.getToken()
    return {
      email: token?.userEmail ?? 'agent@byterover.dev',
      name: token?.userEmail?.split('@')[0] ?? 'ByteRover Agent',
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
    if (!params.directory) throw new GitError('directory is required for git operations')
    return params.directory
  }

  private requireToken(): NonNullable<ReturnType<IAuthStateStore['getToken']>> {
    const token = this.authStateStore.getToken()
    if (!token) throw new GitAuthError()
    return token
  }

  private walkDir(rootDir: string, currentDir: string, result: GitConflict[]): void {
    const entries = fs.readdirSync(currentDir)
    for (const entry of entries) {
      if (entry === '.git') continue
      const fullPath = join(currentDir, entry)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        this.walkDir(rootDir, fullPath, result)
      } else if (stat.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          if (content.includes('<<<<<<<')) {
            const relativePath = fullPath.slice(rootDir.length + 1)
            result.push({path: relativePath, type: 'both_modified'})
          }
        } catch {
          // skip binary files or unreadable files
        }
      }
    }
  }
}
