import {Command, Flags, ux} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../core/interfaces/i-space-service.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpSpaceService} from '../../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

const DEFAULT_LIMIT = 50
const DEFAULT_OFFSET = 0

export default class SpaceList extends Command {
  public static description = 'List all spaces for the current team (requires project initialization)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --limit 10',
    '<%= config.bin %> <%= command.id %> --limit 10 --offset 20',
    '<%= config.bin %> <%= command.id %> --json',
  ]
  public static flags = {
    all: Flags.boolean({
      char: 'a',
      default: false,
      description: 'Fetch all spaces (may be slow for large teams)',
    }),
    json: Flags.boolean({
      char: 'j',
      default: false,
      description: 'Output in JSON format',
    }),
    limit: Flags.integer({
      char: 'l',
      default: DEFAULT_LIMIT,
      description: 'Maximum number of spaces to fetch',
    }),
    offset: Flags.integer({
      char: 'o',
      default: DEFAULT_OFFSET,
      description: 'Number of spaces to skip',
    }),
  }

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    spaceService: ISpaceService
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl}),
      tokenStore: new KeychainTokenStore(),
    }
  }

  public async run(): Promise<void> {
    try {
      const {flags} = await this.parse(SpaceList)
      const {projectConfigStore, spaceService, tokenStore} = this.createServices()

      // Check project initialization
      const projectConfig = await projectConfigStore.read()
      if (projectConfig === undefined) {
        this.error('Project not initialized. Run "br init" first.')
      }

      const token = await this.validateAuth(tokenStore)

      // Fetch spaces for the team from project config
      ux.action.start(`Fetching spaces for ${projectConfig.teamName}`)
      const result = await spaceService.getSpaces(
        token.accessToken,
        token.sessionKey,
        projectConfig.teamId,
        flags.all ? {fetchAll: true} : {limit: flags.limit, offset: flags.offset},
      )
      ux.action.stop()
      // Handle empty results
      if (result.spaces.length === 0) {
        this.log(`No spaces found in team "${projectConfig.teamName}".`)
        return
      }

      // Display results based on format
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              showing: result.spaces.length,
              spaces: result.spaces.map((s) => s.toJson()),
              team: {id: projectConfig.teamId, name: projectConfig.teamName},
              total: result.total,
            },
            null,
            2,
          ),
        )
        return
      }

      // Human-readable format
      this.log(`\nSpaces in team "${projectConfig.teamName}":\n`)
      this.log(`Found ${result.spaces.length} space(s):\n`)
      for (const [index, space] of result.spaces.entries()) {
        this.log(`  ${index + 1}. ${space.getDisplayName()}`)
      }

      // Pagination warning
      if (!flags.all && result.spaces.length < result.total) {
        const remaining = result.total - result.spaces.length - flags.offset
        this.log(`\nShowing ${result.spaces.length} of ${result.total} spaces.`)
        if (remaining > 0) {
          this.log('Use --all to fetch all spaces, or use --limit and --offset for pagination.')
        }
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list spaces')
    }
  }

  protected async validateAuth(tokenStore: ITokenStore): Promise<AuthToken> {
    const token = await tokenStore.load()
    if (token === undefined) {
      this.error('Not authenticated. Please run "br login" first.')
    }

    if (!token.isValid()) {
      this.error('Authentication token expired. Please run "br login" again.')
    }

    return token
  }
}
