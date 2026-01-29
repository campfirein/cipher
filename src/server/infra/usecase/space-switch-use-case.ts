import type {Space} from '../../core/domain/entities/space.js'
import type {Team} from '../../core/domain/entities/team.js'
import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import type {ISpaceService} from '../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../core/interfaces/services/i-team-service.js'
import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'
import type {ISpaceSwitchUseCase} from '../../core/interfaces/usecase/i-space-switch-use-case.js'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../constants.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'

export interface SpaceSwitchUseCaseDependencies {
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  teamService: ITeamService
  terminal: ITerminal
  tokenStore: ITokenStore
}

export class SpaceSwitchUseCase implements ISpaceSwitchUseCase {
  private readonly projectConfigStore: IProjectConfigStore
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore

  constructor(deps: SpaceSwitchUseCaseDependencies) {
    this.projectConfigStore = deps.projectConfigStore
    this.spaceService = deps.spaceService
    this.teamService = deps.teamService
    this.terminal = deps.terminal
    this.tokenStore = deps.tokenStore
  }

  protected async promptForSpaceSelection(spaces: Space[]): Promise<Space | undefined> {
    const selectedSpaceId = await this.terminal.select({
      choices: spaces.map((space) => ({
        name: space.getDisplayName(),
        value: space.id,
      })),
      message: 'Select a space',
    })

    const selectedSpace = spaces.find((space) => space.id === selectedSpaceId)
    if (!selectedSpace) {
      this.terminal.log('Space selection failed')
      return undefined
    }

    return selectedSpace
  }

  protected async promptForTeamSelection(teams: Team[]): Promise<Team | undefined> {
    const selectedTeamId = await this.terminal.select({
      choices: teams.map((team) => ({
        name: team.name,
        value: team.id,
      })),
      message: 'Select a team',
    })

    const selectedTeam = teams.find((team) => team.id === selectedTeamId)
    if (!selectedTeam) {
      this.terminal.log('Team selection failed')
      return undefined
    }

    return selectedTeam
  }

  public async run(): Promise<void> {
    // Check project initialization (MUST exist for switch)
    const currentConfig = await this.projectConfigStore.read()
    if (!currentConfig) {
      this.terminal.log('Project not initialized. Please run "/init" first.')
      return
    }

    // Show current configuration
    this.terminal.log('Current configuration:')
    this.terminal.log(`  Team: ${currentConfig.teamName}`)
    this.terminal.log(`  Space: ${currentConfig.spaceName}`)
    this.terminal.log()

    // Validate authentication
    const token = await this.tokenStore.load()
    if (!token) {
      this.terminal.log('Not authenticated. Please run "/login" first.')
      return
    }

    if (!token.isValid()) {
      this.terminal.log('Authentication token expired. Please run "/login" again.')
      return
    }

    // Fetch all teams
    this.terminal.actionStart('Fetching all teams')
    const teamResult = await this.teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
    this.terminal.actionStop()

    if (teamResult.teams.length === 0) {
      this.terminal.log('No teams found. Please create a team in the ByteRover dashboard first.')
      return
    }

    // Prompt for team selection
    this.terminal.log()
    const selectedTeam = await this.promptForTeamSelection(teamResult.teams)
    if (!selectedTeam) return

    // Fetch spaces for selected team
    this.terminal.actionStart('Fetching all spaces')
    const spaceResult = await this.spaceService.getSpaces(token.accessToken, token.sessionKey, selectedTeam.id, {
      fetchAll: true,
    })
    this.terminal.actionStop()

    if (spaceResult.spaces.length === 0) {
      this.terminal.log(
        `No spaces found in team "${selectedTeam.getDisplayName()}". Please create a space in the ByteRover dashboard first.`,
      )
      return
    }

    // Prompt for space selection
    this.terminal.log()
    const selectedSpace = await this.promptForSpaceSelection(spaceResult.spaces)
    if (!selectedSpace) return

    // Update configuration
    const newConfig = new BrvConfig({
      ...currentConfig,
      createdAt: new Date().toISOString(),
      spaceId: selectedSpace.id,
      spaceName: selectedSpace.name,
      teamId: selectedTeam.id,
      teamName: selectedTeam.name,
    })

    await this.projectConfigStore.write(newConfig)

    // Display success
    this.terminal.log(`\n✓ Successfully switched to space: ${selectedSpace.getDisplayName()}`)
    this.terminal.log(`✓ Configuration updated in: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
  }
}
