import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ICogitPullService} from '../../core/interfaces/i-cogit-pull-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../core/interfaces/i-context-tree-writer-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IPullUseCase} from '../../core/interfaces/usecase/i-pull-use-case.js'

import {WorkspaceNotInitializedError} from '../cipher/validation/workspace-validator.js'

export interface PullUseCaseOptions {
  cogitPullService: ICogitPullService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
}

export class PullUseCase implements IPullUseCase {
  private readonly cogitPullService: ICogitPullService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly contextTreeWriterService: IContextTreeWriterService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService

  public constructor(options: PullUseCaseOptions) {
    this.cogitPullService = options.cogitPullService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.contextTreeWriterService = options.contextTreeWriterService
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
  }

  protected async checkLocalChanges(): Promise<boolean> {
    const changes = await this.contextTreeSnapshotService.getChanges()
    return changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0
  }

  protected async checkProjectInit(): Promise<BrvConfig> {
    const projectConfig = await this.projectConfigStore.read()
    if (projectConfig === undefined) {
      throw new WorkspaceNotInitializedError(
        'Project not initialized. Please run "brv init" to select your team and workspace.',
        '.brv',
      )
    }

    return projectConfig
  }

  public async run(options: {branch: string}): Promise<void> {
    try {
      await this.trackingService.track('mem:pull')

      const token = await this.validateAuth()
      if (!token) return

      const projectConfig = await this.checkProjectInit()

      // Check for local changes
      this.terminal.actionStart('Checking for local Context Tree changes')
      const hasLocalChanges = await this.checkLocalChanges()
      this.terminal.actionStop()

      if (hasLocalChanges) {
        this.terminal.log('You have local changes that have not been pushed. Run "brv push" first.')
        return
      }

      // Pull from CoGit
      this.terminal.log('Pulling from ByteRover...')
      const snapshot = await this.cogitPullService.pull({
        accessToken: token.accessToken,
        branch: options.branch,
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId,
        teamId: projectConfig.teamId,
      })

      // Sync files to local context tree
      this.terminal.actionStart('Syncing context files')
      const syncResult = await this.contextTreeWriterService.sync({files: snapshot.files})
      this.terminal.actionStop()

      // Update snapshot ONLY after successful sync
      await this.contextTreeSnapshotService.saveSnapshot()

      // Success message
      this.terminal.log('\n✓ Successfully pulled context tree from ByteRover memory storage!')
      this.terminal.log(`  Branch: ${options.branch}`)
      this.terminal.log(`  Commit: ${snapshot.commitSha.slice(0, 7)}`)
      this.terminal.log(
        `  Added: ${syncResult.added.length}, Edited: ${syncResult.edited.length}, Deleted: ${syncResult.deleted.length}`,
      )
    } catch (error) {
      // Stop action if it's in progress
      this.terminal.actionStop()
      if (error instanceof WorkspaceNotInitializedError) {
        this.terminal.log('Project not initialized. Please run "brv init" to select your team and workspace.')
        return
      }

      const message = error instanceof Error ? error.message : 'Pull failed'
      this.terminal.error(`Failed to pull: ${message}`)
    }
  }

  protected async validateAuth(): Promise<AuthToken | undefined> {
    const token = await this.tokenStore.load()

    if (token === undefined) {
      this.terminal.error('Not authenticated. Run "brv login" first.')
      return undefined
    }

    if (!token.isValid()) {
      this.terminal.error('Authentication token expired. Run "brv login" again.')
      return undefined
    }

    return token
  }
}
