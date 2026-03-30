import fs from 'node:fs'
import {join} from 'node:path'

import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {GitCommit, IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {ISpaceService} from '../../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../core/interfaces/services/i-team-service.js'
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
  type IVcConflictsResponse,
  type IVcFetchRequest,
  type IVcFetchResponse,
  type IVcInitResponse,
  type IVcLogRequest,
  type IVcLogResponse,
  type IVcMergeRequest,
  type IVcMergeResponse,
  type IVcPullRequest,
  type IVcPullResponse,
  type IVcPushRequest,
  type IVcPushResponse,
  type IVcRemoteRequest,
  type IVcRemoteResponse,
  type IVcRemoteUrlRequest,
  type IVcRemoteUrlResponse,
  type IVcResetRequest,
  type IVcResetResponse,
  type IVcStatusResponse,
  VcErrorCode,
  VcEvents,
  type VcResetMode,
} from '../../../../shared/transport/events/vc-events.js'
import {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import {Space} from '../../../core/domain/entities/space.js'
import {GitAuthError, GitError} from '../../../core/domain/errors/git-error.js'
import {NotAuthenticatedError} from '../../../core/domain/errors/task-error.js'
import {VcError} from '../../../core/domain/errors/vc-error.js'
import {buildCogitRemoteUrl, isValidBranchName, parseBrvUrl, parseGitPathUrl} from '../../git/cogit-url.js'
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
  spaceService: ISpaceService
  teamService: ITeamService
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
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
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
    this.spaceService = deps.spaceService
    this.teamService = deps.teamService
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
    this.transport.onRequest<void, IVcConflictsResponse>(VcEvents.CONFLICTS, (_data, clientId) =>
      this.handleConflicts(clientId),
    )
    this.transport.onRequest<IVcConfigRequest, IVcConfigResponse>(VcEvents.CONFIG, (data, clientId) =>
      this.handleConfig(data, clientId),
    )
    this.transport.onRequest<IVcFetchRequest, IVcFetchResponse>(VcEvents.FETCH, (data, clientId) =>
      this.handleFetch(data, clientId),
    )
    this.transport.onRequest<void, IVcInitResponse>(VcEvents.INIT, (_data, clientId) => this.handleInit(clientId))
    this.transport.onRequest<IVcLogRequest, IVcLogResponse>(VcEvents.LOG, (data, clientId) =>
      this.handleLog(data, clientId),
    )
    this.transport.onRequest<IVcMergeRequest, IVcMergeResponse>(VcEvents.MERGE, (data, clientId) =>
      this.handleMerge(data, clientId),
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

    this.transport.onRequest<IVcRemoteUrlRequest, IVcRemoteUrlResponse>(VcEvents.REMOTE_URL, (data) =>
      this.handleRemoteUrl(data),
    )
    this.transport.onRequest<IVcResetRequest, IVcResetResponse>(VcEvents.RESET, (data, clientId) =>
      this.handleReset(data, clientId),
    )

    this.transport.onRequest<void, IVcStatusResponse>(VcEvents.STATUS, (_data, clientId) => this.handleStatus(clientId))
  }

  private async buildAuthorHint(existing?: IVcGitConfig): Promise<string> {
    try {
      const token = await this.tokenStore.load()
      if (token?.isValid()) {
        const email = existing?.email ?? token.userEmail
        const name = existing?.name ?? token.userName ?? token.userEmail
        return `Run: /vc config user.name '${name}' and /vc config user.email '${email}'.`
      }
    } catch {
      // not logged in
    }

    return 'Run: /vc config user.name <value> and /vc config user.email <value>.'
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

    if (data.action === 'set-upstream') {
      return this.handleBranchSetUpstream(directory, data.upstream)
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

    // Block branch creation on empty repo (no commits yet) — matches native git behavior
    const commits = await this.gitService.log({depth: 1, directory})
    if (commits.length === 0) {
      throw new VcError('You must make an initial commit before creating branches.', VcErrorCode.NO_COMMITS)
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

    // Safe delete: verify branch is fully merged into current branch
    if (current) {
      const isMerged = await this.gitService.isAncestor({
        ancestor: `refs/heads/${name}`,
        commit: `refs/heads/${current}`,
        directory,
      })
      if (!isMerged) {
        throw new VcError(
          `The branch '${name}' is not fully merged.`,
          VcErrorCode.BRANCH_NOT_MERGED,
        )
      }
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

  private async handleBranchSetUpstream(directory: string, upstream: string): Promise<IVcBranchResponse> {
    const slashIndex = upstream.indexOf('/')
    if (slashIndex <= 0) {
      throw new VcError(
        `Invalid upstream format '${upstream}'. Expected <remote>/<branch> (e.g. origin/main).`,
        VcErrorCode.INVALID_BRANCH_NAME,
      )
    }

    const remote = upstream.slice(0, slashIndex)
    const remoteBranch = upstream.slice(slashIndex + 1)
    if (!remoteBranch) {
      throw new VcError(
        `Invalid upstream format '${upstream}'. Expected <remote>/<branch> (e.g. origin/main).`,
        VcErrorCode.INVALID_BRANCH_NAME,
      )
    }

    const currentBranch = await this.gitService.getCurrentBranch({directory})
    if (!currentBranch) {
      throw new VcError('Cannot set upstream in detached HEAD state.', VcErrorCode.INVALID_BRANCH_NAME)
    }

    // Validate the remote exists
    const remotes = await this.gitService.listRemotes({directory})
    if (!remotes.some((r) => r.remote === remote)) {
      throw new VcError(`Remote '${remote}' not found.`, VcErrorCode.NO_REMOTE)
    }

    // Validate the remote-tracking branch exists
    const remoteBranches = await this.gitService.listBranches({directory, remote})
    if (!remoteBranches.some((b) => b.isRemote && b.name === remoteBranch)) {
      throw new VcError(
        `The requested upstream branch '${upstream}' does not exist.`,
        VcErrorCode.BRANCH_NOT_FOUND,
      )
    }

    await this.gitService.setTrackingBranch({branch: currentBranch, directory, remote, remoteBranch})
    return {action: 'set-upstream', branch: currentBranch, upstream}
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
        // Distinguish empty repo from branch-not-found
        const commits = await this.gitService.log({depth: 1, directory})
        if (commits.length === 0) {
          throw new VcError(
            `Your current branch does not have any commits yet. Run '/vc add' and '/vc commit' first.`,
            VcErrorCode.NO_COMMITS,
          )
        }

        throw new VcError(
          `Branch '${data.branch}' not found. Use '/vc checkout -b ${data.branch}' to create it.`,
          VcErrorCode.BRANCH_NOT_FOUND,
        )
      }

      throw error
    }

    return {branch: data.branch, created: false, previousBranch}
  }

  private async handleClone(data: IVcCloneRequest, clientId: string): Promise<IVcCloneResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)

    if (await this.gitService.isInitialized({directory: contextTreeDir})) {
      throw new VcError('Already initialized. Use /vc pull to sync.', VcErrorCode.ALREADY_INITIALIZED)
    }

    const {spaceId, spaceName, teamId, teamName, url: cloneUrl} = await this.resolveCloneInput(data)
    const label = teamName && spaceName ? `${teamName}/${spaceName}` : 'repository'

    try {
      await this.contextTreeService.initialize(projectPath)

      this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
        message: `Remote: ${cloneUrl}`,
        step: 'cloning',
      })
      this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
        message: `Cloning from ${label}...`,
        step: 'cloning',
      })

      let lastPhase = ''
      await this.gitService.clone({
        directory: contextTreeDir,
        onProgress: ({phase, total}) => {
          if (phase !== lastPhase) {
            lastPhase = phase
            const totalStr = total === undefined ? '' : ` (${total})`
            this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
              message: `${phase}${totalStr}...`,
              step: 'cloning',
            })
          }
        },
        url: cloneUrl,
      })

      this.broadcastToProject<IVcCloneProgressEvent>(projectPath, VcEvents.CLONE_PROGRESS, {
        message: 'Saving configuration...',
        step: 'saving',
      })

      if (spaceId && spaceName && teamId && teamName) {
        const space = new Space({
          id: spaceId,
          isDefault: false,
          name: spaceName,
          teamId,
          teamName,
        })
        const existing = await this.projectConfigStore.read(projectPath)
        const updated = existing ? existing.withSpace(space) : BrvConfig.partialFromSpace({space})
        await this.projectConfigStore.write(updated, projectPath)
      }
    } catch (error) {
      // Rollback partial .git — keep context tree intact
      await fs.promises.rm(join(contextTreeDir, '.git'), {force: true, recursive: true}).catch(() => {})

      if (error instanceof GitAuthError) {
        throw new VcError('Authentication failed. Run /login.', VcErrorCode.AUTH_FAILED)
      }

      const msg = error instanceof Error ? error.message : String(error)
      throw new VcError(`Clone failed: ${msg}`, VcErrorCode.CLONE_FAILED)
    }

    return {
      gitDir: join(contextTreeDir, '.git'),
      spaceName,
      teamName,
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

  private async handleConflicts(clientId: string): Promise<IVcConflictsResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const [markerFiles, indexConflicts] = await Promise.all([
      this.gitService.getFilesWithConflictMarkers({directory}),
      this.gitService.getConflicts({directory}),
    ])

    // Merge both sources, deduplicating by path
    const markerPaths = new Set(markerFiles)
    const allPaths = new Set([...indexConflicts.map((c) => c.path), ...markerFiles])
    const files = [...allPaths].sort()

    // Include structured conflict info for paths not already covered by markers
    const conflicts = indexConflicts
      .filter((c) => !markerPaths.has(c.path))
      .map((c) => ({path: c.path, type: c.type}))

    return {
      ...(conflicts.length > 0 ? {conflicts} : {}),
      files,
    }
  }

  private async handleFetch(data: IVcFetchRequest, clientId: string): Promise<IVcFetchResponse> {
    const token = await this.tokenStore.load()
    if (!token?.isValid()) throw new NotAuthenticatedError()

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

    const remote = data.remote ?? 'origin'
    try {
      await this.gitService.fetch({directory, ref: data.ref, remote})
    } catch (error) {
      if (error instanceof GitAuthError) {
        throw new VcError('Authentication failed. Run /login.', VcErrorCode.AUTH_FAILED)
      }

      const message = error instanceof Error ? error.message : 'Fetch failed.'
      throw new VcError(message, VcErrorCode.FETCH_FAILED)
    }

    return {remote}
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

    const hasCommits = await this.gitService
      .log({depth: 1, directory: contextTreeDir})
      .then((c) => c.length > 0)
    if (!hasCommits) {
      const branch = await this.gitService.getCurrentBranch({directory: contextTreeDir})
      throw new VcError(
        `Your current branch '${branch ?? 'main'}' does not have any commits yet.`,
        VcErrorCode.NO_COMMITS,
      )
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

  private async handleMerge(data: IVcMergeRequest, clientId: string): Promise<IVcMergeResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const mergeHeadPath = join(directory, '.git', 'MERGE_HEAD')
    const mergeMsgPath = join(directory, '.git', 'MERGE_MSG')
    const hasMergeHead = await fs.promises
      .access(mergeHeadPath)
      .then(() => true)
      .catch(() => false)

    if (data.action === 'abort') {
      if (!hasMergeHead) {
        throw new VcError('There is no merge to abort (MERGE_HEAD missing).', VcErrorCode.NO_MERGE_IN_PROGRESS)
      }

      await this.gitService.abortMerge({directory})
      return {action: 'abort'}
    }

    if (data.action === 'continue') {
      if (!hasMergeHead) {
        throw new VcError('There is no merge in progress (MERGE_HEAD missing).', VcErrorCode.NO_MERGE_IN_PROGRESS)
      }

      if (!data.message) {
        // Return default message so oclif can open editor; TUI uses it directly
        const defaultMessage = await fs.promises
          .readFile(mergeMsgPath, 'utf8')
          .then((content) => content.trim())
          .catch(() => 'Merge commit')
        return {action: 'continue', defaultMessage}
      }

      // Check for unresolved conflicts before committing
      const conflicts = await this.gitService.getConflicts({directory})
      if (conflicts.length > 0) {
        throw new VcError('Committing is not possible because you have unmerged files.', VcErrorCode.MERGE_CONFLICT)
      }

      const config = await this.vcGitConfigStore.get(projectPath)
      if (!config?.name || !config.email) {
        const hint = await this.buildAuthorHint(config)
        throw new VcError(`Commit author not configured. ${hint}`, VcErrorCode.USER_NOT_CONFIGURED)
      }

      await this.gitService.commit({
        author: {email: config.email, name: config.name},
        directory,
        message: data.message,
      })
      return {action: 'continue'}
    }

    // action: 'merge'
    if (!data.branch) {
      throw new VcError('Branch name is required for merge.', VcErrorCode.INVALID_BRANCH_NAME)
    }

    if (!isValidBranchName(data.branch)) {
      throw new VcError(`Invalid branch name: '${data.branch}'.`, VcErrorCode.INVALID_BRANCH_NAME)
    }

    const config = await this.vcGitConfigStore.get(projectPath)
    if (!config?.name || !config.email) {
      const hint = await this.buildAuthorHint(config)
      throw new VcError(`Commit author not configured. ${hint}`, VcErrorCode.USER_NOT_CONFIGURED)
    }

    if (hasMergeHead) {
      throw new VcError('You have not concluded your merge (MERGE_HEAD exists).', VcErrorCode.MERGE_IN_PROGRESS)
    }

    await this.guardUncommittedChanges(false, directory)

    // Self-merge check
    const currentBranch = await this.gitService.getCurrentBranch({directory})
    if (currentBranch && data.branch === currentBranch) {
      return {action: 'merge', alreadyUpToDate: true, branch: data.branch}
    }

    // Validate branch exists (check both local and remote-tracking branches)
    const branches = await this.gitService.listBranches({directory, remote: 'origin'})
    if (!branches.some((b) => b.name === data.branch)) {
      throw new VcError(`merge: ${data.branch} - not something we can merge`, VcErrorCode.BRANCH_NOT_FOUND)
    }

    const result = await this.gitService.merge({
      allowUnrelatedHistories: data.allowUnrelatedHistories,
      author: {email: config.email, name: config.name},
      branch: data.branch,
      directory,
      message: data.message,
    })

    if (!result.success) {
      return {
        action: 'merge',
        branch: data.branch,
        conflicts: result.conflicts.map((c) => ({path: c.path, type: c.type})),
      }
    }

    if (result.alreadyUpToDate) {
      return {action: 'merge', alreadyUpToDate: true, branch: data.branch}
    }

    return {action: 'merge', branch: data.branch}
  }

  private async handlePull(data: IVcPullRequest, clientId: string): Promise<IVcPullResponse> {
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

    // Soft resolve author: use vc config if available, otherwise let pull() fallback to getAuthor() from auth token.
    // Unlike commit/merge, pull only needs author when creating a merge commit (not for up-to-date or fast-forward).
    const config = await this.vcGitConfigStore.get(projectPath)
    const author = config?.name && config?.email ? {email: config.email, name: config.name} : undefined

    // If explicit branch provided, use it directly (skip tracking resolution)
    const remote = data?.remote ?? 'origin'
    const branch = data?.branch ?? (await this.resolvePullBranch(directory))

    let alreadyUpToDate = false
    let conflicts: Array<{path: string; type: string}> | undefined
    try {
      const result = await this.gitService.pull({
        allowUnrelatedHistories: data?.allowUnrelatedHistories,
        author,
        branch,
        directory,
        remote,
      })
      if (!result.success) {
        conflicts = result.conflicts.map((c) => ({path: c.path, type: c.type}))
        return {branch, conflicts}
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

    // Block push while conflict markers remain in tracked files
    const conflictFiles = await this.gitService.getFilesWithConflictMarkers({directory})
    if (conflictFiles.length > 0) {
      throw new VcError(
        `Conflict markers detected in: ${conflictFiles.join(', ')}. Resolve conflicts before pushing.`,
        VcErrorCode.CONFLICT_MARKERS_PRESENT,
      )
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
          `    /vc push -u origin ${branch}`,
        VcErrorCode.NO_UPSTREAM,
      )
    }

    // Set upstream tracking BEFORE push so pull works even if push fails with non_fast_forward
    let upstreamSet = false
    if (data.setUpstream) {
      await this.gitService.setTrackingBranch({branch, directory, remote: 'origin', remoteBranch: branch})
      upstreamSet = true
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

    const resolved = await this.resolveFullCogitUrl(data.url)

    if (data.subcommand === 'add') {
      const existing = await this.gitService.getRemoteUrl({directory, remote: 'origin'})
      if (existing) {
        throw new VcError(
          "Remote 'origin' already exists. Use /vc remote set-url <url> to update.",
          VcErrorCode.REMOTE_ALREADY_EXISTS,
        )
      }

      await this.gitService.addRemote({directory, remote: 'origin', url: resolved.url})
      return {action: 'add', url: resolved.url}
    }

    // set-url
    await this.gitService.removeRemote({directory, remote: 'origin'}).catch(() => {
      // ignore if remote doesn't exist
    })
    await this.gitService.addRemote({directory, remote: 'origin', url: resolved.url})
    return {action: 'set-url', url: resolved.url}
  }

  private async handleRemoteUrl(data: IVcRemoteUrlRequest): Promise<IVcRemoteUrlResponse> {
    const token = await this.tokenStore.load()
    if (!token?.isValid()) throw new NotAuthenticatedError()

    const url = buildCogitRemoteUrl(this.cogitGitBaseUrl, data.teamId, data.spaceId)
    // Embed credentials for external git tool usage (this is the only place credentials go into a URL)
    const parsed = new URL(url)
    parsed.username = token.userId
    parsed.password = token.sessionKey
    return {url: parsed.toString()}
  }

  private async handleReset(data: IVcResetRequest, clientId: string): Promise<IVcResetResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const directory = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory})
    if (!gitInitialized) {
      throw new VcError('ByteRover version control not initialized.', VcErrorCode.GIT_NOT_INITIALIZED)
    }

    const mode: VcResetMode = data.filePaths ? 'mixed' : (data.mode ?? 'mixed')

    // Block soft/hard reset during active merge
    if (mode !== 'mixed' || (data.ref && data.ref !== 'HEAD')) {
      const hasMergeHead = await fs.promises
        .access(join(directory, '.git', 'MERGE_HEAD'))
        .then(() => true)
        .catch(() => false)

      if (hasMergeHead && mode !== 'hard') {
        throw new VcError(
          'Cannot reset while a merge is in progress. Abort or complete the merge first.',
          VcErrorCode.MERGE_IN_PROGRESS,
        )
      }
    }

    try {
      const result = await this.gitService.reset({
        directory,
        filePaths: data.filePaths,
        mode: data.filePaths ? undefined : mode,
        ref: data.ref,
      })

      const isUnstage = Boolean(data.filePaths) || (mode === 'mixed' && (!data.ref || data.ref === 'HEAD'))

      return {
        filesUnstaged: isUnstage ? result.filesChanged : undefined,
        headSha: isUnstage ? undefined : result.headSha,
        mode,
      }
    } catch (error) {
      if (error instanceof GitError) {
        if (error.message.includes('pathspec')) {
          throw new VcError(error.message, VcErrorCode.FILE_NOT_FOUND)
        }

        if (error.message.includes('Cannot resolve')) {
          throw new VcError(error.message, VcErrorCode.INVALID_REF)
        }

        if (error.message.includes('detached HEAD')) {
          throw new VcError(error.message, VcErrorCode.INVALID_ACTION)
        }

        if (error.message.includes('No commits')) {
          throw new VcError(error.message, VcErrorCode.NO_COMMITS)
        }
      }

      throw error
    }
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

    // Detect empty repo (no commits yet)
    const hasCommits = await this.gitService
      .log({depth: 1, directory: contextTreeDir})
      .then((commits) => commits.length > 0)

    // Check if a merge is in progress (MERGE_HEAD exists)
    const mergeInProgress = await fs.promises
      .access(join(contextTreeDir, '.git', 'MERGE_HEAD'))
      .then(() => true)
      .catch(() => false)

    // Detect unresolved conflicts during merge
    const unmerged = mergeInProgress
      ? (await this.gitService.getConflicts({directory: contextTreeDir})).map((c) => ({path: c.path, type: c.type}))
      : undefined

    // Detect files with conflict markers (regardless of merge state)
    const conflictMarkerFiles = await this.gitService.getFilesWithConflictMarkers({directory: contextTreeDir})

    // Filter out unmerged paths from staged/unstaged — git native only shows them in "Unmerged paths" section
    const unmergedPaths = unmerged ? new Set(unmerged.map((u) => u.path)) : new Set<string>()
    const staged = gitStatus.files.filter((f) => f.staged && !unmergedPaths.has(f.path))
    const unstaged = gitStatus.files.filter((f) => !f.staged && f.status !== 'untracked' && !unmergedPaths.has(f.path))

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
      conflictMarkerFiles: conflictMarkerFiles.length > 0 ? conflictMarkerFiles : undefined,
      hasCommits,
      initialized: true,
      mergeInProgress,
      staged: {
        added: staged.filter((f) => f.status === 'added').map((f) => f.path),
        deleted: staged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: staged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      trackingBranch,
      unmerged,
      unstaged: {
        deleted: unstaged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: unstaged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      untracked: gitStatus.files.filter((f) => f.status === 'untracked').map((f) => f.path),
    }
  }

  /**
   * Resolve clone request data into a clean cogit URL + team/space info.
   * Accepts either a URL (any format) or explicit teamId/spaceId.
   * Auth is handled by IsomorphicGitService via headers, not URL credentials.
   */
  private async resolveCloneInput(data: IVcCloneRequest): Promise<{
    spaceId?: string
    spaceName?: string
    teamId?: string
    teamName?: string
    url: string
  }> {
    if (data.url) {
      const resolved = await this.resolveFullCogitUrl(data.url)
      return {
        spaceId: resolved.spaceId ?? data.spaceId,
        spaceName: resolved.spaceName ?? data.spaceName,
        teamId: resolved.teamId ?? data.teamId,
        teamName: resolved.teamName ?? data.teamName,
        url: resolved.url,
      }
    }

    if (data.teamId && data.spaceId) {
      return {
        spaceId: data.spaceId,
        spaceName: data.spaceName,
        teamId: data.teamId,
        teamName: data.teamName,
        url: buildCogitRemoteUrl(this.cogitGitBaseUrl, data.teamId, data.spaceId),
      }
    }

    throw new VcError('URL or space selection is required.', VcErrorCode.INVALID_REMOTE_URL)
  }

  /**
   * Resolve any URL format to a clean cogit URL + team/space info.
   * Supports:
   * 1. Cogit URL with UUIDs (/git/{uuid}/{uuid}.git) → strip credentials, return clean
   * 2. Cogit URL with names (/git/{name}/{name}.git|.brv) → resolve names to IDs
   * 3. User-facing .brv URL (/{name}/{name}.brv) → resolve names to IDs
   * 4. Unknown format → reject (no credential leaking to arbitrary URLs)
   *
   * Auth is handled by IsomorphicGitService via headers, not URL credentials.
   */
  private async resolveFullCogitUrl(url: string): Promise<{
    spaceId?: string
    spaceName?: string
    teamId?: string
    teamName?: string
    url: string
  }> {
    // /git/{segment1}/{segment2}.git or .brv
    const gitPath = parseGitPathUrl(url)
    if (gitPath) {
      if (gitPath.areUuids) {
        // UUIDs — build clean URL (strip any credentials that may be in the URL)
        const cleanUrl = buildCogitRemoteUrl(this.cogitGitBaseUrl, gitPath.segment1, gitPath.segment2)
        return {spaceId: gitPath.segment2, teamId: gitPath.segment1, url: cleanUrl}
      }

      // Names — resolve to IDs via API
      return this.resolveTeamSpaceNames(gitPath.segment1, gitPath.segment2)
    }

    // User-facing .brv URL (/{teamName}/{spaceName}.brv, no /git/ prefix)
    const brvParts = parseBrvUrl(url)
    if (brvParts) {
      return this.resolveTeamSpaceNames(brvParts.teamName, brvParts.spaceName)
    }

    // Unknown format — reject to prevent credential leaking to arbitrary URLs
    throw new VcError(
      'Invalid URL format. Use: https://host/git/team/space.git or https://host/team/space.brv',
      VcErrorCode.INVALID_REMOTE_URL,
    )
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
          `    /vc push -u origin ${currentTrimmed}`,
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
   * Resolve team/space names to IDs via API, build clean cogit URL.
   */
  private async resolveTeamSpaceNames(
    teamName: string,
    spaceName: string,
  ): Promise<{spaceId: string; spaceName: string; teamId: string; teamName: string; url: string}> {
    const token = await this.tokenStore.load()
    if (!token?.isValid()) throw new NotAuthenticatedError()

    const {teams} = await this.teamService.getTeams(token.sessionKey, {fetchAll: true})
    const team = teams.find((t) => t.name === teamName)
    if (!team) {
      const available = teams.map((t) => t.name).join(', ')
      throw new VcError(
        teams.length > 0
          ? `Team "${teamName}" not found. Available: ${available}`
          : `Team "${teamName}" not found. No teams available.`,
        VcErrorCode.INVALID_REMOTE_URL,
      )
    }

    const {spaces} = await this.spaceService.getSpaces(token.sessionKey, team.id, {fetchAll: true})
    const space = spaces.find((s) => s.name === spaceName)
    if (!space) {
      const available = spaces.map((s) => s.name).join(', ')
      throw new VcError(
        spaces.length > 0
          ? `Space "${spaceName}" not found in team "${team.name}". Available: ${available}`
          : `Space "${spaceName}" not found in team "${team.name}". No spaces available.`,
        VcErrorCode.INVALID_REMOTE_URL,
      )
    }

    return {
      spaceId: space.id,
      spaceName: space.name,
      teamId: space.teamId,
      teamName: team.name,
      url: buildCogitRemoteUrl(this.cogitGitBaseUrl, space.teamId, space.id),
    }
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
