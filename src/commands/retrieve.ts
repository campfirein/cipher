import {Command, Flags} from '@oclif/core'

import type {AuthToken} from '../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../core/domain/entities/brv-config.js'
import type {RetrieveResult} from '../core/domain/entities/retrieve-result.js'
import type {IMemoryRetrievalService} from '../core/interfaces/i-memory-retrieval-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {HttpMemoryRetrievalService} from '../infra/memory/http-memory-retrieval-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Retrieve extends Command {
  public static description = 'Retrieve memories from ByteRover Memora service and output as JSON'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --query "authentication best practices"',
    '<%= config.bin %> <%= command.id %> -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"',
    '<%= config.bin %> <%= command.id %> -q "database connection issues" --compact',
  ]
  public static flags = {
    compact: Flags.boolean({
      default: false,
      description: 'Output compact JSON (single line)',
      required: false,
    }),
    'node-keys': Flags.string({
      char: 'n',
      description: 'Comma-separated list of node keys (file paths) to filter results',
      required: false,
    }),
    query: Flags.string({
      char: 'q',
      description: 'Search query string',
      required: true,
    }),
  }

  protected async checkProjectInt(projectConfigStore: IProjectConfigStore): Promise<BrvConfig> {
    const isInitialized = await projectConfigStore.exists()
    if (!isInitialized) {
      this.error('Project is not initialized. Please run "brv init" first.')
    }

    const config = await projectConfigStore.read()
    if (!config) {
      this.error('Failed to read project configuration.')
    }

    return config
  }

  protected createServices(): {
    memoryService: IMemoryRetrievalService
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      memoryService: new HttpMemoryRetrievalService({
        apiBaseUrl: envConfig.memoraApiBaseUrl,
      }),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Retrieve)
    const {memoryService, projectConfigStore, tokenStore, trackingService} = this.createServices()

    try {
      const token = await this.validateAuth(tokenStore)
      const projectConfig = await this.checkProjectInt(projectConfigStore)

      // Initialize tracking service
      await trackingService.track('mem:retrieve')

      // Parse node-keys if provided
      const nodeKeys = flags['node-keys'] ? flags['node-keys'].split(',').map((key) => key.trim()) : undefined

      // Call memory service
      const result = await memoryService.retrieve({
        accessToken: token.accessToken,
        nodeKeys,
        query: flags.query,
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId,
      })

      // Build and output JSON
      const output = this.buildJsonOutput(result, flags.query, projectConfig.spaceName, nodeKeys)
      const jsonString = flags.compact ? JSON.stringify(output) : JSON.stringify(output, null, 2)
      this.log(jsonString)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to retrieve memories')
    }
  }

  protected async validateAuth(tokenStore: ITokenStore): Promise<AuthToken> {
    const token = await tokenStore.load()
    if (token === undefined) {
      this.error('Not authenticated. Please run "brv login" first.')
    }

    if (!token.isValid()) {
      this.error('Authentication token expired. Please run "brv login" again.')
    }

    return token
  }

  private buildJsonOutput(
    result: RetrieveResult,
    query: string,
    spaceName: string,
    nodeKeys?: string[],
  ): Record<string, unknown> {
    return {
      query,
      spaceName,
      ...(nodeKeys && nodeKeys.length > 0 && {nodeKeys}),
      memories: result.memories.map((m) => m.toJson()),
      relatedMemories: result.relatedMemories.map((m) => m.toJson()),
    }
  }
}
