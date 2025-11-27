import {confirm, search, select} from '@inquirer/prompts'
import {Command, Flags, ux} from '@oclif/core'
import {rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {AuthToken} from '../core/domain/entities/auth-token.js'
import type {Space} from '../core/domain/entities/space.js'
import type {Team} from '../core/domain/entities/team.js'
import type {IContextTreeService} from '../core/interfaces/i-context-tree-service.js'
import type {IPlaybookService} from '../core/interfaces/i-playbook-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {IRuleWriterService} from '../core/interfaces/i-rule-writer-service.js'
import type {ISpaceService} from '../core/interfaces/i-space-service.js'
import type {ITeamService} from '../core/interfaces/i-team-service.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {BRV_DIR, PROJECT_CONFIG_FILE} from '../constants.js'
import {type Agent, AGENT_VALUES} from '../core/domain/entities/agent.js'
import {BrvConfig} from '../core/domain/entities/brv-config.js'
import {RuleExistsError} from '../core/domain/errors/rule-error.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {FilePlaybookService} from '../infra/playbook/file-playbook-service.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
import {RuleWriterService} from '../infra/rule/rule-writer-service.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../infra/team/http-team-service.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {WorkspaceDetectorService} from '../infra/workspace/workspace-detector-service.js'

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
      throw new Error(`Failed to remove ${BRV_DIR}/: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
    contextTreeService: IContextTreeService
    playbookService: IPlaybookService
    projectConfigStore: IProjectConfigStore
    ruleWriterService: IRuleWriterService
    spaceService: ISpaceService
    teamService: ITeamService
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const ruleTemplateService = new RuleTemplateService(templateLoader)

    return {
      contextTreeService: new FileContextTreeService(),
      playbookService: new FilePlaybookService(),
      projectConfigStore: new ProjectConfigStore(),
      ruleWriterService: new RuleWriterService(fileService, ruleTemplateService),
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

  protected detectWorkspacesForAgent(agent: Agent): {chatLogPath: string; cwd: string} {
    const detector = new WorkspaceDetectorService()
    const result = detector.detectWorkspaces(agent)
    return {
      chatLogPath: result.chatLogPath,
      cwd: result.cwd,
    }
  }

  protected async ensureAuthenticated(tokenStore: ITokenStore): Promise<AuthToken> {
    const token = await tokenStore.load()

    if (token === undefined) {
      this.error('Not authenticated. Please run "brv login" first.')
    }

    if (!token.isValid()) {
      this.error('Authentication token expired. Please run "brv login" again.')
    }

    return token
  }

  protected async fetchAndSelectSpace(
    spaceService: ISpaceService,
    token: AuthToken,
    team: Team,
  ): Promise<Space | undefined> {
    ux.action.start('Fetching all spaces')
    const {spaces} = await spaceService.getSpaces(token.accessToken, token.sessionKey, team.id, {fetchAll: true})
    ux.action.stop()

    if (spaces.length === 0) {
      this.log(`No spaces found in team "${team.getDisplayName()}"`)
      this.log(`Please visit ${getCurrentConfig().webAppUrl} to create your first space for ${team.getDisplayName()}.`)
      return undefined
    }

    this.log()
    return this.promptForSpaceSelection(spaces)
  }

  protected async fetchAndSelectTeam(teamService: ITeamService, token: AuthToken): Promise<Team | undefined> {
    ux.action.start('Fetching all teams')
    const {teams} = await teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
    ux.action.stop()

    if (teams.length === 0) {
      this.log('No teams found.')
      this.log(`Please visit ${getCurrentConfig().webAppUrl} to create your first team.`)
      return undefined
    }

    this.log()
    return this.promptForTeamSelection(teams)
  }

  protected async generateRulesForAgent(ruleWriterService: IRuleWriterService, agent: Agent): Promise<void> {
    this.log(`Generating rules for: ${agent}`)

    try {
      await ruleWriterService.writeRule(agent, false)
      this.log(`✅ Successfully generated rule file for ${agent}`)
    } catch (error) {
      if (error instanceof RuleExistsError) {
        const overwrite = await this.promptForOverwriteConfirmation(agent)

        if (overwrite) {
          await ruleWriterService.writeRule(agent, true)
          this.log(`✅ Successfully generated rule file for ${agent}`)
        } else {
          this.log(`Skipping rule file generation for ${agent}`)
        }
      } else {
        throw error
      }
    }
  }

  protected async getExistingConfig(projectConfigStore: IProjectConfigStore): Promise<BrvConfig | undefined> {
    const exists = await projectConfigStore.exists()
    if (exists) {
      const config = await projectConfigStore.read()
      if (config === undefined) {
        throw new Error('Configuration file exists but cannot be read. Please check .brv/config.json')
      }

      return config
    }

    return undefined
  }

  protected async initializeMemoryContextDir(name: string, initFn: () => Promise<string>): Promise<void> {
    this.log(`\nInitializing ${name}...`)
    try {
      const path = await initFn()
      this.log(`✓ ${name} initialized in ${path}`)
    } catch (error) {
      this.warn(`${name} initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`)
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

  /**
   * Prompts the user to confirm overwriting an existing rule file.
   * This method is protected to allow test overrides.
   */
  protected async promptForOverwriteConfirmation(agent: Agent): Promise<boolean> {
    return confirm({
      default: true,
      message: `Rule file already exists for ${agent}. Overwrite?`,
    })
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
      const {flags} = await this.parse(Init)

      const {
        contextTreeService,
        playbookService,
        projectConfigStore,
        ruleWriterService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
      } = this.createServices()

      const authToken = await this.ensureAuthenticated(tokenStore)

      const existingConfig = await this.getExistingConfig(projectConfigStore)
      if (existingConfig) {
        const shouldCleanup = flags.force ? true : await this.confirmReInitialization(existingConfig)

        if (shouldCleanup) {
          await this.cleanupBeforeReInitialization()
          this.log('\n')
        } else {
          this.log('\nCancelled. Project configuration unchanged.')
          return
        }
      }

      this.log('Initializing ByteRover project...\n')

      const selectedTeam = await this.fetchAndSelectTeam(teamService, authToken)
      if (!selectedTeam) return

      const selectedSpace = await this.fetchAndSelectSpace(spaceService, authToken, selectedTeam)
      if (!selectedSpace) return

      await this.initializeMemoryContextDir('ACE context', () => playbookService.initialize())
      await this.initializeMemoryContextDir('context tree', () => contextTreeService.initialize())

      this.log()
      const selectedAgent = await this.promptForAgentSelection()

      this.log('Detecting workspaces...')
      const {chatLogPath, cwd} = this.detectWorkspacesForAgent(selectedAgent)
      this.log(`✓ Detected workspace: ${cwd}`)

      const config = BrvConfig.fromSpace({
        chatLogPath,
        cwd,
        ide: selectedAgent,
        space: selectedSpace,
      })
      await projectConfigStore.write(config)

      this.log(`\nGenerate rule instructions for coding agents to work with ByteRover correctly`)
      this.log()
      await this.generateRulesForAgent(ruleWriterService, selectedAgent)

      await trackingService.track('rule:generate')
      await trackingService.track('space:init')

      this.log('\nInitialization complete!')
      this.log(
        "Note: It's recommended to add .brv/ to your .gitignore file since ByteRover already takes care of memory/context versioning for you.",
      )

      this.logSuccess(selectedSpace)
    } catch (error) {
      this.error(`Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private logSuccess(space: Space): void {
    this.log(`\n✓ Project initialized successfully!`)
    this.log(`✓ Connected to space: ${space.getDisplayName()}`)
    this.log(`✓ Configuration saved to: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
  }
}
