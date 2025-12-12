import {access, readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {Space} from '../../core/domain/entities/space.js'
import type {Team} from '../../core/domain/entities/team.js'
import type {ICogitPullService} from '../../core/interfaces/i-cogit-pull-service.js'
import type {IContextTreeService} from '../../core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../core/interfaces/i-context-tree-writer-service.js'
import type {IFileService, WriteMode} from '../../core/interfaces/i-file-service.js'
import type {ILegacyRuleDetector, LegacyRuleMatch, UncertainMatch} from '../../core/interfaces/i-legacy-rule-detector.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {IRuleTemplateService} from '../../core/interfaces/i-rule-template-service.js'
import type {ISpaceService} from '../../core/interfaces/i-space-service.js'
import type {ITeamService} from '../../core/interfaces/i-team-service.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IInitUseCase} from '../../core/interfaces/usecase/i-init-use-case.js'

import {getCurrentConfig} from '../../config/environment.js'
import {ACE_DIR, BRV_CONFIG_VERSION, BRV_DIR, DEFAULT_BRANCH, PROJECT_CONFIG_FILE} from '../../constants.js'
import {type Agent, AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {BrvConfigVersionError} from '../../core/domain/errors/brv-config-version-error.js'
import {AGENT_RULE_CONFIGS} from '../rule/agent-rule-config.js'
import {BRV_RULE_MARKERS, BRV_RULE_TAG} from '../rule/constants.js'
import {WorkspaceDetectorService} from '../workspace/workspace-detector-service.js'

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

export interface InitUseCaseOptions {
  cogitPullService: ICogitPullService
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  fileService: IFileService
  legacyRuleDetector: ILegacyRuleDetector
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  teamService: ITeamService
  templateService: IRuleTemplateService
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
}

export class InitUseCase implements IInitUseCase {
  protected readonly cogitPullService: ICogitPullService
  protected readonly contextTreeService: IContextTreeService
  protected readonly contextTreeSnapshotService: IContextTreeSnapshotService
  protected readonly contextTreeWriterService: IContextTreeWriterService
  protected readonly fileService: IFileService
  protected readonly legacyRuleDetector: ILegacyRuleDetector
  protected readonly projectConfigStore: IProjectConfigStore
  protected readonly spaceService: ISpaceService
  protected readonly teamService: ITeamService
  protected readonly templateService: IRuleTemplateService
  protected readonly terminal: ITerminal
  protected readonly tokenStore: ITokenStore
  protected readonly trackingService: ITrackingService

  constructor(options: InitUseCaseOptions) {
    this.cogitPullService = options.cogitPullService
    this.contextTreeService = options.contextTreeService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.contextTreeWriterService = options.contextTreeWriterService
    this.fileService = options.fileService
    this.legacyRuleDetector = options.legacyRuleDetector
    this.projectConfigStore = options.projectConfigStore
    this.spaceService = options.spaceService
    this.teamService = options.teamService
    this.templateService = options.templateService
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
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
    this.terminal.log('\n Cleaning up existing ByteRover directory...')
    this.terminal.actionStart(`  Removing ${BRV_DIR}/`)
    try {
      await rm(brvDir, {force: true, recursive: true})
      this.terminal.actionStop('✓')
    } catch (error) {
      this.terminal.actionStop('✗')
      throw new Error(`Failed to remove ${BRV_DIR}/: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  protected async confirmReInitialization(config: BrvConfig | LegacyProjectConfigInfo): Promise<boolean> {
    if (this.isLegacyProjectConfig(config)) {
      const versionStatus =
        config.currentVersion === undefined ? 'missing' : `${config.currentVersion} → ${BRV_CONFIG_VERSION}`
      this.terminal.log(`\n⚠️  Project has an outdated configuration (version: ${versionStatus})`)
    } else {
      this.terminal.log('\n Project is already initialized')
    }

    this.terminal.log(`  Team: ${config.teamName}`)
    this.terminal.log(`  Space: ${config.spaceName}`)
    this.terminal.log(`  Config: ${join(process.cwd(), BRV_DIR, PROJECT_CONFIG_FILE)}`)
    this.terminal.log('\n Re-initializing will:')
    this.terminal.log(`  - Remove the entire ${BRV_DIR}/ directory and all its contents`)
    this.terminal.log('  - Allow you to select a new team/space')
    this.terminal.log('  - Create a fresh configuration and Context Tree')
    this.terminal.log('  - Regenerate rule instructions\n')
    return this.terminal.confirm({
      default: false,
      message: 'Continue with re-initialization?',
    })
  }

  protected detectWorkspacesForAgent(agent: Agent): {chatLogPath: string; cwd: string} {
    const detector = new WorkspaceDetectorService()
    const result = detector.detectWorkspaces(agent)
    return {
      chatLogPath: result.chatLogPath,
      cwd: result.cwd,
    }
  }

  protected async ensureAuthenticated(): Promise<AuthToken | undefined> {
    const token = await this.tokenStore.load()

    if (token === undefined) {
      this.terminal.log('Not authenticated. Please run "brv login" first.')
      return undefined
    }

    if (!token.isValid()) {
      this.terminal.log('Authentication token expired. Please run "brv login" again.')
      return undefined
    }

    return token
  }

  protected async fetchAndSelectSpace(token: AuthToken, team: Team): Promise<Space | undefined> {
    this.terminal.actionStart('\nFetching all spaces')
    const {spaces} = await this.spaceService.getSpaces(token.accessToken, token.sessionKey, team.id, {fetchAll: true})
    this.terminal.actionStop()

    if (spaces.length === 0) {
      this.terminal.log(`No spaces found in team "${team.getDisplayName()}"`)
      this.terminal.log(
        `Please visit ${getCurrentConfig().webAppUrl} to create your first space for ${team.getDisplayName()}.`,
      )
      return undefined
    }

    this.terminal.log()
    return this.promptForSpaceSelection(spaces)
  }

  protected async fetchAndSelectTeam(token: AuthToken): Promise<Team | undefined> {
    this.terminal.actionStart('Fetching all teams')
    const {teams} = await this.teamService.getTeams(token.accessToken, token.sessionKey, {fetchAll: true})
    this.terminal.actionStop()

    if (teams.length === 0) {
      this.terminal.log('No teams found.')
      this.terminal.log(`Please visit ${getCurrentConfig().webAppUrl} to create your first team.`)
      return undefined
    }

    this.terminal.log()
    return this.promptForTeamSelection(teams)
  }

  protected async generateRulesForAgent(selectedAgent: Agent): Promise<void> {
    this.terminal.log(`Generating rules for: ${selectedAgent}`)

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
    const fileExists = await this.fileService.exists(filePath)

    if (!fileExists) {
      // Scenario A: File doesn't exist
      const shouldCreate = await this.promptForFileCreation(selectedAgent, filePath)
      if (!shouldCreate) {
        this.terminal.log(`Skipped rule file creation for ${selectedAgent}`)
        return
      }

      await this.createNewRuleFile({
        agent: selectedAgent,
        filePath,
      })
      return
    }

    // STEP 2: File exists - read content
    const content = await this.fileService.read(filePath)

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
      })
      return
    }

    // STEP 4: Check for NEW rules (boundary markers)
    if (hasBoundaryMarkers) {
      // Scenario C: New rules exist - prompt for overwrite
      const shouldOverwrite = await this.promptForOverwriteConfirmation(selectedAgent)
      if (!shouldOverwrite) {
        this.terminal.log(`Skipped rule file update for ${selectedAgent}`)
        return
      }

      await this.replaceExistingRules({
        agent: selectedAgent,
        content,
        filePath,
        writeMode,
      })
      return
    }

    // STEP 5: No ByteRover content - append rules
    await this.appendRulesToFile({
      agent: selectedAgent,
      filePath,
      writeMode,
    })
  }

  protected async getExistingConfig(): Promise<BrvConfig | LegacyProjectConfigInfo | undefined> {
    const exists = await this.projectConfigStore.exists()
    if (!exists) return undefined

    try {
      const projectConfig = await this.projectConfigStore.read()
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
    this.terminal.log(`\nInitializing ${name}...`)
    try {
      const path = await initFn()
      this.terminal.log(`✓ ${name} initialized in ${path}`)
    } catch (error) {
      this.terminal.warn(`${name} initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
    this.terminal.log('\n The ACE system is being deprecated.')
    this.terminal.log(' ByteRover is migrating to the new Context Tree system for improved')
    this.terminal.log(' memory organization and retrieval.')
    this.terminal.log('')
    this.terminal.log(' We detected an existing ACE folder at .brv/ace/')
    this.terminal.log(' This folder and all its contents can be safely removed.\n')

    return this.terminal.confirm({
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
    return this.terminal.search({
      message: 'Which agent you are using (type to search):',
      source(input) {
        if (!input) return AGENTS

        return AGENTS.filter(
          (agent) =>
            agent.name.toLowerCase().includes(input.toLowerCase()) ||
            agent.value.toLowerCase().includes(input.toLowerCase()),
        )
      },
    })
  }

  /**
   * Prompts the user to choose cleanup strategy for legacy rules.
   * This method is protected to allow test overrides.
   * @returns The chosen cleanup strategy
   */
  protected async promptForCleanupStrategy(): Promise<CleanupStrategy> {
    return this.terminal.select({
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
    return this.terminal.confirm({
      default: true,
      message: `Rule file '${filePath}' doesn't exist. Create it with ByteRover rules?`,
    })
  }

  /**
   * Prompts the user to confirm overwriting an existing rule file.
   * This method is protected to allow test overrides.
   */
  protected async promptForOverwriteConfirmation(agent: Agent): Promise<boolean> {
    return this.terminal.confirm({
      default: true,
      message: `Rule file already exists for ${agent}. Overwrite?`,
    })
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

  protected async removeAceDirectory(baseDir?: string): Promise<void> {
    const dir = baseDir ?? process.cwd()
    const acePath = join(dir, BRV_DIR, ACE_DIR)
    await rm(acePath, {force: true, recursive: true})
  }

  public async run(options: {force: boolean}): Promise<void> {
    try {
      const authToken = await this.ensureAuthenticated()
      if (!authToken) return

      const existingConfig = await this.getExistingConfig()
      if (existingConfig) {
        const shouldCleanup = options.force ? true : await this.confirmReInitialization(existingConfig)

        if (shouldCleanup) {
          await this.cleanupBeforeReInitialization()
          this.terminal.log('\n')
        } else {
          this.terminal.log('\nCancelled. Project configuration unchanged.')
          return
        }
      }

      this.terminal.log('Initializing ByteRover project...\n')

      const selectedTeam = await this.fetchAndSelectTeam(authToken)
      if (!selectedTeam) return

      const selectedSpace = await this.fetchAndSelectSpace(authToken, selectedTeam)
      if (!selectedSpace) return

      // Handle ACE deprecation - check for existing ACE folder and offer removal
      const aceExists = await this.aceDirectoryExists()
      if (aceExists) {
        const shouldRemoveAce = await this.promptAceDeprecationRemoval()
        if (shouldRemoveAce) {
          await this.removeAceDirectory()
          this.terminal.log('✓ ACE folder removed')
        }
      }

      // Sync from remote or initialize context tree with templates
      await this.syncFromRemoteOrInitialize({
        projectConfig: {spaceId: selectedSpace.id, teamId: selectedTeam.id},
        token: authToken,
      })

      this.terminal.log()
      const selectedAgent = await this.promptForAgentSelection()

      this.terminal.log('Detecting workspaces...')
      const {chatLogPath, cwd} = this.detectWorkspacesForAgent(selectedAgent)
      this.terminal.log(`✓ Detected workspace: ${cwd}`)

      const config = BrvConfig.fromSpace({
        chatLogPath,
        cwd,
        ide: selectedAgent,
        space: selectedSpace,
      })
      await this.projectConfigStore.write(config)

      this.terminal.log(`\nGenerate rule instructions for coding agents to work with ByteRover correctly`)
      this.terminal.log()
      await this.generateRulesForAgent(selectedAgent)

      await this.trackingService.track('rule:generate')
      await this.trackingService.track('space:init')

      this.logSuccess(selectedSpace)
    } catch (error) {
      this.terminal.error(`Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  protected async syncFromRemoteOrInitialize(params: {
    projectConfig: {spaceId: string; teamId: string}
    token: AuthToken
  }): Promise<void> {
    // Pull from remote - fail if network/API error
    this.terminal.log('\nSyncing from ByteRover...')
    try {
      const coGitSnapshot = await this.cogitPullService.pull({
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
        await this.initializeMemoryContextDir('context tree', () => this.contextTreeService.initialize())
        await this.contextTreeSnapshotService.initEmptySnapshot()
        this.terminal.log('✓ Context tree initialized')
      } else {
        // Remote has real data - sync it to local
        await this.contextTreeWriterService.sync({files: [...coGitSnapshot.files]})
        await this.contextTreeSnapshotService.saveSnapshot()
        this.terminal.log(`✓ Synced ${coGitSnapshot.files.length} context files from remote`)
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
  private async appendRulesToFile(params: {agent: Agent; filePath: string; writeMode: WriteMode}): Promise<void> {
    const {agent, filePath, writeMode} = params
    const ruleContent = await this.templateService.generateRuleContent(agent)

    // For dedicated ByteRover files, overwrite; for shared instruction files, append
    const mode = writeMode === 'overwrite' ? 'overwrite' : 'append'
    await this.fileService.write(ruleContent, filePath, mode)

    this.terminal.log(`✅ Successfully added rule file for ${agent}`)
  }

  /**
   * Creates a new rule file with ByteRover rules.
   */
  private async createNewRuleFile(params: {agent: Agent; filePath: string}): Promise<void> {
    const {agent, filePath} = params
    const ruleContent = await this.templateService.generateRuleContent(agent)
    await this.fileService.write(ruleContent, filePath, 'overwrite')
    this.terminal.log(`✅ Successfully created rule file for ${agent} at ${filePath}`)
  }

  private async handleLegacyRulesCleanup(params: {agent: Agent; content: string; filePath: string}): Promise<void> {
    const {agent, content, filePath} = params
    const detectionResult = this.legacyRuleDetector.detectLegacyRules(content, agent)
    const {reliableMatches, uncertainMatches} = detectionResult

    this.terminal.log(
      `\n⚠️  Detected ${
        reliableMatches.length + uncertainMatches.length
      } old ByteRover rule section(s) in ${filePath}:\n`,
    )

    if (reliableMatches.length > 0) {
      this.terminal.log('Reliable matches:')
      for (const [index, match] of reliableMatches.entries()) {
        this.terminal.log(`  Section ${index + 1}: lines ${match.startLine}-${match.endLine}`)
      }

      this.terminal.log()
    }

    if (uncertainMatches.length > 0) {
      this.terminal.log('  ⚠️  Uncertain matches (cannot determine start):')
      for (const match of uncertainMatches) {
        this.terminal.log(`  Footer found at line ${match.footerLine}`)
        this.terminal.log(`  Reason: ${match.reason}`)
      }

      this.terminal.log()
      this.terminal.log('⚠️  Due to uncertain matches, only manual cleanup is available.\n')
      await this.performManualCleanup({
        agent,
        filePath,
        reliableMatches,
        uncertainMatches,
      })
      return
    }

    const selectedStrategy = await this.promptForCleanupStrategy()
    await (selectedStrategy === 'manual'
      ? this.performManualCleanup({
          agent,
          filePath,
          reliableMatches,
          uncertainMatches,
        })
      : this.performAutomaticCleanup({
          agent,
          filePath,
          reliableMatches,
        }))
  }

  private logSuccess(space: Space): void {
    this.terminal.log(`\n✓ Project initialized successfully!`)
    this.terminal.log(`✓ Connected to space: ${space.getDisplayName()}`)
    this.terminal.log(`✓ Configuration saved to: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
    this.terminal.log(
      "NOTE: It's recommended to add .brv/ to your .gitignore file since ByteRover already takes care of memory/context versioning for you.",
    )
  }

  private async performAutomaticCleanup(params: {
    agent: Agent
    filePath: string
    reliableMatches: LegacyRuleMatch[]
  }): Promise<void> {
    const {agent, filePath, reliableMatches} = params
    const backupPath = await this.fileService.createBackup(filePath)
    this.terminal.log(`📦 Backup created: ${backupPath}`)
    let content = await this.fileService.read(filePath)
    // Remove all reliable matches (in reverse order to preserve line numbers)
    const sortedMatches = [...reliableMatches].sort((a, b) => b.startLine - a.startLine)
    for (const match of sortedMatches) {
      content = content.replace(match.content, '')
    }

    // Write cleaned content
    await this.fileService.write(content, filePath, 'overwrite')
    // Append new rules
    const ruleContent = await this.templateService.generateRuleContent(agent)
    await this.fileService.write(ruleContent, filePath, 'append')
    this.terminal.log(`✅ Removed ${reliableMatches.length} old ByteRover section(s)`)
    this.terminal.log(`✅ Added new rules with boundary markers`)
    this.terminal.log(`\nYou can safely delete the backup file once verified.`)
  }

  private async performManualCleanup(params: {
    agent: Agent
    filePath: string
    reliableMatches: LegacyRuleMatch[]
    uncertainMatches: UncertainMatch[]
  }): Promise<void> {
    const {agent, filePath, reliableMatches, uncertainMatches} = params
    const ruleContent = await this.templateService.generateRuleContent(agent)
    await this.fileService.write(ruleContent, filePath, 'append')
    this.terminal.log(`✅ New ByteRover rules added with boundary markers\n`)
    this.terminal.log('Please manually remove old sections:')
    for (const [index, match] of reliableMatches.entries()) {
      this.terminal.log(`  - Section ${index + 1}: lines ${match.startLine}-${match.endLine} in ${filePath}`)
    }

    for (const match of uncertainMatches) {
      this.terminal.log(`  - Section ending at line ${match.footerLine} in ${filePath}`)
    }

    this.terminal.log('\nKeep only the section between:')
    this.terminal.log('  <!-- BEGIN BYTEROVER RULES -->')
    this.terminal.log('  <!-- END BYTEROVER RULES -->')
  }

  /**
   * Replaces existing ByteRover rules (with boundary markers) with new rules.
   */
  private async replaceExistingRules(params: {
    agent: Agent
    content: string
    filePath: string
    writeMode: WriteMode
  }): Promise<void> {
    const {agent, content, filePath, writeMode} = params
    const ruleContent = await this.templateService.generateRuleContent(agent)

    if (writeMode === 'overwrite') {
      // For dedicated ByteRover files, just overwrite the entire file
      await this.fileService.write(ruleContent, filePath, 'overwrite')
    } else {
      // For shared instruction files, replace the section between markers
      const startMarker = BRV_RULE_MARKERS.START
      const endMarker = BRV_RULE_MARKERS.END
      const startIndex = content.indexOf(startMarker)
      const endIndex = content.indexOf(endMarker, startIndex)

      if (startIndex === -1 || endIndex === -1) {
        this.terminal.log('Could not find boundary markers in the file')
        return
      }

      const before = content.slice(0, startIndex)
      const after = content.slice(endIndex + endMarker.length)
      const newContent = before + ruleContent + after

      await this.fileService.write(newContent, filePath, 'overwrite')
    }

    this.terminal.log(`✅ Successfully updated rule file for ${agent}`)
  }
}
