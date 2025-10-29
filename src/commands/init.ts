import {select} from '@inquirer/prompts'
import {Command, ux} from '@oclif/core'

import type {Space} from '../core/domain/entities/space.js'
import type {Team} from '../core/domain/entities/team.js'
import type {IPlaybookService} from '../core/interfaces/i-playbook-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../core/interfaces/i-space-service.js'
import type {ITeamService} from '../core/interfaces/i-team-service.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {BrConfig} from '../core/domain/entities/br-config.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FilePlaybookService} from '../infra/playbook/file-playbook-service.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../infra/team/http-team-service.js'

export default class Init extends Command {
  public static description = 'Initialize a project with ByteRover'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  protected createServices(): {
    playbookService: IPlaybookService
    projectConfigStore: IProjectConfigStore
    spaceService: ISpaceService
    teamService: ITeamService
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      playbookService: new FilePlaybookService(),
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
      this.error('Space selection failed')
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
      this.error('Team selection failed')
    }

    return selectedTeam
  }

  public async run(): Promise<void> {
    try {
      const {playbookService, projectConfigStore, spaceService, teamService, tokenStore} = this.createServices()

      // 1. Check if already initialized
      const isInitialized = await projectConfigStore.exists()
      if (isInitialized) {
        this.log('Project is already initialized with ByteRover.')
        const existingProjectConfig = await projectConfigStore.read()
        this.log(
          `Your space for this project is: ${existingProjectConfig?.teamName}/${existingProjectConfig?.spaceName}`,
        )
        return
      }

      this.log('Initializing ByteRover project...\n')

      // 2. Load and validate authentication token
      const token = await tokenStore.load()
      if (token === undefined) {
        this.error('Not authenticated. Please run "br login" first.')
      }

      if (!token.isValid()) {
        this.error('Authentication token expired. Please run "br login" again.')
      }

      // 3. Fetch all teams with spinner
      ux.action.start('Fetching all teams')
      const teamResult = await teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
      ux.action.stop()

      const {teams} = teamResult

      if (teams.length === 0) {
        this.error('No teams found. Please create a team in the ByteRover dashboard first.')
      }

      // 4. Prompt for team selection
      this.log()
      const selectedTeam = await this.promptForTeamSelection(teams)

      // 5. Fetch all spaces for the selected team with spinner
      ux.action.start('Fetching all spaces')
      const spaceResult = await spaceService.getSpaces(token.accessToken, token.sessionKey, selectedTeam.id, {
        fetchAll: true,
      })
      ux.action.stop()

      const {spaces} = spaceResult

      if (spaces.length === 0) {
        this.error(
          `No spaces found in team "${selectedTeam.getDisplayName()}". Please create a space in the ByteRover dashboard first.`,
        )
      }

      // 6. Prompt for space selection
      this.log()
      const selectedSpace = await this.promptForSpaceSelection(spaces)

      // 7. Create and save configuration
      const config = BrConfig.fromSpace(selectedSpace)
      await projectConfigStore.write(config)

      // 8. Initialize ACE playbook
      this.log('\nInitializing ACE context...')
      try {
        const playbookPath = await playbookService.initialize()
        this.log(`✓ ACE playbook initialized in ${playbookPath}`)
      } catch (error) {
        // Warn but don't fail if ACE init fails
        this.warn(`ACE initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      // 9. Display success
      this.log(`\n✓ Project initialized successfully!`)
      this.log(`✓ Connected to space: ${selectedSpace.getDisplayName()}`)
      this.log(`✓ Configuration saved to: .br/config.json`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Initialization failed')
    }
  }
}
