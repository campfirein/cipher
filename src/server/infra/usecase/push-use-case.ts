import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import type {IContextFileReader} from '../../core/interfaces/context-tree/i-context-file-reader.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICogitPushService} from '../../core/interfaces/services/i-cogit-push-service.js'
import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'
import type {IPushUseCase, PushUseCaseRunOptions} from '../../core/interfaces/usecase/i-push-use-case.js'

import {WorkspaceNotInitializedError} from '../../../agent/infra/validation/workspace-validator.js'
import {mapToPushContexts} from '../cogit/context-tree-to-push-context-mapper.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'

/**
 * Structured push result for JSON output.
 */
export interface PushResult {
  added?: number
  branch?: string
  deleted?: number
  edited?: number
  error?: string
  status: 'cancelled' | 'error' | 'no_changes' | 'success'
  url?: string
}

export interface PushUseCaseOptions {
  cogitPushService: ICogitPushService
  contextFileReader: IContextFileReader
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
  webAppUrl: string
}

export class PushUseCase implements IPushUseCase {
  private readonly cogitPushService: ICogitPushService
  private readonly contextFileReader: IContextFileReader
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly webAppUrl: string

  constructor(options: PushUseCaseOptions) {
    this.cogitPushService = options.cogitPushService
    this.contextFileReader = options.contextFileReader
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
    this.webAppUrl = options.webAppUrl
  }

  public async run(options: PushUseCaseRunOptions): Promise<void> {
    const format = options.format ?? 'text'

    try {
      await this.trackingService.track('mem:push')

      const token = await this.validateAuth(format)
      if (!token) return

      const projectConfig = await this.checkProjectInit()

      // Check for changes
      this.terminal.actionStart('Checking for Context Tree changes')
      const contextTreeChanges = await this.contextTreeSnapshotService.getChanges()
      this.terminal.actionStop()

      if (
        contextTreeChanges.added.length === 0 &&
        contextTreeChanges.modified.length === 0 &&
        contextTreeChanges.deleted.length === 0
      ) {
        if (format === 'json') {
          this.outputJsonResult({status: 'no_changes'})
        } else {
          this.terminal.log('No context changes to push.')
        }

        return
      }

      // Prompt for confirmation unless skipConfirmation is true
      if (!options.skipConfirmation) {
        const confirmed = await this.confirmPush(projectConfig, options.branch)
        if (!confirmed) {
          if (format === 'json') {
            this.outputJsonResult({status: 'cancelled'})
          } else {
            this.terminal.log('Push cancelled.')
          }

          return
        }
      }

      // Read and prepare files
      this.terminal.actionStart('Reading context files')
      const [addedFiles, modifiedFiles] = await Promise.all([
        this.contextFileReader.readMany(contextTreeChanges.added),
        this.contextFileReader.readMany(contextTreeChanges.modified),
      ])
      this.terminal.actionStop()

      const pushContexts = mapToPushContexts({
        addedFiles,
        deletedPaths: contextTreeChanges.deleted,
        modifiedFiles,
      })

      if (pushContexts.length === 0) {
        if (format === 'json') {
          this.outputJsonResult({status: 'no_changes'})
        } else {
          this.terminal.log('\nNo valid context files to push.')
        }

        return
      }

      // Push to CoGit (with two-request SHA flow)
      this.terminal.log('Pushing to ByteRover...')
      await this.cogitPushService.push({
        accessToken: token.accessToken,
        branch: options.branch,
        contexts: pushContexts,
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId,
        teamId: projectConfig.teamId,
      })

      // Update snapshot ONLY after successful push
      await this.contextTreeSnapshotService.saveSnapshot()

      const url = this.buildSpaceUrl(projectConfig.teamName, projectConfig.spaceName)

      if (format === 'json') {
        this.outputJsonResult({
          added: addedFiles.length,
          branch: options.branch,
          deleted: contextTreeChanges.deleted.length,
          edited: modifiedFiles.length,
          status: 'success',
          url,
        })
      } else {
        // Success message
        this.terminal.log('\n✓ Successfully pushed context tree to ByteRover memory storage!')
        this.terminal.log(`  Branch: ${options.branch}`)
        this.terminal.log(
          `  Added: ${addedFiles.length}, Edited: ${modifiedFiles.length}, Deleted: ${contextTreeChanges.deleted.length}`,
        )
        this.terminal.log(`  View: ${url}`)
      }
    } catch (error) {
      // Stop action if it's in progress
      this.terminal.actionStop()
      if (error instanceof WorkspaceNotInitializedError) {
        if (format === 'json') {
          this.outputJsonResult({error: 'Project not initialized. Run init first.', status: 'error'})
        } else {
          this.terminal.log('Project not initialized. Please run "/init" to select your team and workspace.')
        }

        return
      }

      // For other errors, to properly display error before exit
      const message = error instanceof Error ? error.message : 'Push failed'
      if (format === 'json') {
        this.outputJsonResult({error: message, status: 'error'})
      } else {
        this.terminal.error(`Failed to push: ${message}`)
      }
    }
  }

  private buildSpaceUrl(teamName: string, spaceName: string): string {
    return `${this.webAppUrl}/${teamName}/${spaceName}`
  }

  private async checkProjectInit(): Promise<BrvConfig> {
    const projectConfig = await this.projectConfigStore.read()
    if (projectConfig === undefined) {
      throw new WorkspaceNotInitializedError(
        'Project not initialized. Please run "/init" to select your team and workspace.',
        '.brv',
      )
    }

    return projectConfig
  }

  private async confirmPush(projectConfig: BrvConfig, branch: string): Promise<boolean> {
    this.terminal.log('\nYou are about to push to ByteRover memory storage:')
    this.terminal.log(`  Space: ${projectConfig.spaceName}`)
    this.terminal.log(`  Branch: ${branch}`)

    return this.terminal.confirm({
      default: false,
      message: 'Push to ByteRover',
    })
  }

  /**
   * Output JSON result for headless mode.
   */
  private outputJsonResult(result: PushResult): void {
    const response = {
      command: 'push',
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

  private async validateAuth(format: 'json' | 'text'): Promise<AuthToken | undefined> {
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
}
