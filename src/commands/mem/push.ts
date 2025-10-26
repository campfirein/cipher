import {Command, Flags, ux} from '@oclif/core'

import type {IMemoryService} from '../../core/interfaces/i-memory-service.js'
import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpMemoryService} from '../../infra/memory/http-memory-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

/**
 * Default ByteRover branch name for memory storage.
 * This is ByteRover's internal branching mechanism, not Git branches.
 */
const DEFAULT_BRANCH = 'main'

export default class MemPush extends Command {
  public static description = 'Push playbook to ByteRover memory storage'
  public static examples = ['<%= config.bin %> <%= command.id %>']
  public static flags = {
    branch: Flags.string({
      // Can pass either --branch or -b
      char: 'b',
      default: DEFAULT_BRANCH,
      description: 'ByteRover branch name (not Git branch)',
    }),
  }

  protected createServices(): {
    memoryService: IMemoryService
    playbookStore: IPlaybookStore
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      memoryService: new HttpMemoryService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      playbookStore: new FilePlaybookStore(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(MemPush)

    try {
      const {memoryService, playbookStore, projectConfigStore, tokenStore} = this.createServices()

      // 1. Validate authentication
      const token = await tokenStore.load()

      if (token === undefined) {
        this.error('Not authenticated. Run "br auth login" first.')
      }

      if (!token.isValid()) {
        this.error('Authentication token expired. Run "br auth login" again.')
      }

      // 2. Check if project is initialized
      const projectConfig = await projectConfigStore.read()
      if (projectConfig === undefined) {
        this.error('Project not initialized. Run "br init" first.')
      }

      // 3. Verify playbook exists
      const playbookExists = await playbookStore.exists()
      if (!playbookExists) {
        this.error('Playbook not found. Run "br init" to create one.')
      }

      // 4. Get presigned URLs
      ux.action.start('Requesting upload URLs')
      const presignedUrls = await memoryService.getPresignedUrls({
        accessToken: token.accessToken,
        branch: flags.branch,
        fileNames: ['playbook.json'],
        sessionKey: token.sessionKey,
        spaceId: projectConfig.spaceId,
        teamId: projectConfig.teamId,
      })
      ux.action.stop()

      // 5. Display results (actual upload will be in future iteration)
      this.log('\n✓ Presigned URLs generated successfully!')
      this.log('\nFiles to upload:')
      for (const presignedUrl of presignedUrls) {
        this.log(`  - ${presignedUrl.fileName}`)
      }

      this.warn('\nNote: File upload not yet implemented. This command currently only generates presigned URLs.')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Push failed')
    }
  }
}
