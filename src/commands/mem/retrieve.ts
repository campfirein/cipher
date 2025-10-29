import {Command, Flags} from '@oclif/core'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrConfig} from '../../core/domain/entities/br-config.js'
import type {IMemoryRetrievalService} from '../../core/interfaces/i-memory-retrieval-service.js'
import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpMemoryRetrievalService} from '../../infra/memory/http-memory-retrieval-service.js'
import {transformRetrieveResultToPlaybook} from '../../infra/memory/memory-to-playbook-mapper.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

export default class Retrieve extends Command {
  public static description = 'Retrieve memories from ByteRover Memora service and save to local ACE playbook'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --query "authentication best practices"',
    '<%= config.bin %> <%= command.id %> -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"',
    '<%= config.bin %> <%= command.id %> -q "database connection issues" # Clears existing playbook and replaces with retrieved memories',
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

  protected async checkProjectInt(projectConfigStore: IProjectConfigStore): Promise<BrConfig> {
    const isInitialized = await projectConfigStore.exists()
    if (!isInitialized) {
      this.error('Project is not initialized. Please run "br init" first.')
    }

    const config = await projectConfigStore.read()
    if (!config) {
      this.error('Failed to read project configuration.')
    }

    return config
  }

  protected createServices(): {
    memoryService: IMemoryRetrievalService
    playbookStore: IPlaybookStore
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      memoryService: new HttpMemoryRetrievalService({
        apiBaseUrl: envConfig.memoraApiBaseUrl,
      }),
      playbookStore: new FilePlaybookStore(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Retrieve)
    const {memoryService, playbookStore, projectConfigStore, tokenStore} = this.createServices()

    try {
      const token = await this.validateAuth(tokenStore)
      const config = await this.checkProjectInt(projectConfigStore)

      // Parse node-keys if provided
      const nodeKeys = flags['node-keys'] ? flags['node-keys'].split(',').map((key) => key.trim()) : undefined

      // Call memory service
      const result = await memoryService.retrieve({
        accessToken: token.accessToken,
        nodeKeys,
        query: flags.query,
        sessionKey: token.sessionKey,
        spaceId: config.spaceId,
      })

      // Display results
      this.displayResults(result.memories.length, result.relatedMemories.length)

      if (result.memories.length === 0 && result.relatedMemories.length === 0) {
        this.log('\nNo memories found for your query.')
        return
      }

      // Clear existing playbook and save retrieved memories
      try {
        await playbookStore.clear()
        const playbook = transformRetrieveResultToPlaybook(result)
        await playbookStore.save(playbook)
        this.log('\n✓ Saved memories to playbook')
      } catch (playbookError) {
        this.warn(`Failed to save memories to playbook: ${playbookError instanceof Error ? playbookError.message : 'Unknown error'}`)
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

  protected async validateAuth(tokenStore: ITokenStore): Promise<AuthToken> {
    const token = await tokenStore.load()
    if (token === undefined) {
      this.error('Not authenticated. Please run "br auth login" first.')
    }

    if (!token.isValid()) {
      this.error('Authentication token expired. Please run "br auth login" again.')
    }

    return token
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
