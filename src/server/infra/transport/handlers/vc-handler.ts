import {join} from 'node:path'

import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {GitCommit, IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'
import type {IVcGitConfig, IVcGitConfigStore} from '../../../core/interfaces/vc/i-vc-git-config-store.js'

import {
  type IVcAddRequest,
  type IVcAddResponse,
  type IVcBranchRequest,
  type IVcBranchResponse,
  type IVcCheckoutRequest,
  type IVcCheckoutResponse,
  type IVcCloneProgressEvent,
  type IVcCloneRequest,
  type IVcCloneResponse,
  type IVcCommitRequest,
  type IVcCommitResponse,
  type IVcConfigRequest,
  type IVcConfigResponse,
  type IVcInitResponse,
  type IVcLogRequest,
  type IVcLogResponse,
  type IVcPullRequest,
  type IVcPullResponse,
  type IVcPushRequest,
  type IVcPushResponse,
  type IVcRemoteRequest,
  type IVcRemoteResponse,
  type IVcStatusResponse,
  VcErrorCode,
  VcEvents,
} from '../../../../shared/transport/events/vc-events.js'
import {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import {Space} from '../../../core/domain/entities/space.js'
import {GitAuthError, GitError} from '../../../core/domain/errors/git-error.js'
import {NotAuthenticatedError} from '../../../core/domain/errors/task-error.js'
import {VcError} from '../../../core/domain/errors/vc-error.js'
import {buildCogitRemoteUrl} from '../../git/cogit-url.js'
import {type ProjectBroadcaster, type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

const FIELD_MAP: Record<string, 'email' | 'name'> = {
  'user.email': 'email',
  'user.name': 'name',
}

export interface IVcHandlerDeps {
  broadcastToProject: ProjectBroadcaster
  cogitGitBaseUrl: string
  contextTreeService: IContextTreeService
  gitService: IGitService
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
  vcGitConfigStore: IVcGitConfigStore
}

/**
 * Handles vc:* events (Version Control commands).
 */
export class VcHandler {
  private readonly broadcastToProject: ProjectBroadcaster
  private readonly cogitGitBaseUrl: string
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: IGitService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer
  private readonly vcGitConfigStore: IVcGitConfigStore

  constructor(deps: IVcHandlerDeps) {
    this.broadcastToProject = deps.broadcastToProject
    this.cogitGitBaseUrl = deps.cogitGitBaseUrl
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
    this.vcGitConfigStore = deps.vcGitConfigStore
  }

  setup(): void {
    this.transport.onRequest<IVcBranchRequest, IVcBranchResponse>(VcEvents.BRANCH, (data, clientId) =>
      this.handleBranch(data, clientId),
    )
    this.transport.onRequest<IVcCheckoutRequest, IVcCheckoutResponse>(VcEvents.CHECKOUT, (data, clientId) =>
      this.handleCheckout(data, clientId),
    )
    this.transport.onRequest<IVcCloneRequest, IVcCloneResponse>(VcEvents.CLONE, (data, clientId) =>
      this.handleClone(data, clientId),
    )
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
    this.transport.onRequest<IVcPullRequest, IVcPullResponse>(VcEvents.PULL, (data, clientId) =>
      this.handlePull(data, clientId),
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
        const name = existing?.name ?? token.userName ?? token.userEmail
        return `Run: brv vc config user.name '${name}' and brv vc config user.email '${email}'.`
      }
    } catch {
      // not logged in
    }

    return 'Run: brv vc config user.name <value> and brv vc config user.email <value>.'
  }

  /**
   * When force is NOT set, checks for uncommitted changes and throws
   * VcError(UNCOMMITTED_CHANGES) if the working tree is dirty.
   * When force IS set, skips the check entirely (changes will be discarded).
   */
  private async guardUncommittedChanges(force: boolean | undefined, directory: string): Promise<void> {
    if (force) return

    const status = await this.gitService.status({directory})
    const hasTrackedChanges = status.files.some((f) => f.status !== 'untracked')
    if (hasTrackedChanges) {
      throw new VcError(
        'You have uncommitted changes that would be overwritten. Commit your changes or use --force to discard them.',
        VcErrorCode.UNCOMMITTED_CHANGES,
      )
    }
  }

  private async handleAdd(data: IVcAddRequest, clientId: string): Promise<IVcAddResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const statusBefore = await this.gitService.status({directory})
    const stagedBefore = new Set(statusBefore.files.filter((f) => f.staged).map((f) => f.path))
    const hadUnstagedBefore = new Set(statusBefore.files.filter((f) => !f.staged).map((f) => f.path))

    await this.gitService.add({directory, filePaths: data.filePaths ?? ['.']})

    const statusAfter = await this.gitService.status({directory})
    const count = statusAfter.files.filter(
      (f) => f.staged && (!stagedBefore.has(f.path) || hadUnstagedBefore.has(f.path)),
    ).length

    return {count}
  }

  private async handleBranch(data: IVcBranchRequest, clientId: string): Promise<IVcBranchResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    if (data.action === 'list') return this.handleBranchList(directory, data.all)

    // Runtime guard: `name` is guaranteed by the discriminated union at compile time,
    // but transport payloads are untrusted — validate at the boundary.
    if (data.action === 'create' || data.action === 'delete') {
      if (!data.name) throw new VcError('Branch name is required.', VcErrorCode.INVALID_BRANCH_NAME)
      if (data.action === 'create') return this.handleBranchCreate(directory, data.name)
      return this.handleBranchDelete(directory, data.name)
    }

    throw new VcError(`Unknown branch action.`, VcErrorCode.INVALID_ACTION)
  }

  private async handleBranchCreate(directory: string, name: string): Promise<IVcBranchResponse> {
    if (!isValidBranchName(name)) {
      throw new VcError(`Invalid branch name: '${name}'.`, VcErrorCode.INVALID_BRANCH_NAME)
    }

    const existing = await this.gitService.listBranches({directory})
    if (existing.some((b) => b.name === name)) {
      throw new VcError(`Branch '${name}' already exists.`, VcErrorCode.BRANCH_ALREADY_EXISTS)
    }

    await this.gitService.createBranch({branch: name, directory})
    return {action: 'create', created: name}
  }

  private async handleBranchDelete(directory: string, name: string): Promise<IVcBranchResponse> {
    const current = await this.gitService.getCurrentBranch({directory})
    if (name === current) {
      throw new VcError(`Cannot delete current branch '${name}'.`, VcErrorCode.CANNOT_DELETE_CURRENT_BRANCH)
    }

    const localBranches = await this.gitService.listBranches({directory})
    if (!localBranches.some((b) => b.name === name)) {
      throw new VcError(`Branch '${name}' not found.`, VcErrorCode.BRANCH_NOT_FOUND)
    }

    await this.gitService.deleteBranch({branch: name, directory})
    return {action: 'delete', deleted: name}
  }

  private async handleBranchList(directory: string, all?: boolean): Promise<IVcBranchResponse> {
    const branches = await this.gitService.listBranches({
      directory,
      remote: all ? 'origin' : undefined,
    })
    return {
      action: 'list',
      branches: branches.map((b) => ({
        isCurrent: b.isCurrent,
        isRemote: b.isRemote,
        name: b.name,
      })),
    }
  }

  private async handleCheckout(data: IVcCheckoutRequest, clientId: string): Promise<IVcCheckoutResponse> {
    // ── Phase 1: Resolve project and validate inputs ──
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    this.validateBranchName(data.branch)

    // ── Phase 2: Safety checks ──
    const previousBranch = await this.gitService.getCurrentBranch({directory})
    await this.guardUncommittedChanges(data.force, directory)

    // ── Phase 3: Create or switch ──
    if (data.create) {
      const branches = await this.gitService.listBranches({directory})
      if (branches.some((b) => b.name === data.branch)) {
        throw new VcError(`Branch '${data.branch}' already exists.`, VcErrorCode.BRANCH_ALREADY_EXISTS)
      }

      await this.gitService.createBranch({branch: data.branch, checkout: true, directory})
      return {branch: data.branch, created: true, previousBranch}
    }

    try {
      await this.gitService.checkout({directory, force: data.force, ref: data.branch})
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'NotFoundError') {
        throw new VcError(
          `Branch '${data.branch}' not found. Use 'brv vc checkout -b ${data.branch}' to create it.`,
          VcErrorCode.BRANCH_NOT_FOUND,
        )
      }

      throw error
    }

    return {branch: data.branch, created: false, previousBranch}
  }

  private async handleClone(data: IVcCloneRequest, clientId: string): Promise<IVcCloneResponse> {
    const token = await this.tokenStore.load()
    if (!token?.isValid()) throw new NotAuthenticatedError()

    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)

    if (await this.gitService.isInitialized({directory: contextTreeDir})) {
      throw new VcError('Already initialized. Use /vc pull to sync.', VcErrorCode.ALREADY_INITIALIZED)
    }

    const url = buildCogitRemoteUrl(this.cogitGitBaseUrl, data.teamId, data.spaceId)

    try {
      await this.contextTreeService.initialize(projectPath)

      this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
        message: `Cloning from ${data.teamName}/${data.spaceName}...`,
        step: 'cloning',
      })

      await this.gitService.clone({
        directory: contextTreeDir,
        onProgress: ({loaded, phase, total}) => {
          this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
            message: `${phase}: ${loaded}${total === undefined ? '' : `/${total}`}`,
            step: 'cloning',
          })
        },
        url,
      })

      this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
        message: 'Saving configuration...',
        step: 'saving',
      })

      const space = new Space({
        id: data.spaceId,
        isDefault: false,
        name: data.spaceName,
        teamId: data.teamId,
        teamName: data.teamName,
      })
      const existing = await this.projectConfigStore.read(projectPath)
      const updated = existing ? existing.withSpace(space) : BrvConfig.partialFromSpace({space})
      await this.projectConfigStore.write(updated, projectPath)
    } catch (error) {
      if (error instanceof GitAuthError) {
        throw new VcError('Authentication failed. Run /login.', VcErrorCode.AUTH_FAILED)
      }

      const msg = error instanceof Error ? error.message : String(error)
      throw new VcError(`Clone failed: ${msg}`, VcErrorCode.CLONE_FAILED)
    }

    return {
      gitDir: join(contextTreeDir, '.git'),
      spaceName: data.spaceName,
      teamName: data.teamName,
    }
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

  private async handlePull(_data: IVcPullRequest, clientId: string): Promise<IVcPullResponse> {
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

    const branch = await this.resolvePullBranch(directory)

    let alreadyUpToDate = false
    try {
      const result = await this.gitService.pull({branch, directory, remote: 'origin'})
      if (!result.success) {
        const paths = result.conflicts.map((c) => c.path).join(', ')
        throw new VcError(`Merge conflicts in: ${paths}`, VcErrorCode.MERGE_CONFLICT)
      }

      alreadyUpToDate = result.alreadyUpToDate ?? false
    } catch (error) {
      if (error instanceof VcError) throw error
      if (error instanceof GitAuthError) {
        throw new VcError('Authentication failed. Run /login.', VcErrorCode.AUTH_FAILED)
      }

      if (error instanceof GitError) {
        throw new VcError(error.message, VcErrorCode.PULL_FAILED)
      }

      const message = error instanceof Error ? error.message : 'Pull failed. Check your connection and try again.'
      throw new VcError(message, VcErrorCode.PULL_FAILED)
    }

    return {alreadyUpToDate, branch}
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

    // Block push when no upstream tracking and no explicit branch — like git:
    //   git push           → error if no tracking
    //   git push origin X  → OK without tracking (explicit target)
    //   git push -u        → OK (will set tracking)
    const explicitBranch = Boolean(data.branch?.trim())
    const existingTracking = await this.gitService.getTrackingBranch({branch, directory})
    if (!existingTracking && !explicitBranch && !data.setUpstream) {
      throw new VcError(
        `The current branch '${branch}' has no upstream branch.\n` +
          `To push the current branch and set the remote as upstream, use\n\n` +
          `    brv vc push -u origin ${branch}`,
        VcErrorCode.NO_UPSTREAM,
      )
    }

    let alreadyUpToDate = false
    try {
      const result = await this.gitService.push({branch, directory, remote: 'origin'})
      if (!result.success && result.reason === 'non_fast_forward') {
        throw new VcError('Remote has changes. Pull first with /vc pull.', VcErrorCode.NON_FAST_FORWARD)
      }

      if (result.success) alreadyUpToDate = result.alreadyUpToDate ?? false
    } catch (error) {
      if (error instanceof VcError) throw error
      if (error instanceof GitAuthError) {
        throw new VcError('Authentication failed. Run /login.', VcErrorCode.AUTH_FAILED)
      }

      const message = error instanceof Error ? error.message : 'Push failed. Check your connection and try again.'
      throw new VcError(message, VcErrorCode.PUSH_FAILED)
    }

    // Set upstream tracking after successful push
    let upstreamSet = false
    if (data.setUpstream) {
      await this.gitService.setTrackingBranch({branch, directory, remote: 'origin', remoteBranch: branch})
      upstreamSet = true
    }

    return {alreadyUpToDate, branch, upstreamSet}
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

    // Resolve tracking branch and ahead/behind counts
    let trackingBranch: string | undefined
    let ahead: number | undefined
    let behind: number | undefined
    if (branch) {
      const tracking = await this.gitService.getTrackingBranch({branch, directory: contextTreeDir})
      if (tracking) {
        trackingBranch = `${tracking.remote}/${tracking.remoteBranch}`
        const counts = await this.gitService.getAheadBehind({
          directory: contextTreeDir,
          localRef: `refs/heads/${branch}`,
          remoteRef: `refs/remotes/${tracking.remote}/${tracking.remoteBranch}`,
        })
        ahead = counts.ahead
        behind = counts.behind
      }
    }

    return {
      ahead,
      behind,
      branch,
      initialized: true,
      staged: {
        added: staged.filter((f) => f.status === 'added').map((f) => f.path),
        deleted: staged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: staged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      trackingBranch,
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

  /**
   * Resolves pull target branch: explicit → tracking config → error.
   * Mirrors native git: `git pull` without tracking config errors.
   */
  private async resolvePullBranch(directory: string): Promise<string> {
    const current = await this.gitService.getCurrentBranch({directory})
    const currentTrimmed = current?.trim()
    if (currentTrimmed) {
      const tracking = await this.gitService.getTrackingBranch({branch: currentTrimmed, directory})
      if (tracking) return tracking.remoteBranch

      // No tracking configured — error like native git
      throw new VcError(
        `There is no tracking information for the current branch '${currentTrimmed}'.\n` +
          `To set upstream tracking, use:\n\n` +
          `    brv vc push -u origin ${currentTrimmed}`,
        VcErrorCode.NO_UPSTREAM,
      )
    }

    throw new VcError('Cannot determine branch for pull. Check out a branch first.', VcErrorCode.PULL_FAILED)
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

  /**
   * Validates that branch name is non-empty and well-formed.
   * Throws VcError(INVALID_BRANCH_NAME) on failure.
   */
  private validateBranchName(branch: string): void {
    if (!branch) {
      throw new VcError('Branch name is required.', VcErrorCode.INVALID_BRANCH_NAME)
    }

    if (!isValidBranchName(branch)) {
      throw new VcError(`Invalid branch name: '${branch}'.`, VcErrorCode.INVALID_BRANCH_NAME)
    }
  }
}

function isValidBranchName(name: string): boolean {
  if (!name) return false
  if (name.startsWith('-') || name.startsWith('.') || name.startsWith('/')) return false
  if (name.endsWith('.lock') || name.endsWith('/') || name.endsWith('.')) return false
  if (name.includes('//') || name.includes('@{') || name.includes(' ')) return false
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
