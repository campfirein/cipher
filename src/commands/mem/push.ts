import {Command, Flags, ux} from '@oclif/core'
import {join} from 'node:path'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrConfig} from '../../core/domain/entities/br-config.js'
import type {PresignedUrl} from '../../core/domain/entities/presigned-url.js'
import type {PresignedUrlsResponse} from '../../core/domain/entities/presigned-urls-response.js'
import type {IMemoryStorageService} from '../../core/interfaces/i-memory-storage-service.js'
import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {ACE_DIR, BR_DIR, DEFAULT_BRANCH, DELTAS_DIR, EXECUTOR_OUTPUTS_DIR, REFLECTIONS_DIR} from '../../constants.js'
import {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpMemoryStorageService} from '../../infra/memory/http-memory-storage-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {clearDirectory} from '../../utils/file-helpers.js'

export default class MemPush extends Command {
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
  }

  protected async checkProjectInit(projectConfigStore: IProjectConfigStore): Promise<BrConfig> {
    const projectConfig = await projectConfigStore.read()
    if (projectConfig === undefined) {
      this.error('Project not initialized. Run "br init" first.')
    }

    return projectConfig
  }

  protected async cleanUpLocalFiles(playbookStore: IPlaybookStore): Promise<void> {
    this.log('\nCleaning up local files...')

    // Clear playbook content
    ux.action.start('  Clearing playbook')
    await playbookStore.clear()
    ux.action.stop('✓')

    // Clean executor outputs
    const baseDir = process.cwd()
    const aceDir = join(baseDir, BR_DIR, ACE_DIR)
    const executorOutputsDir = join(aceDir, EXECUTOR_OUTPUTS_DIR)
    const reflectionsDir = join(aceDir, REFLECTIONS_DIR)
    const deltasDir = join(aceDir, DELTAS_DIR)

    ux.action.start('  Cleaning executor outputs')
    const executorCount = await clearDirectory(executorOutputsDir)
    ux.action.stop(`✓ (${executorCount} files removed)`)

    // Clean reflections
    ux.action.start('  Cleaning reflections')
    const reflectionCount = await clearDirectory(reflectionsDir)
    ux.action.stop(`✓ (${reflectionCount} files removed)`)

    // Clean deltas
    ux.action.start('  Cleaning deltas')
    const deltaCount = await clearDirectory(deltasDir)
    ux.action.stop(`✓ (${deltaCount} files removed)`)
  }

  protected async confirmUpload(
    memoryService: IMemoryStorageService,
    token: AuthToken,
    projectConfig: BrConfig,
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
    memoryService: IMemoryStorageService
    playbookStore: IPlaybookStore
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      memoryService: new HttpMemoryStorageService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      playbookStore: new FilePlaybookStore(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  protected async getPresignedUrls(
    memoryService: IMemoryStorageService,
    token: AuthToken,
    projectConfig: BrConfig,
  ): Promise<PresignedUrlsResponse> {
    const {flags} = await this.parse(MemPush)
    ux.action.start('Requesting upload URLs')
    const response = await memoryService.getPresignedUrls({
      accessToken: token.accessToken,
      branch: flags.branch,
      fileNames: ['playbook.json'],
      sessionKey: token.sessionKey,
      spaceId: projectConfig.spaceId,
      teamId: projectConfig.teamId,
    })
    ux.action.stop()
    return response
  }

  protected async loadPlaybookContent(playbookStore: IPlaybookStore): Promise<string> {
    ux.action.start('Loading playbook')
    const playbook = await playbookStore.load()
    if (playbook === undefined) {
      this.error('Failed to load playbook')
    }

    const playbookContent = playbook.dumps()
    ux.action.stop()
    return playbookContent
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(MemPush)

    try {
      const {memoryService, playbookStore, projectConfigStore, tokenStore, trackingService} = this.createServices()

      await trackingService.track('mem:push')

      const token = await this.validateAuth(tokenStore)
      const projectConfig = await this.checkProjectInit(projectConfigStore)
      await this.verifyPlaybookExists(playbookStore)
      const response = await this.getPresignedUrls(memoryService, token, projectConfig)
      const playbookContent = await this.loadPlaybookContent(playbookStore)
      await this.uploadFiles(memoryService, response.presignedUrls, playbookContent)
      await this.confirmUpload(memoryService, token, projectConfig, response.requestId)
      await this.cleanUpLocalFiles(playbookStore)

      // Success message
      this.log('\n✓ Successfully pushed playbook to ByteRover memory storage!')
      this.log(`  Branch: ${flags.branch}`)
      this.log(`  Files uploaded: ${response.presignedUrls.length}`)
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
      this.error('Not authenticated. Run "br login" first.')
    }

    if (!token.isValid()) {
      this.error('Authentication token expired. Run "br login" again.')
    }

    return token
  }

  protected async verifyPlaybookExists(playbookStore: IPlaybookStore): Promise<void> {
    const playbookExists = await playbookStore.exists()
    if (!playbookExists) {
      this.error('Playbook not found. Run "br init" to create one.')
    }
  }
}
