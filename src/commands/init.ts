import {confirm, search, select} from '@inquirer/prompts'
import {Command, Flags, ux} from '@oclif/core'
import {access, readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {AuthToken} from '../core/domain/entities/auth-token.js'
import type {Space} from '../core/domain/entities/space.js'
import type {Team} from '../core/domain/entities/team.js'
import type {ICogitPullService} from '../core/interfaces/i-cogit-pull-service.js'
import type {IContextTreeService} from '../core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../core/interfaces/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../core/interfaces/i-context-tree-writer-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../core/interfaces/i-space-service.js'
import type {ITeamService} from '../core/interfaces/i-team-service.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {ACE_DIR, BRV_CONFIG_VERSION, BRV_DIR, DEFAULT_BRANCH, PROJECT_CONFIG_FILE} from '../constants.js'
import {type Agent, AGENT_VALUES} from '../core/domain/entities/agent.js'
import {BrvConfig} from '../core/domain/entities/brv-config.js'
import {BrvConfigVersionError} from '../core/domain/errors/brv-config-version-error.js'
import {IFileService, WriteMode} from '../core/interfaces/i-file-service.js'
import {ILegacyRuleDetector, LegacyRuleMatch, UncertainMatch} from '../core/interfaces/i-legacy-rule-detector.js'
import {IRuleTemplateService} from '../core/interfaces/i-rule-template-service.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {HttpCogitPullService} from '../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../infra/context-tree/file-context-tree-writer-service.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {AGENT_RULE_CONFIGS} from '../infra/rule/agent-rule-config.js'
import {BRV_RULE_MARKERS, BRV_RULE_TAG} from '../infra/rule/constants.js'
import {LegacyRuleDetector} from '../infra/rule/legacy-rule-detector.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../infra/team/http-team-service.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {WorkspaceDetectorService} from '../infra/workspace/workspace-detector-service.js'

type CleanupStrategy = 'automatic' | 'manual'

/**
 * Represents a legacy config that exists but has version issues.
 * Used to display config info during re-initialization prompt.
 */
export type LegacyProjectConfigInfo = {
  /**
   * undefined = missing, string = mismatched
   */
  currentVersion: string | undefined
  spaceName: string
  teamName: string
  type: 'legacy'
}

export default class Init extends Command {
  public static description = `Initialize a project with ByteRover (creates ${BRV_DIR}/${PROJECT_CONFIG_FILE} with team/space selection and initializes Context Tree)`
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

  protected async aceDirectoryExists(baseDir?: string): Promise<boolean> {
    const dir = baseDir ?? process.cwd()
    const acePath = join(dir, BRV_DIR, ACE_DIR)
    try {
      await access(acePath)
      return true
    } catch {
      return false
    }
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

  protected async confirmReInitialization(config: BrvConfig | LegacyProjectConfigInfo): Promise<boolean> {
    if (this.isLegacyProjectConfig(config)) {
      const versionStatus =
        config.currentVersion === undefined ? 'missing' : `${config.currentVersion} → ${BRV_CONFIG_VERSION}`
      this.log(`\n⚠️  Project has an outdated configuration (version: ${versionStatus})`)
    } else {
      this.log('\n Project is already initialized')
    }

    this.log(`  Team: ${config.teamName}`)
    this.log(`  Space: ${config.spaceName}`)
    this.log(`  Config: ${join(process.cwd(), BRV_DIR, PROJECT_CONFIG_FILE)}`)
    this.log('\n Re-initializing will:')
    this.log(`  - Remove the entire ${BRV_DIR}/ directory and all its contents`)
    this.log('  - Allow you to select a new team/space')
    this.log('  - Create a fresh configuration and Context Tree')
    this.log('  - Regenerate rule instructions\n')
    return confirm({
      default: false,
      message: 'Continue with re-initialization?',
    })
  }

  protected createServices(): {
    cogitPullService: ICogitPullService
    contextTreeService: IContextTreeService
    contextTreeSnapshotService: IContextTreeSnapshotService
    contextTreeWriterService: IContextTreeWriterService
    fileService: IFileService
    legacyRuleDetector: ILegacyRuleDetector
    projectConfigStore: IProjectConfigStore
    // ruleWriterService: IRuleWriterService
    spaceService: ISpaceService
    teamService: ITeamService
    templateService: IRuleTemplateService
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const ruleTemplateService = new RuleTemplateService(templateLoader)

    const legacyRuleDetector = new LegacyRuleDetector()

    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    return {
      cogitPullService: new HttpCogitPullService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService,
      contextTreeWriterService: new FileContextTreeWriterService({snapshotService: contextTreeSnapshotService}),
      fileService,
      legacyRuleDetector,
      projectConfigStore: new ProjectConfigStore(),
      // ruleWriterService: new RuleWriterService(fileService, ruleTemplateService),
      spaceService: new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      teamService: new HttpTeamService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      templateService: ruleTemplateService,
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
    ux.action.start('\nFetching all spaces')
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

  protected async generateRulesForAgent(
    selectedAgent: Agent,
    fileService: IFileService,
    templateService: IRuleTemplateService,
    legacyRuleDetector: ILegacyRuleDetector,
  ): Promise<void> {
    this.log(`Generating rules for: ${selectedAgent}`)

    // try {
    //   await ruleWriterService.writeRule(agent, false)
    //   this.log(`✅ Successfully generated rule file for ${agent}`)
    // } catch (error) {
    //   if (error instanceof RuleExistsError) {
    //     const overwrite = await this.promptForOverwriteConfirmation(agent)

    //     if (overwrite) {
    //       await ruleWriterService.writeRule(agent, true)
    //       this.log(`✅ Successfully generated rule file for ${agent}`)
    //     } else {
    //       this.log(`Skipping rule file generation for ${agent}`)
    //     }
    //   } else {
    //     throw error
    //   }
    // }
    const {filePath, writeMode} = AGENT_RULE_CONFIGS[selectedAgent]

    // STEP 1: Check if file exists
    const fileExists = await fileService.exists(filePath)

    if (!fileExists) {
      // Scenario A: File doesn't exist
      const shouldCreate = await this.promptForFileCreation(selectedAgent, filePath)
      if (!shouldCreate) {
        this.log(`Skipped rule file creation for ${selectedAgent}`)
        return
      }

      await this.createNewRuleFile({
        agent: selectedAgent,
        filePath,
        fileService,
        templateService,
      })
      return
    }

    // STEP 2: File exists - read content
    const content = await fileService.read(filePath)

    // STEP 3: Check for LEGACY rules (priority: clean these up first)
    const hasFooterTag = content.includes(`${BRV_RULE_TAG} ${selectedAgent}`)
    const hasBoundaryMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)
    const hasLegacyRules = hasFooterTag && !hasBoundaryMarkers

    if (hasLegacyRules) {
      // Scenario B: Legacy rules detected - handle cleanup
      await this.handleLegacyRulesCleanup({
        agent: selectedAgent,
        content,
        filePath,
        fileService,
        legacyRuleDetector,
        templateService,
      })
      return
    }

    // STEP 4: Check for NEW rules (boundary markers)
    if (hasBoundaryMarkers) {
      // Scenario C: New rules exist - prompt for overwrite
      const shouldOverwrite = await this.promptForOverwriteConfirmation(selectedAgent)
      if (!shouldOverwrite) {
        this.log(`Skipped rule file update for ${selectedAgent}`)
        return
      }

      await this.replaceExistingRules({
        agent: selectedAgent,
        content,
        filePath,
        fileService,
        templateService,
        writeMode,
      })
      return
    }

    // STEP 5: No ByteRover content - append rules
    await this.appendRulesToFile({
      agent: selectedAgent,
      filePath,
      fileService,
      templateService,
      writeMode,
    })
  }

  protected async getExistingConfig(
    projectConfigStore: IProjectConfigStore,
  ): Promise<BrvConfig | LegacyProjectConfigInfo | undefined> {
    const exists = await projectConfigStore.exists()
    if (!exists) return undefined

    try {
      const projectConfig = await projectConfigStore.read()
      if (projectConfig === undefined) {
        throw new Error('Configuration file exists but cannot be read. Please check .brv/config.json')
      }

      return projectConfig
    } catch (error) {
      if (error instanceof BrvConfigVersionError) {
        // Legacy/outdated config - read raw JSON for display info
        const configPath = join(process.cwd(), BRV_DIR, PROJECT_CONFIG_FILE)
        const content = await readFile(configPath, 'utf8')
        // As type assertion here since rawJson is default to any/unknown anyway
        const rawJson = JSON.parse(content) as Record<string, unknown>
        return {
          currentVersion: error.currentVersion,
          spaceName: typeof rawJson.spaceName === 'string' ? rawJson.spaceName : 'Unknown',
          teamName: typeof rawJson.teamName === 'string' ? rawJson.teamName : 'Unknown',
          type: 'legacy',
        }
      }

      // Re-throw other errors
      throw error
    }
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

  protected isLegacyProjectConfig(config: BrvConfig | LegacyProjectConfigInfo): config is LegacyProjectConfigInfo {
    return 'type' in config && config.type === 'legacy'
  }

  /**
   * Checks if the given path represents a README.md placeholder file.
   * Handles both legacy paths with leading slash and new paths without.
   */
  protected isReadmePlaceholder(path: string): boolean {
    const normalizedPath = path.replace(/^\/+/, '')
    return normalizedPath === 'README.md'
  }

  protected async promptAceDeprecationRemoval(): Promise<boolean> {
    this.log('\n The ACE system is being deprecated.')
    this.log(' ByteRover is migrating to the new Context Tree system for improved')
    this.log(' memory organization and retrieval.')
    this.log('')
    this.log(' We detected an existing ACE folder at .brv/ace/')
    this.log(' This folder and all its contents can be safely removed.\n')

    return confirm({
      default: true,
      message: 'Remove the ACE folder and its contents?',
    })
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
   * Prompts the user to choose cleanup strategy for legacy rules.
   * This method is protected to allow test overrides.
   * @returns The chosen cleanup strategy
   */
  protected async promptForCleanupStrategy(): Promise<CleanupStrategy> {
    return select({
      choices: [
        {
          description:
            'New rules will be added with boundary markers. You manually remove old sections at your convenience.',
          name: 'Manual cleanup (recommended)',
          value: 'manual' as CleanupStrategy,
        },
        {
          description:
            '⚠️  We will remove all detected old sections. May cause content loss if detection is imperfect. A backup will be created.',
          name: 'Automatic cleanup',
          value: 'automatic' as CleanupStrategy,
        },
      ],
      message: 'How would you like to proceed?',
    })
  }

  /**
   * Prompts the user to create a new rule file.
   * This method is protected to allow test overrides.
   * @param agent The agent for which the rule file doesn't exist
   * @param filePath The path where the file would be created
   * @returns True if the user wants to create the file, false otherwise
   */
  protected async promptForFileCreation(agent: Agent, filePath: string): Promise<boolean> {
    return confirm({
      default: true,
      message: `Rule file '${filePath}' doesn't exist. Create it with ByteRover rules?`,
    })
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

  protected async removeAceDirectory(baseDir?: string): Promise<void> {
    const dir = baseDir ?? process.cwd()
    const acePath = join(dir, BRV_DIR, ACE_DIR)
    await rm(acePath, {force: true, recursive: true})
  }

  public async run(): Promise<void> {
    try {
      const {flags} = await this.parse(Init)

      const {
        cogitPullService,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        projectConfigStore,
        // ruleWriterService,
        spaceService,
        teamService,
        templateService,
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

      // Handle ACE deprecation - check for existing ACE folder and offer removal
      const aceExists = await this.aceDirectoryExists()
      if (aceExists) {
        const shouldRemoveAce = await this.promptAceDeprecationRemoval()
        if (shouldRemoveAce) {
          await this.removeAceDirectory()
          this.log('✓ ACE folder removed')
        }
      }

      // Sync from remote or initialize context tree with templates
      await this.syncFromRemoteOrInitialize({
        cogitPullService,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        projectConfig: {spaceId: selectedSpace.id, teamId: selectedTeam.id},
        token: authToken,
      })

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
      await this.generateRulesForAgent(selectedAgent, fileService, templateService, legacyRuleDetector)

      await trackingService.track('rule:generate')
      await trackingService.track('space:init')

      this.logSuccess(selectedSpace)
    } catch (error) {
      this.error(`Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  protected async syncFromRemoteOrInitialize(params: {
    cogitPullService: ICogitPullService
    contextTreeService: IContextTreeService
    contextTreeSnapshotService: IContextTreeSnapshotService
    contextTreeWriterService: IContextTreeWriterService
    projectConfig: {spaceId: string; teamId: string}
    token: AuthToken
  }): Promise<void> {
    // Pull from remote - fail if network/API error
    this.log('\nSyncing from ByteRover...')
    try {
      const coGitSnapshot = await params.cogitPullService.pull({
        accessToken: params.token.accessToken,
        branch: DEFAULT_BRANCH,
        sessionKey: params.token.sessionKey,
        spaceId: params.projectConfig.spaceId,
        teamId: params.projectConfig.teamId,
      })

      // Check if space is "empty" (no files, or only README.md placeholder)
      // CoGit follows Git semantics - empty repos have a README.md placeholder
      const isEmptySpace =
        coGitSnapshot.files.length === 0 ||
        (coGitSnapshot.files.length === 1 && this.isReadmePlaceholder(coGitSnapshot.files[0].path))

      if (isEmptySpace) {
        // Remote is empty - ignore placeholder, create templates with empty snapshot
        await this.initializeMemoryContextDir('context tree', () => params.contextTreeService.initialize())
        await params.contextTreeSnapshotService.initEmptySnapshot()
        this.log('✓ Context tree initialized')
      } else {
        // Remote has real data - sync it to local
        await params.contextTreeWriterService.sync({files: [...coGitSnapshot.files]})
        await params.contextTreeSnapshotService.saveSnapshot()
        this.log(`✓ Synced ${coGitSnapshot.files.length} context files from remote`)
      }
    } catch (error) {
      throw new Error(
        `Failed to sync from ByteRover: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
      )
    }
  }

  /**
   * Appends ByteRover rules to a file that has no ByteRover content.
   */
  private async appendRulesToFile(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    templateService: IRuleTemplateService
    writeMode: WriteMode
  }): Promise<void> {
    const {agent, filePath, fileService, templateService, writeMode} = params
    const ruleContent = await templateService.generateRuleContent(agent)

    // For dedicated ByteRover files, overwrite; for shared instruction files, append
    const mode = writeMode === 'overwrite' ? 'overwrite' : 'append'
    await fileService.write(ruleContent, filePath, mode)

    this.log(`✅ Successfully added rule file for ${agent}`)
  }

  /**
   * Creates a new rule file with ByteRover rules.
   */
  private async createNewRuleFile(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, filePath, fileService, templateService} = params
    const ruleContent = await templateService.generateRuleContent(agent)
    await fileService.write(ruleContent, filePath, 'overwrite')
    this.log(`✅ Successfully created rule file for ${agent} at ${filePath}`)
  }

  private async handleLegacyRulesCleanup(params: {
    agent: Agent
    content: string
    filePath: string
    fileService: IFileService
    legacyRuleDetector: ILegacyRuleDetector
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, content, filePath, fileService, legacyRuleDetector, templateService} = params
    const detectionResult = legacyRuleDetector.detectLegacyRules(content, agent)
    const {reliableMatches, uncertainMatches} = detectionResult

    this.log(
      `\n⚠️  Detected ${
        reliableMatches.length + uncertainMatches.length
      } old ByteRover rule section(s) in ${filePath}:\n`,
    )

    if (reliableMatches.length > 0) {
      this.log('Reliable matches:')
      for (const [index, match] of reliableMatches.entries()) {
        this.log(`  Section ${index + 1}: lines ${match.startLine}-${match.endLine}`)
      }

      this.log()
    }

    if (uncertainMatches.length > 0) {
      this.log('  ⚠️  Uncertain matches (cannot determine start):')
      for (const match of uncertainMatches) {
        this.log(`  Footer found at line ${match.footerLine}`)
        this.log(`  Reason: ${match.reason}`)
      }

      this.log()
      this.log('⚠️  Due to uncertain matches, only manual cleanup is available.\n')
      await this.performManualCleanup({
        agent,
        filePath,
        fileService,
        reliableMatches,
        templateService,
        uncertainMatches,
      })
      return
    }

    const selectedStrategy = await this.promptForCleanupStrategy()
    await (selectedStrategy === 'manual'
      ? this.performManualCleanup({
          agent,
          filePath,
          fileService,
          reliableMatches,
          templateService,
          uncertainMatches,
        })
      : this.performAutomaticCleanup({
          agent,
          filePath,
          fileService,
          reliableMatches,
          templateService,
        }))
  }

  private logSuccess(space: Space): void {
    this.log(`\n✓ Project initialized successfully!`)
    this.log(`✓ Connected to space: ${space.getDisplayName()}`)
    this.log(`✓ Configuration saved to: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
    this.log(
      "NOTE: It's recommended to add .brv/ to your .gitignore file since ByteRover already takes care of memory/context versioning for you.",
    )
  }

  private async performAutomaticCleanup(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    reliableMatches: LegacyRuleMatch[]
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, filePath, fileService, reliableMatches, templateService} = params
    const backupPath = await fileService.createBackup(filePath)
    this.log(`📦 Backup created: ${backupPath}`)
    let content = await fileService.read(filePath)
    // Remove all reliable matches (in reverse order to preserve line numbers)
    const sortedMatches = [...reliableMatches].sort((a, b) => b.startLine - a.startLine)
    for (const match of sortedMatches) {
      content = content.replace(match.content, '')
    }

    // Write cleaned content
    await fileService.write(content, filePath, 'overwrite')
    // Append new rules
    const ruleContent = await templateService.generateRuleContent(agent)
    await fileService.write(ruleContent, filePath, 'append')
    this.log(`✅ Removed ${reliableMatches.length} old ByteRover section(s)`)
    this.log(`✅ Added new rules with boundary markers`)
    this.log(`\nYou can safely delete the backup file once verified.`)
  }

  private async performManualCleanup(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    reliableMatches: LegacyRuleMatch[]
    templateService: IRuleTemplateService
    uncertainMatches: UncertainMatch[]
  }): Promise<void> {
    const {agent, filePath, fileService, reliableMatches, templateService, uncertainMatches} = params
    const ruleContent = await templateService.generateRuleContent(agent)
    await fileService.write(ruleContent, filePath, 'append')
    this.log(`✅ New ByteRover rules added with boundary markers\n`)
    this.log('Please manually remove old sections:')
    for (const [index, match] of reliableMatches.entries()) {
      this.log(`  - Section ${index + 1}: lines ${match.startLine}-${match.endLine} in ${filePath}`)
    }

    for (const match of uncertainMatches) {
      this.log(`  - Section ending at line ${match.footerLine} in ${filePath}`)
    }

    this.log('\nKeep only the section between:')
    this.log('  <!-- BEGIN BYTEROVER RULES -->')
    this.log('  <!-- END BYTEROVER RULES -->')
  }

  /**
   * Replaces existing ByteRover rules (with boundary markers) with new rules.
   */
  private async replaceExistingRules(params: {
    agent: Agent
    content: string
    filePath: string
    fileService: IFileService
    templateService: IRuleTemplateService
    writeMode: WriteMode
  }): Promise<void> {
    const {agent, content, filePath, fileService, templateService, writeMode} = params
    const ruleContent = await templateService.generateRuleContent(agent)

    if (writeMode === 'overwrite') {
      // For dedicated ByteRover files, just overwrite the entire file
      await fileService.write(ruleContent, filePath, 'overwrite')
    } else {
      // For shared instruction files, replace the section between markers
      const startMarker = BRV_RULE_MARKERS.START
      const endMarker = BRV_RULE_MARKERS.END
      const startIndex = content.indexOf(startMarker)
      const endIndex = content.indexOf(endMarker, startIndex)

      if (startIndex === -1 || endIndex === -1) {
        this.error('Could not find boundary markers in the file')
      }

      const before = content.slice(0, startIndex)
      const after = content.slice(endIndex + endMarker.length)
      const newContent = before + ruleContent + after

      await fileService.write(newContent, filePath, 'overwrite')
    }

    this.log(`✅ Successfully updated rule file for ${agent}`)
  }
}
