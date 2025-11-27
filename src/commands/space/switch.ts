import {search, select} from '@inquirer/prompts'
import {Command, ux} from '@oclif/core'

import type {Space} from '../../core/domain/entities/space.js'
import type {Team} from '../../core/domain/entities/team.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../core/interfaces/i-space-service.js'
import type {ITeamService} from '../../core/interfaces/i-team-service.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../constants.js'
import {Agent, AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {ExitCode, exitWithCode} from '../../infra/cipher/exit-codes.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpSpaceService} from '../../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../../infra/team/http-team-service.js'
import {WorkspaceDetectorService} from '../../infra/workspace/workspace-detector-service.js'

export default class SpaceSwitch extends Command {
  public static description = `Switch to a different team or space (updates ${BRV_DIR}/${PROJECT_CONFIG_FILE})`
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Shows current configuration, then prompts for new team/space selection',
  ]

  async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    const oclifError = error as Error & {oclif?: {exit?: number}}
    if (oclifError.oclif && oclifError.oclif.exit !== undefined) {
      // Error already displayed by exitWithCode, silently exit
      return
    }

    // For unexpected errors, show the message
    this.error(error instanceof Error ? error.message : 'Switch failed')
  }

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    spaceService: ISpaceService
    teamService: ITeamService
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      teamService: new HttpTeamService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      tokenStore: new KeychainTokenStore(),
    }
  }

  protected detectWorkspacesForAgent(agent: Agent): {chatLogPath: string; cwd: string} {
    const detector = new WorkspaceDetectorService()
    const result = detector.detectWorkspaces(agent)
    return {
      chatLogPath: result.chatLogPath,
      cwd: result.cwd,
    }
  }

  /**
   * Prompts the user to select an agent.
   * This method is protected to allow test overrides.
   * @returns The selected agent
   */
  protected async promptForAgentSelection(): Promise<Agent> {
    const AGENTS = AGENT_VALUES.map((agent) => ({
      name: agent,
      value: agent,
    }))
    const answer = await search({
      message: 'Which agent you are using (type to search):',
      async source(input) {
        if (!input) return AGENTS

        return AGENTS.filter(
          (agent) =>
            agent.name.toLowerCase().includes(input.toLowerCase()) ||
            agent.value.toLowerCase().includes(input.toLowerCase()),
        )
      },
    })

    return answer
  }

  protected async promptForSpaceSelection(spaces: Space[]): Promise<Space> {
    const selectedSpaceId = await select({
      choices: spaces.map((space) => ({
        name: space.getDisplayName(),
        value: space.id,
      })),
      message: 'Select a space',
    })

    const selectedSpace = spaces.find((space) => space.id === selectedSpaceId)
    if (!selectedSpace) {
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Space selection failed')
    }

    return selectedSpace
  }

  protected async promptForTeamSelection(teams: Team[]): Promise<Team> {
    const selectedTeamId = await select({
      choices: teams.map((team) => ({
        name: team.name,
        value: team.id,
      })),
      message: 'Select a team',
    })

    const selectedTeam = teams.find((team) => team.id === selectedTeamId)
    if (!selectedTeam) {
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Team selection failed')
    }

    return selectedTeam
  }

  public async run(): Promise<void> {
    const {projectConfigStore, spaceService, teamService, tokenStore} = this.createServices()

    // Check project initialization (MUST exist for switch)
    const currentConfig = await projectConfigStore.read()
    if (!currentConfig) {
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Project not initialized. Please run "brv init" first.')
    }

    // Show current configuration
    this.log('Current configuration:')
    this.log(`  Team: ${currentConfig.teamName}`)
    this.log(`  Space: ${currentConfig.spaceName}`)
    this.log()

    // Validate authentication
    const token = await tokenStore.load()
    if (!token) {
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Not authenticated. Please run "brv login" first.')
    }

    if (!token.isValid()) {
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Authentication token expired. Please run "brv login" again.')
    }

    // Fetch all teams
    ux.action.start('Fetching all teams')
    const teamResult = await teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
    ux.action.stop()

    if (teamResult.teams.length === 0) {
      exitWithCode(
        ExitCode.VALIDATION_ERROR,
        'No teams found. Please create a team in the ByteRover dashboard first.',
      )
    }

    // Prompt for team selection
    this.log()
    const selectedTeam = await this.promptForTeamSelection(teamResult.teams)

    // Fetch spaces for selected team
    ux.action.start('Fetching all spaces')
    const spaceResult = await spaceService.getSpaces(token.accessToken, token.sessionKey, selectedTeam.id, {
      fetchAll: true,
    })
    ux.action.stop()

    if (spaceResult.spaces.length === 0) {
      exitWithCode(
        ExitCode.VALIDATION_ERROR,
        `No spaces found in team "${selectedTeam.getDisplayName()}". Please create a space in the ByteRover dashboard first.`,
      )
    }

    // Prompt for space selection
    this.log()
    const selectedSpace = await this.promptForSpaceSelection(spaceResult.spaces)

    // Prompt for agent selection
    this.log()
    const selectedAgent = await this.promptForAgentSelection()

    this.log()
    const {chatLogPath, cwd} = await this.detectWorkspacesForAgent(selectedAgent)

    // Update configuration
    const newConfig = BrvConfig.fromSpace(selectedSpace, chatLogPath, selectedAgent, cwd)
    await projectConfigStore.write(newConfig)

    // Display success
    this.log(`\n✓ Successfully switched to space: ${selectedSpace.getDisplayName()}`)
    this.log(`✓ Configuration updated in: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
  }
}
