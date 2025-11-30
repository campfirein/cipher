import {confirm} from '@inquirer/prompts'
import {Command, Flags, ux} from '@oclif/core'

import type {AuthToken} from '../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../core/domain/entities/brv-config.js'
import type {ICogitPushService} from '../core/interfaces/i-cogit-push-service.js'
import type {IContextFileReader} from '../core/interfaces/i-context-file-reader.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {DEFAULT_BRANCH} from '../constants.js'
import {IContextTreeSnapshotService} from '../core/interfaces/i-context-tree-snapshot-service.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {ExitCode, ExitError, exitWithCode} from '../infra/cipher/exit-codes.js'
import {WorkspaceNotInitializedError} from '../infra/cipher/validation/workspace-validator.js'
import {mapToPushContexts} from '../infra/cogit/context-tree-to-push-context-mapper.js'
import {HttpCogitPushService} from '../infra/cogit/http-cogit-push-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextFileReader} from '../infra/context-tree/file-context-file-reader.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Push extends Command {
  public static description = 'Push context tree to ByteRover memory storage'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --branch develop',
    '<%= config.bin %> <%= command.id %> -b feature-auth',
  ]
  public static flags = {
    branch: Flags.string({
      // Can pass either --branch or -b
      char: 'b',
      default: DEFAULT_BRANCH,
      description: 'ByteRover branch name (not Git branch)',
    }),
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
    }),
  }

  // Override catch to prevent oclif from logging errors that were already displayed
  async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    // Check if error is ExitError (message already displayed by exitWithCode)
    if (error instanceof ExitError) {
      return
    }

    // Backwards compatibility: also check oclif.exit property
    if (error.oclif?.exit !== undefined) {
      // Error already displayed by exitWithCode, silently exit
      return
    }

    // For other errors, re-throw to let oclif handle them
    throw error
  }

  protected async checkProjectInit(projectConfigStore: IProjectConfigStore): Promise<BrvConfig> {
    const projectConfig = await projectConfigStore.read()
    if (projectConfig === undefined) {
      throw new WorkspaceNotInitializedError(
        'Project not initialized. Please run "brv init" to select your team and workspace.',
        '.brv',
      )
    }

    return projectConfig
  }

  protected async confirmPush(projectConfig: BrvConfig, branch: string): Promise<boolean> {
    this.log('\nYou are about to push to ByteRover memory storage:')
    this.log(`  Space: ${projectConfig.spaceName}`)
    this.log(`  Branch: ${branch}`)

    return confirm({
      default: false,
      message: 'Push to ByteRover and clean up local files?',
    })
  }

  protected createServices(): {
    cogitPushService: ICogitPushService
    contextFileReader: IContextFileReader
    contextTreeSnapshotService: IContextTreeSnapshotService
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      cogitPushService: new HttpCogitPushService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextFileReader: new FileContextFileReader(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Push)

    try {
      const {
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        projectConfigStore,
        tokenStore,
        trackingService,
      } = this.createServices()

      await trackingService.track('mem:push')

      const token = await this.validateAuth(tokenStore)
      const projectConfig = await this.checkProjectInit(projectConfigStore)

      // Check for changes
      ux.action.start('Checking for Context Tree changes')
      const contextTreeChanges = await contextTreeSnapshotService.getChanges()
      ux.action.stop()

      if (
        contextTreeChanges.added.length === 0 &&
        contextTreeChanges.modified.length === 0 &&
        contextTreeChanges.deleted.length === 0
      ) {
        this.log('No context changes to push.')
        return
      }

      // Prompt for confirmation unless --yes flag is provided
      if (!flags.yes) {
        const confirmed = await this.confirmPush(projectConfig, flags.branch)
        if (!confirmed) {
          this.log('Push cancelled.')
          return
        }
      }

      // Read and prepare files
      ux.action.start('Reading context files')
      const [addedFiles, modifiedFiles] = await Promise.all([
        contextFileReader.readMany(contextTreeChanges.added),
        contextFileReader.readMany(contextTreeChanges.modified),
      ])
      ux.action.stop()

      const pushContexts = mapToPushContexts({addedFiles, modifiedFiles})

      if (pushContexts.length === 0) {
        this.log('\nNo valid context files to push.')
        return
      }

      // Push to CoGit (with two-request SHA flow)
      this.log('Pushing to ByteRover...')
      await cogitPushService.push({
        accessToken: token.accessToken,
        branch: flags.branch,
        contexts: pushContexts,
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId,
        teamId: projectConfig.teamId,
      })

      // Update snapshot ONLY after successful push
      await contextTreeSnapshotService.saveSnapshot()

      // Success message
      this.log('\n✓ Successfully pushed context tree to ByteRover memory storage!')
      this.log(`  Branch: ${flags.branch}`)
      this.log(`  Added: ${addedFiles.length}, Edited: ${modifiedFiles.length}`)
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        exitWithCode(
          ExitCode.VALIDATION_ERROR,
          'Project not initialized. Please run "brv init" to select your team and workspace.',
        )
      }

      // For other errors, use exitWithCode to properly display error before exit
      const message = error instanceof Error ? error.message : 'Push failed'
      exitWithCode(ExitCode.RUNTIME_ERROR, `Failed to push: ${message}`)
    }
  }

  protected async validateAuth(tokenStore: ITokenStore): Promise<AuthToken> {
    const token = await tokenStore.load()

    if (token === undefined) {
      this.error('Not authenticated. Run "brv login" first.')
    }

    if (!token.isValid()) {
      this.error('Authentication token expired. Run "brv login" again.')
    }

    return token
  }
}
