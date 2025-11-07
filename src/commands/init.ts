import {confirm, select} from '@inquirer/prompts'
import {Command, Flags, ux} from '@oclif/core'
import {rm} from 'node:fs/promises'
import {join} from 'node:path'

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
  public static description = `Initialize a project with ByteRover (creates ${BRV_DIR}/${PROJECT_CONFIG_FILE} with team/space selection and initializes ACE playbook)`
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Re-initialize if config exists (will show current config and exit):\n<%= config.bin %> <%= command.id %>',
    '# Full workflow: login then initialize:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
  ]
  public static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force re-initialization without confirmation prompt',
    }),
  }

  protected async cleanupBeforeReInitialization(): Promise<void> {
    const brvDir = join(process.cwd(), BRV_DIR)
    this.log('\n Cleaning up existing ByteRover directory...')
    ux.action.start(`  Removing ${BRV_DIR}/`)
    try {
      await rm(brvDir, {force: true, recursive: true})
      ux.action.stop('✓')
    } catch (error) {
      ux.action.stop('✗')
      this.error(`Failed to remove ${BRV_DIR}/: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  protected async confirmReInitialization(config: BrvConfig): Promise<boolean> {
    this.log('\n Project is already initialized')
    this.log(`  Team: ${config.teamName}`)
    this.log(`  Space: ${config.spaceName}`)
    this.log(`  Config: ${join(process.cwd(), BRV_DIR, PROJECT_CONFIG_FILE)}`)
    this.log('\n Re-initializing will:')
    this.log(`  - Remove the entire ${BRV_DIR}/ directory and all its contents`)
    this.log('  - Allow you to select a new team/space')
    this.log('  - Create a fresh configuration and ACE playbook')
    this.log('  - Regenerate rule instructions\n')
    return confirm({
      default: false,
      message: 'Continue with re-initialization?',
    })
  }

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
    const {flags} = await this.parse(Init)

    try {
      const {playbookService, projectConfigStore, spaceService, teamService, tokenStore, trackingService} =
        this.createServices()

      const alreadyInitialized = await projectConfigStore.exists()
      if (alreadyInitialized) {
        const currentConfig = await projectConfigStore.read()
        if (currentConfig === undefined) {
          this.error('Configuration file exists but cannot be read. Please check .brv/config.json')
        }

        if (!flags.force) {
          const confirmed = await this.confirmReInitialization(currentConfig)
          if (!confirmed) {
            this.log('\nCancelled. Project configuration unchanged.')
            return
          }
        }

        try {
          await this.cleanupBeforeReInitialization()
        } catch (error) {
          this.error(`Failed to clean up existing data: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }

        this.log('\n') // Spacing before continuing with init flow
      }

      this.log('Initializing ByteRover project...\n')

      const token = await tokenStore.load()
      if (token === undefined) {
        this.error('Not authenticated. Please run "brv login" first.')
      }

      if (!token.isValid()) {
        this.error('Authentication token expired. Please run "brv login" again.')
      }

      ux.action.start('Fetching all teams')
      const teamResult = await teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
      ux.action.stop()

      const {teams} = teamResult

      if (teams.length === 0) {
        this.log('No teams found.')
        this.log(`Please visit ${getCurrentConfig().webAppUrl} to create your first team.`)
        return
      }

      this.log()
      const selectedTeam = await this.promptForTeamSelection(teams)

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

      this.log()
      const selectedSpace = await this.promptForSpaceSelection(spaces)

      const config = BrvConfig.fromSpace(selectedSpace)
      await projectConfigStore.write(config)

      this.log('\nInitializing ACE context...')
      try {
        const playbookPath = await playbookService.initialize()
        this.log(`✓ ACE playbook initialized in ${playbookPath}`)
      } catch (error) {
        // Warn but don't fail if ACE init fails
        this.warn(`ACE initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      this.log(`\nGenerate rule instructions for coding agents to work with ByteRover correctly`)
      this.log()
      await this.config.runCommand('gen-rules')

      await trackingService.track('space:init')

      this.log(`\n✓ Project initialized successfully!`)
      this.log(`✓ Connected to space: ${selectedSpace.getDisplayName()}`)
      this.log(`✓ Configuration saved to: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Initialization failed')
    }
  }
}
