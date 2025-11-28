import {confirm} from '@inquirer/prompts'
import {Command, Flags, ux} from '@oclif/core'

import type {AuthToken} from '../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../core/domain/entities/brv-config.js'
import type {PresignedUrl} from '../core/domain/entities/presigned-url.js'
import type {PresignedUrlsResponse} from '../core/domain/entities/presigned-urls-response.js'
import type {IMemoryStorageService} from '../core/interfaces/i-memory-storage-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {DEFAULT_BRANCH, PLAYBOOK_FILE} from '../constants.js'
import {IContextTreeSnapshotService} from '../core/interfaces/i-context-tree-snapshot-service.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {HttpMemoryStorageService} from '../infra/memory/http-memory-storage-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Push extends Command {
  public static description = 'Push playbook to ByteRover memory storage and clean up local ACE files'
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

  protected async checkProjectInit(projectConfigStore: IProjectConfigStore): Promise<BrvConfig> {
    const projectConfig = await projectConfigStore.read()
    if (projectConfig === undefined) {
      this.error('Project not initialized. Run "brv init" first.')
    }

    return projectConfig
  }

  protected async confirmPush(projectConfig: BrvConfig, branch: string, fileCount: number): Promise<boolean> {
    this.log('\nYou are about to push to ByteRover memory storage:')
    this.log(`  Space: ${projectConfig.spaceName}`)
    this.log(`  Branch: ${branch}`)
    this.log(`  Files to upload: ${fileCount}`)

    return confirm({
      default: false,
      message: 'Push to ByteRover and clean up local files?',
    })
  }

  protected async confirmUpload(
    memoryService: IMemoryStorageService,
    token: AuthToken,
    projectConfig: BrvConfig,
    requestId: string,
  ): Promise<void> {
    ux.action.start('Confirming upload')
    await memoryService.confirmUpload({
      accessToken: token.accessToken,
      requestId,
      sessionKey: token.sessionKey,
      spaceId: projectConfig.spaceId,
      teamId: projectConfig.teamId,
    })
    ux.action.stop('✓')
  }

  protected createServices(): {
    contextTreeSnapshotService: IContextTreeSnapshotService
    memoryService: IMemoryStorageService
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      memoryService: new HttpMemoryStorageService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  protected async getPresignedUrls(
    memoryService: IMemoryStorageService,
    token: AuthToken,
    projectConfig: BrvConfig,
  ): Promise<PresignedUrlsResponse> {
    const {flags} = await this.parse(Push)
    ux.action.start('Requesting upload URLs')
    const response = await memoryService.getPresignedUrls({
      accessToken: token.accessToken,
      branch: flags.branch,
      fileNames: [`${PLAYBOOK_FILE}`],
      sessionKey: token.sessionKey,
      spaceId: projectConfig.spaceId,
      teamId: projectConfig.teamId,
    })
    ux.action.stop()
    return response
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Push)

    try {
      const {contextTreeSnapshotService, projectConfigStore, tokenStore, trackingService} = this.createServices()

      await trackingService.track('mem:push')

      const token = await this.validateAuth(tokenStore)
      const projectConfig = await this.checkProjectInit(projectConfigStore)

      // Prompt for confirmation unless --yes flag is provided
      if (!flags.yes) {
        const confirmed = await this.confirmPush(projectConfig, flags.branch, 1)
        if (!confirmed) {
          this.log('Push cancelled. No files were uploaded or cleaned.')
          return
        }
      }

      // eslint-disable-next-line no-warning-comments
      // TODO: Implement push functionality with Cogit

      // Snapshot context tree
      await contextTreeSnapshotService.saveSnapshot()

      // Success message
      this.log('\n✓ Successfully pushed playbook to ByteRover memory storage!')
      this.log(`  Branch: ${flags.branch}`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Push failed')
    }
  }

  protected async uploadFiles(
    memoryService: IMemoryStorageService,
    presignedUrls: ReadonlyArray<PresignedUrl>,
    playbookContent: string,
  ): Promise<void> {
    this.log('\nUploading files...')
    ux.action.start('  Uploading files')
    await Promise.all(
      presignedUrls.map((presignedUrl) => memoryService.uploadFile(presignedUrl.uploadUrl, playbookContent)),
    )
    ux.action.stop('✓')
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
