import {Command, Flags} from '@oclif/core'

import type {IMemoryService} from '../../core/interfaces/i-memory-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpMemoryService} from '../../infra/memory/http-memory-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

export default class Retrieve extends Command {
  public static description = 'Retrieve memories from ByteRover Memora service'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --query "authentication best practices"',
    '<%= config.bin %> <%= command.id %> -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"',
  ]
  public static flags = {
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

  protected createServices(): {
    memoryService: IMemoryService
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      memoryService: new HttpMemoryService({
        apiBaseUrl: envConfig.memoraApiBaseUrl,
      }),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Retrieve)
    const {memoryService, projectConfigStore, tokenStore} = this.createServices()

    try {
      // 1. Load and validate authentication token
      const token = await tokenStore.load()
      if (!token) {
        this.error('Not authenticated. Please run "br auth login" first.')
      }

      if (!token.isValid()) {
        this.error('Authentication token expired. Please run "br auth login" again.')
      }

      // 2. Check if project is initialized
      const isInitialized = await projectConfigStore.exists()
      if (!isInitialized) {
        this.error('Project is not initialized. Please run "br init" first.')
      }

      // 3. Load project config to get spaceId
      const config = await projectConfigStore.read()
      if (!config) {
        this.error('Failed to read project configuration.')
      }

      // 4. Parse node-keys if provided
      const nodeKeys = flags['node-keys'] ? flags['node-keys'].split(',').map((key) => key.trim()) : undefined

      // 5. Call memory service
      const result = await memoryService.retrieve({
        accessToken: token.accessToken,
        nodeKeys,
        query: flags.query,
        sessionKey: token.sessionKey,
        spaceId: config.spaceId,
      })

      // 6. Display results
      this.displayResults(result.memories.length, result.relatedMemories.length)

      if (result.memories.length === 0 && result.relatedMemories.length === 0) {
        this.log('\nNo memories found for your query.')
        return
      }

      // Display memories
      if (result.memories.length > 0) {
        this.log('\n=== Memories ===\n')
        for (const [index, memory] of result.memories.entries()) {
          this.displayMemory(index + 1, memory.title, memory.content, memory.score, memory.nodeKeys)
        }
      }

      // Display related memories
      if (result.relatedMemories.length > 0) {
        this.log('\n=== Related Memories ===\n')
        for (const [index, memory] of result.relatedMemories.entries()) {
          this.displayMemory(index + 1, memory.title, memory.content, memory.score, memory.nodeKeys)
        }
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to retrieve memories')
    }
  }

  // eslint-disable-next-line max-params
  private displayMemory(
    index: number,
    title: string,
    content: string,
    score: number,
    nodeKeys: readonly string[],
  ): void {
    this.log(`${index}. ${title}`)
    this.log(`   Score: ${score.toFixed(2)}`)

    // Display content preview (first 200 characters)
    const contentPreview = content.length > 200 ? `${content.slice(0, 200)}...` : content
    this.log(`   Content: ${contentPreview}`)

    // Display node keys if any
    if (nodeKeys.length > 0) {
      this.log(`   Paths: ${nodeKeys.join(', ')}`)
    }

    this.log('') // Empty line for spacing
  }

  private displayResults(memoriesCount: number, relatedMemoriesCount: number): void {
    this.log(`\nFound ${memoriesCount} memories and ${relatedMemoriesCount} related memories`)
  }
}
