import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../core/interfaces/services/i-cogit-pull-service.js'
import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'
import type {IPullUseCase, PullUseCaseRunOptions} from '../../core/interfaces/usecase/i-pull-use-case.js'

import {WorkspaceNotInitializedError} from '../../../agent/infra/validation/workspace-validator.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'

/**
 * Structured pull result for JSON output.
 */
export interface PullResult {
  added?: number
  branch?: string
  commitSha?: string
  deleted?: number
  edited?: number
  error?: string
  status: 'error' | 'local_changes' | 'success'
}

export interface PullUseCaseOptions {
  cogitPullService: ICogitPullService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
}

export class PullUseCase implements IPullUseCase {
  private readonly cogitPullService: ICogitPullService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly contextTreeWriterService: IContextTreeWriterService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore

  public constructor(options: PullUseCaseOptions) {
    this.cogitPullService = options.cogitPullService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.contextTreeWriterService = options.contextTreeWriterService
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
  }

  protected async checkLocalChanges(): Promise<boolean> {
    const changes = await this.contextTreeSnapshotService.getChanges()
    return changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0
  }

  protected async checkProjectInit(): Promise<BrvConfig> {
    const projectConfig = await this.projectConfigStore.read()
    if (projectConfig === undefined || !projectConfig.isCloudConnected()) {
      throw new WorkspaceNotInitializedError(
        'Not connected to a space. Run "/login" and select a team and space first.',
        '.brv',
      )
    }

    return projectConfig
  }

  public async run(options: PullUseCaseRunOptions): Promise<void> {
    const format = options.format ?? 'text'

    try {
      const token = await this.validateAuth(format)
      if (!token) return

      const projectConfig = await this.checkProjectInit()

      // Check for local changes
      this.terminal.actionStart('Checking for local Context Tree changes')
      const hasLocalChanges = await this.checkLocalChanges()
      this.terminal.actionStop()

      if (hasLocalChanges) {
        if (format === 'json') {
          this.outputJsonResult({
            error: 'You have local changes that have not been pushed. Run push first.',
            status: 'local_changes',
          })
        } else {
          this.terminal.log('You have local changes that have not been pushed. Run "/push" first.')
        }

        return
      }

      // Pull from CoGit
      this.terminal.log('Pulling from ByteRover...')
      const snapshot = await this.cogitPullService.pull({
        branch: options.branch,
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId!,
        teamId: projectConfig.teamId!,
      })

      // Sync files to local context tree
      this.terminal.actionStart('Syncing context files')
      const syncResult = await this.contextTreeWriterService.sync({files: snapshot.files})
      this.terminal.actionStop()

      // Update snapshot ONLY after successful sync
      await this.contextTreeSnapshotService.saveSnapshot()

      if (format === 'json') {
        this.outputJsonResult({
          added: syncResult.added.length,
          branch: options.branch,
          commitSha: snapshot.commitSha,
          deleted: syncResult.deleted.length,
          edited: syncResult.edited.length,
          status: 'success',
        })
      } else {
        // Success message
        this.terminal.log('\n✓ Successfully pulled context tree from ByteRover memory storage!')
        this.terminal.log(`  Branch: ${options.branch}`)
        this.terminal.log(`  Commit: ${snapshot.commitSha.slice(0, 7)}`)
        this.terminal.log(
          `  Added: ${syncResult.added.length}, Edited: ${syncResult.edited.length}, Deleted: ${syncResult.deleted.length}`,
        )
      }
    } catch (error) {
      // Stop action if it's in progress
      this.terminal.actionStop()
      if (error instanceof WorkspaceNotInitializedError) {
        if (format === 'json') {
          this.outputJsonResult({
            error: 'Not connected to a space. Run login and select a team and space first.',
            status: 'error',
          })
        } else {
          this.terminal.log('Not connected to a space. Run "/login" and select a team and space first.')
        }

        return
      }

      const message = error instanceof Error ? error.message : 'Pull failed'
      if (format === 'json') {
        this.outputJsonResult({error: message, status: 'error'})
      } else {
        this.terminal.error(`Failed to pull: ${message}`)
      }
    }
  }

  protected async validateAuth(format: 'json' | 'text'): Promise<AuthToken | undefined> {
    const token = await this.tokenStore.load()

    if (token === undefined) {
      if (format === 'json') {
        this.outputJsonResult({error: 'Not authenticated. Run login first.', status: 'error'})
      } else {
        this.terminal.error('Not authenticated. Run "/login" first.')
      }

      return undefined
    }

    if (!token.isValid()) {
      if (format === 'json') {
        this.outputJsonResult({error: 'Authentication token expired. Run login again.', status: 'error'})
      } else {
        this.terminal.error('Authentication token expired. Run "/login" again.')
      }

      return undefined
    }

    return token
  }

  /**
   * Output JSON result for headless mode.
   */
  private outputJsonResult(result: PullResult): void {
    const response = {
      command: 'pull',
      data: result,
      success: result.status === 'success',
      timestamp: new Date().toISOString(),
    }

    if (this.terminal instanceof HeadlessTerminal) {
      this.terminal.writeFinalResponse(response)
    } else {
      this.terminal.log(JSON.stringify(response))
    }
  }
}
