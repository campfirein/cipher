import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../core/interfaces/i-space-service.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ISpaceListUseCase} from '../../core/interfaces/usecase/i-space-list-use-case.js'

export interface SpaceListFlags {
  all: boolean
  json: boolean
  limit: number
  offset: number
}

export interface SpaceListUseCaseDependencies {
  flags: SpaceListFlags
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  terminal: ITerminal
  tokenStore: ITokenStore
}

export class SpaceListUseCase implements ISpaceListUseCase {
  private readonly flags: SpaceListFlags
  private readonly projectConfigStore: IProjectConfigStore
  private readonly spaceService: ISpaceService
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore

  constructor(deps: SpaceListUseCaseDependencies) {
    this.flags = deps.flags
    this.projectConfigStore = deps.projectConfigStore
    this.spaceService = deps.spaceService
    this.terminal = deps.terminal
    this.tokenStore = deps.tokenStore
  }

  public async run(): Promise<void> {
    // Check project initialization
    const projectConfig = await this.projectConfigStore.read()
    if (!projectConfig) {
      this.terminal.error('Project not initialized. Please run "brv init" first.')
      return
    }

    const token = await this.tokenStore.load()
    if (!token) {
      this.terminal.error('Not authenticated. Please run "brv login" first.')
      return
    }

    if (!token.isValid()) {
      this.terminal.error('Authentication token expired. Please run "brv login" again.')
      return
    }

    // Fetch spaces for the team from project config
    this.terminal.actionStart(`Fetching spaces for ${projectConfig.teamName}`)
    const result = await this.spaceService.getSpaces(
      token.accessToken,
      token.sessionKey,
      projectConfig.teamId,
      this.flags.all ? {fetchAll: true} : {limit: this.flags.limit, offset: this.flags.offset},
    )
    this.terminal.actionStop()

    // Handle empty results
    if (result.spaces.length === 0) {
      this.terminal.log(`No spaces found in team "${projectConfig.teamName}".`)
      return
    }

    // Display results based on format
    if (this.flags.json) {
      this.terminal.log(
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
    this.terminal.log(`\nSpaces in team "${projectConfig.teamName}":\n`)
    this.terminal.log(`Found ${result.spaces.length} space(s):\n`)
    for (const [index, space] of result.spaces.entries()) {
      this.terminal.log(`  ${index + 1}. ${space.getDisplayName()}`)
    }

    // Pagination warning
    if (!this.flags.all && result.spaces.length < result.total) {
      const remaining = result.total - result.spaces.length - this.flags.offset
      this.terminal.log(`\nShowing ${result.spaces.length} of ${result.total} spaces.`)
      if (remaining > 0) {
        this.terminal.log('Use --all to fetch all spaces, or use --limit and --offset for pagination.')
      }
    }
  }
}
