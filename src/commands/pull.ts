import {Command, Flags, ux} from '@oclif/core'

import type {AuthToken} from '../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../core/domain/entities/brv-config.js'
import type {ICogitPullService} from '../core/interfaces/i-cogit-pull-service.js'
import type {IContextTreeSnapshotService} from '../core/interfaces/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../core/interfaces/i-context-tree-writer-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {getCurrentConfig} from '../config/environment.js'
import {DEFAULT_BRANCH} from '../constants.js'
import {ExitCode, ExitError, exitWithCode} from '../infra/cipher/exit-codes.js'
import {WorkspaceNotInitializedError} from '../infra/cipher/validation/workspace-validator.js'
import {HttpCogitPullService} from '../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../infra/context-tree/file-context-tree-writer-service.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Pull extends Command {
  public static description = 'Pull context tree from ByteRover memory storage'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --branch develop',
    '<%= config.bin %> <%= command.id %> -b feature-auth',
  ]
  public static flags = {
    branch: Flags.string({
      char: 'b',
      default: DEFAULT_BRANCH,
      description: 'ByteRover branch name (not Git branch)',
    }),
  }

  public async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    if (error instanceof ExitError) {
      return
    }

    if (error.oclif?.exit !== undefined) {
      return
    }

    throw error
  }

  protected async checkLocalChanges(contextTreeSnapshotService: IContextTreeSnapshotService): Promise<boolean> {
    const changes = await contextTreeSnapshotService.getChanges()
    return changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0
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

  protected createServices(): {
    cogitPullService: ICogitPullService
    contextTreeSnapshotService: IContextTreeSnapshotService
    contextTreeWriterService: IContextTreeWriterService
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const globalConfigStore = new FileGlobalConfigStore()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService({
      globalConfigStore,
      tokenStore,
    })
    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    return {
      cogitPullService: new HttpCogitPullService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextTreeSnapshotService,
      contextTreeWriterService: new FileContextTreeWriterService({snapshotService: contextTreeSnapshotService}),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Pull)

    try {
      const {
        cogitPullService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        projectConfigStore,
        tokenStore,
        trackingService,
      } = this.createServices()

      await trackingService.track('mem:pull')

      const token = await this.validateAuth(tokenStore)
      const projectConfig = await this.checkProjectInit(projectConfigStore)

      // Check for local changes
      ux.action.start('Checking for local Context Tree changes')
      const hasLocalChanges = await this.checkLocalChanges(contextTreeSnapshotService)
      ux.action.stop()

      if (hasLocalChanges) {
        exitWithCode(
          ExitCode.VALIDATION_ERROR,
          'You have local changes that have not been pushed. Run "brv push" first.',
        )
      }

      // Pull from CoGit
      this.log('Pulling from ByteRover...')
      const snapshot = await cogitPullService.pull({
        accessToken: token.accessToken,
        branch: flags.branch,
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId,
        teamId: projectConfig.teamId,
      })

      // Sync files to local context tree
      ux.action.start('Syncing context files')
      const syncResult = await contextTreeWriterService.sync({files: snapshot.files})
      ux.action.stop()

      // Update snapshot ONLY after successful sync
      await contextTreeSnapshotService.saveSnapshot()

      // Success message
      this.log('\n✓ Successfully pulled context tree from ByteRover memory storage!')
      this.log(`  Branch: ${flags.branch}`)
      this.log(`  Commit: ${snapshot.commitSha.slice(0, 7)}`)
      this.log(
        `  Added: ${syncResult.added.length}, Edited: ${syncResult.edited.length}, Deleted: ${syncResult.deleted.length}`,
      )
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        exitWithCode(
          ExitCode.VALIDATION_ERROR,
          'Project not initialized. Please run "brv init" to select your team and workspace.',
        )
      }

      const message = error instanceof Error ? error.message : 'Pull failed'
      exitWithCode(ExitCode.RUNTIME_ERROR, `Failed to pull: ${message}`)
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
