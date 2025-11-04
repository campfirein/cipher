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
import {BRV_DIR, PROJECT_CONFIG_FILE} from '../constants.js'
import {BrvConfig} from '../core/domain/entities/brv-config.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FilePlaybookService} from '../infra/playbook/file-playbook-service.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../infra/team/http-team-service.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Init extends Command {
  // public static description =
  //   'Initialize a project with ByteRover (creates .br/config.json with team/space selection and initializes ACE playbook)'
  public static description = `Initialize a project with ByteRover (creates ${BRV_DIR}/${PROJECT_CONFIG_FILE} with team/space selection and initializes ACE playbook)`
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Re-initialize if config exists (will show current config and exit):\n<%= config.bin %> <%= command.id %>',
    '# Full workflow: login then initialize:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
  ]

  protected createServices(): {
    playbookService: IPlaybookService
    projectConfigStore: IProjectConfigStore
    spaceService: ISpaceService
    teamService: ITeamService
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      playbookService: new FilePlaybookService(),
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      teamService: new HttpTeamService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      tokenStore,
      trackingService,
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
      const {playbookService, projectConfigStore, spaceService, teamService, tokenStore, trackingService} =
        this.createServices()

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
        this.error('Not authenticated. Please run "brv login" first.')
      }

      if (!token.isValid()) {
        this.error('Authentication token expired. Please run "brv login" again.')
      }

      // 3. Fetch all teams with spinner
      ux.action.start('Fetching all teams')
      const teamResult = await teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
      ux.action.stop()

      const {teams} = teamResult

      if (teams.length === 0) {
        this.log('No teams found.')
        this.log(`Please visit ${getCurrentConfig().webAppUrl} to create your first team.`)
        return
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
        this.log(`No spaces found in team "${selectedTeam.getDisplayName()}"`)
        this.log(
          `Please visit ${
            getCurrentConfig().webAppUrl
          } to create your first space for ${selectedTeam.getDisplayName()}.`,
        )
        return
      }

      // 6. Prompt for space selection
      this.log()
      const selectedSpace = await this.promptForSpaceSelection(spaces)

      // 7. Create and save configuration
      const config = BrvConfig.fromSpace(selectedSpace)
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

      // 9. Generate rules
      this.log(`\nGenerate rule instructions for coding agents to work with ByteRover correctly`)
      this.log()
      await this.config.runCommand('gen-rules')

      // Track space initialization
      await trackingService.track('space:init')

      // 10. Display success
      this.log(`\n✓ Project initialized successfully!`)
      this.log(`✓ Connected to space: ${selectedSpace.getDisplayName()}`)
      this.log(`✓ Configuration saved to: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Initialization failed')
    }
  }
}
