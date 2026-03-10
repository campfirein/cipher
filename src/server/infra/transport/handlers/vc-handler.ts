import {join} from 'node:path'

import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {GitCommit, IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'
import type {IVcGitConfig, IVcGitConfigStore} from '../../../core/interfaces/vc/i-vc-git-config-store.js'

import {
  type IVcAddRequest,
  type IVcAddResponse,
  type IVcCommitRequest,
  type IVcCommitResponse,
  type IVcConfigRequest,
  type IVcConfigResponse,
  type IVcInitResponse,
  type IVcLogRequest,
  type IVcLogResponse,
  type IVcPushRequest,
  type IVcPushResponse,
  type IVcRemoteRequest,
  type IVcRemoteResponse,
  type IVcStatusResponse,
  VcErrorCode,
  VcEvents,
} from '../../../../shared/transport/events/vc-events.js'
import {GitAuthError} from '../../../core/domain/errors/git-error.js'
import {VcError} from '../../../core/domain/errors/vc-error.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

const FIELD_MAP: Record<string, 'email' | 'name'> = {
  'user.email': 'email',
  'user.name': 'name',
}

export interface IVcHandlerDeps {
  contextTreeService: IContextTreeService
  gitService: IGitService
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
  vcGitConfigStore: IVcGitConfigStore
}

/**
 * Handles vc:* events (Version Control commands).
 */
export class VcHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: IGitService
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer
  private readonly vcGitConfigStore: IVcGitConfigStore

  constructor(deps: IVcHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
    this.vcGitConfigStore = deps.vcGitConfigStore
  }

  setup(): void {
    this.transport.onRequest<IVcAddRequest, IVcAddResponse>(VcEvents.ADD, (data, clientId) =>
      this.handleAdd(data, clientId),
    )
    this.transport.onRequest<IVcCommitRequest, IVcCommitResponse>(VcEvents.COMMIT, (data, clientId) =>
      this.handleCommit(data, clientId),
    )
    this.transport.onRequest<IVcConfigRequest, IVcConfigResponse>(VcEvents.CONFIG, (data, clientId) =>
      this.handleConfig(data, clientId),
    )
    this.transport.onRequest<void, IVcInitResponse>(VcEvents.INIT, (_data, clientId) => this.handleInit(clientId))
    this.transport.onRequest<IVcLogRequest, IVcLogResponse>(VcEvents.LOG, (data, clientId) =>
      this.handleLog(data, clientId),
    )
    this.transport.onRequest<IVcPushRequest, IVcPushResponse>(VcEvents.PUSH, (data, clientId) =>
      this.handlePush(data, clientId),
    )
    this.transport.onRequest<IVcRemoteRequest, IVcRemoteResponse>(VcEvents.REMOTE, (data, clientId) =>
      this.handleRemote(data, clientId),
    )
    this.transport.onRequest<void, IVcStatusResponse>(VcEvents.STATUS, (_data, clientId) => this.handleStatus(clientId))
  }

  private async buildAuthorHint(existing?: IVcGitConfig): Promise<string> {
    try {
      const token = await this.tokenStore.load()
      if (token?.isValid()) {
        const email = existing?.email ?? token.userEmail
        const name = existing?.name ?? token.userEmail
        return `Run: brv vc config user.name "${name}" and brv vc config user.email "${email}".`
      }
    } catch {
      // not logged in
    }

    return 'Run: brv vc config user.name <value> and brv vc config user.email <value>.'
  }

  private async handleAdd(data: IVcAddRequest, clientId: string): Promise<IVcAddResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    await this.gitService.add({directory, filePaths: data.filePaths ?? ['.']})

    const statusAfter = await this.gitService.status({directory})
    const count = statusAfter.files.filter((f) => f.staged).length

    return {count}
  }

  private async handleCommit(data: IVcCommitRequest, clientId: string): Promise<IVcCommitResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const status = await this.gitService.status({directory})
    const hasStagedFiles = status.files.some((f) => f.staged)
    if (!hasStagedFiles) {
      throw new VcError('Nothing staged.', VcErrorCode.NOTHING_STAGED)
    }

    const config = await this.vcGitConfigStore.get(projectPath)
    if (!config?.name || !config.email) {
      const hint = await this.buildAuthorHint(config)
      throw new VcError(`Commit author not configured. ${hint}`, VcErrorCode.USER_NOT_CONFIGURED)
    }

    const commit = await this.gitService.commit({
      author: {email: config.email, name: config.name},
      directory,
      message: data.message,
    })

    return {message: commit.message, sha: commit.sha}
  }

  private async handleConfig(data: IVcConfigRequest, clientId: string): Promise<IVcConfigResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const field = FIELD_MAP[data.key]
    if (!field) {
      throw new VcError(`Unknown key '${data.key}'. Allowed: user.name, user.email.`, VcErrorCode.INVALID_CONFIG_KEY)
    }

    if (data.value !== undefined) {
      // SET: read existing → merge single field → write back
      const existing = (await this.vcGitConfigStore.get(projectPath)) ?? {}
      const merged = {...existing, [field]: data.value}
      await this.vcGitConfigStore.set(projectPath, merged)
      return {key: data.key, value: data.value}
    }

    // GET
    const config = await this.vcGitConfigStore.get(projectPath)
    const value = config?.[field]
    if (value === undefined) {
      throw new VcError(`'${data.key}' is not set.`, VcErrorCode.CONFIG_KEY_NOT_SET)
    }

    return {key: data.key, value}
  }

  private async handleInit(clientId: string): Promise<IVcInitResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    // 1. Ensure context tree directory exists
    const contextTreeDir = await this.contextTreeService.initialize(projectPath)

    // 2. Git init — always call (idempotent, like real `git init`).
    //    Check beforehand to determine whether this is a fresh init or a reinit.
    const reinitialized = await this.gitService.isInitialized({directory: contextTreeDir})
    await this.gitService.init({defaultBranch: 'main', directory: contextTreeDir})

    return {
      gitDir: join(contextTreeDir, '.git'),
      reinitialized,
    }
  }

  private async handleLog(data: IVcLogRequest, clientId: string): Promise<IVcLogResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory: contextTreeDir})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const {commits, displayBranch} = await this.resolveLogResult(data, contextTreeDir)

    return {
      commits: commits.map((c) => ({
        author: c.author,
        message: c.message,
        sha: c.sha,
        timestamp: c.timestamp.toISOString(),
      })),
      currentBranch: displayBranch,
    }
  }

  private async handlePush(data: IVcPushRequest, clientId: string): Promise<IVcPushResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const remotes = await this.gitService.listRemotes({directory})
    if (remotes.length === 0) {
      throw new VcError('No remote configured.', VcErrorCode.NO_REMOTE)
    }

    const commits = await this.gitService.log({depth: 1, directory})
    if (commits.length === 0) {
      throw new VcError('No commits to push. Run /vc add and /vc commit first.', VcErrorCode.NOTHING_TO_PUSH)
    }

    const branch = await this.resolveTargetBranch(data.branch, directory)

    try {
      const result = await this.gitService.push({branch, directory, remote: 'origin'})
      if (!result.success && result.reason === 'non_fast_forward') {
        throw new VcError('Remote has changes.', VcErrorCode.NON_FAST_FORWARD)
      }
    } catch (error) {
      if (error instanceof VcError) throw error
      if (error instanceof GitAuthError) {
        throw new VcError('Authentication failed. Run /login.', VcErrorCode.AUTH_FAILED)
      }

      throw new VcError('Push failed. Check your connection and try again.', VcErrorCode.PUSH_FAILED)
    }

    return {branch}
  }

  private async handleRemote(data: IVcRemoteRequest, clientId: string): Promise<IVcRemoteResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    if (data.subcommand === 'show') {
      const url = await this.gitService.getRemoteUrl({directory, remote: 'origin'})
      return {action: 'show', url: url ? maskCredentialsInUrl(url) : undefined}
    }

    if (!data.url) {
      throw new VcError('URL is required.', VcErrorCode.INVALID_REMOTE_URL)
    }

    if (data.subcommand === 'add') {
      const existing = await this.gitService.getRemoteUrl({directory, remote: 'origin'})
      if (existing) {
        throw new VcError(
          "Remote 'origin' already exists. Use /vc remote set-url <url> to update.",
          VcErrorCode.REMOTE_ALREADY_EXISTS,
        )
      }

      await this.gitService.addRemote({directory, remote: 'origin', url: data.url})
      return {action: 'add', url: data.url}
    }

    // set-url
    await this.gitService.removeRemote({directory, remote: 'origin'}).catch(() => {
      // ignore if remote doesn't exist
    })
    await this.gitService.addRemote({directory, remote: 'origin', url: data.url})
    return {action: 'set-url', url: data.url}
  }

  private async handleStatus(clientId: string): Promise<IVcStatusResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)
    const gitInitialized = await this.gitService.isInitialized({directory: contextTreeDir})
    if (!gitInitialized) {
      return {
        initialized: false,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      }
    }

    const branch = await this.gitService.getCurrentBranch({directory: contextTreeDir})
    const gitStatus = await this.gitService.status({directory: contextTreeDir})

    const staged = gitStatus.files.filter((f) => f.staged)
    const unstaged = gitStatus.files.filter((f) => !f.staged && f.status !== 'untracked')

    return {
      branch,
      initialized: true,
      staged: {
        added: staged.filter((f) => f.status === 'added').map((f) => f.path),
        deleted: staged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: staged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      unstaged: {
        deleted: unstaged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: unstaged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      untracked: gitStatus.files.filter((f) => f.status === 'untracked').map((f) => f.path),
    }
  }

  private async resolveLogResult(
    data: IVcLogRequest,
    contextTreeDir: string,
  ): Promise<{commits: GitCommit[]; displayBranch: string | undefined}> {
    const currentBranch = await this.gitService.getCurrentBranch({directory: contextTreeDir})

    const all = data.all ?? false
    const limit = data.limit ?? 10

    if (all) {
      const branches = await this.gitService.listBranches({directory: contextTreeDir})
      const commitsByBranch = await Promise.all(
        branches.map((branch) => this.gitService.log({directory: contextTreeDir, ref: branch.name})),
      )
      const seen = new Set<string>()
      const commits = commitsByBranch
        .flat()
        .filter((c) => {
          if (seen.has(c.sha)) return false
          seen.add(c.sha)
          return true
        })
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit)
      return {commits, displayBranch: currentBranch}
    }

    if (data.ref !== undefined) {
      const branches = await this.gitService.listBranches({directory: contextTreeDir})
      const branchExists = branches.some((b) => b.name === data.ref)
      if (!branchExists) {
        throw new VcError(`Branch '${data.ref}' not found.`, VcErrorCode.BRANCH_NOT_FOUND)
      }
    }

    const commits = await this.gitService.log({depth: limit, directory: contextTreeDir, ref: data.ref})
    return {commits, displayBranch: data.ref ?? currentBranch}
  }

  private async resolveTargetBranch(requestedBranch: string | undefined, directory: string): Promise<string> {
    const trimmed = requestedBranch?.trim()

    if (trimmed) {
      if (!isValidBranchName(trimmed)) {
        throw new VcError(`Invalid branch name: '${trimmed}'.`, VcErrorCode.INVALID_BRANCH_NAME)
      }

      return trimmed
    }

    const current = await this.gitService.getCurrentBranch({directory})
    const currentTrimmed = current?.trim()
    if (currentTrimmed) return currentTrimmed

    return 'main'
  }
}

function isValidBranchName(name: string): boolean {
  if (name.startsWith('-')) return false
  // eslint-disable-next-line no-control-regex
  return !/\.\.|[~^:?*[\\\u0000-\u001F\u007F]/.test(name)
}

function maskCredentialsInUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      parsed.password = '***'
    }

    return parsed.toString()
  } catch {
    return url
  }
}
