import {access, readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {Space} from '../../core/domain/entities/space.js'
import type {Team} from '../../core/domain/entities/team.js'
import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import type {IConnectorManager} from '../../core/interfaces/connectors/i-connector-manager.js'
import type {IContextTreeService} from '../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../core/interfaces/services/i-cogit-pull-service.js'
import type {IFileService} from '../../core/interfaces/services/i-file-service.js'
import type {ISpaceService} from '../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../core/interfaces/services/i-team-service.js'
import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'
import type {IInitUseCase} from '../../core/interfaces/usecase/i-init-use-case.js'

import {getCurrentConfig} from '../../config/environment.js'
import {ACE_DIR, BRV_CONFIG_VERSION, BRV_DIR, DEFAULT_BRANCH, PROJECT_CONFIG_FILE} from '../../constants.js'
import {type Agent, AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {BrvConfigVersionError} from '../../core/domain/errors/brv-config-version-error.js'
import {WorkspaceDetectorService} from '../workspace/workspace-detector-service.js'

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
  connectorManager: IConnectorManager
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  fileService: IFileService
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  teamService: ITeamService
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
}

export class InitUseCase implements IInitUseCase {
  protected readonly cogitPullService: ICogitPullService
  protected readonly connectorManager: IConnectorManager
  protected readonly contextTreeService: IContextTreeService
  protected readonly contextTreeSnapshotService: IContextTreeSnapshotService
  protected readonly contextTreeWriterService: IContextTreeWriterService
  protected readonly fileService: IFileService
  protected readonly projectConfigStore: IProjectConfigStore
  protected readonly spaceService: ISpaceService
  protected readonly teamService: ITeamService
  protected readonly terminal: ITerminal
  protected readonly tokenStore: ITokenStore
  protected readonly trackingService: ITrackingService

  constructor(options: InitUseCaseOptions) {
    this.cogitPullService = options.cogitPullService
    this.connectorManager = options.connectorManager
    this.contextTreeService = options.contextTreeService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.contextTreeWriterService = options.contextTreeWriterService
    this.fileService = options.fileService
    this.projectConfigStore = options.projectConfigStore
    this.spaceService = options.spaceService
    this.teamService = options.teamService
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
      const brvDirRemovalErr = `Failed to remove ${BRV_DIR}/: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
      await this.trackingService.track('init', {message: brvDirRemovalErr, status: 'error'})
      throw new Error(brvDirRemovalErr)
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
      message: 'Continue with re-initialization',
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
      this.terminal.log('Not authenticated. Please run "/login" first.')
      return undefined
    }

    if (!token.isValid()) {
      this.terminal.log('Authentication token expired. Please run "/login" again.')
      return undefined
    }

    return token
  }

  protected async fetchAndSelectSpace(token: AuthToken, team: Team): Promise<Space | undefined> {
    this.terminal.actionStart('Fetching all spaces')
    const {spaces} = await this.spaceService.getSpaces(token.accessToken, token.sessionKey, team.id, {fetchAll: true})
    this.terminal.actionStop()

    if (spaces.length === 0) {
      this.terminal.error(
        `No spaces found in team "${team.getDisplayName()}"\nPlease visit ${
          getCurrentConfig().webAppUrl
        } to create your first space for ${team.getDisplayName()}.`,
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
      this.terminal.error(`No teams found.\nPlease visit ${getCurrentConfig().webAppUrl} to create your first team.`)
      return undefined
    }

    this.terminal.log()
    return this.promptForTeamSelection(teams)
  }

  protected async getExistingConfig(): Promise<BrvConfig | LegacyProjectConfigInfo | undefined> {
    const exists = await this.projectConfigStore.exists()
    if (!exists) return undefined

    try {
      const projectConfig = await this.projectConfigStore.read()
      if (projectConfig === undefined) {
        const corruptedConfigFileErr = 'Configuration file exists but cannot be read. Please check .brv/config.json'
        this.trackingService.track('init', {message: corruptedConfigFileErr, status: 'error'})
        throw new Error(corruptedConfigFileErr)
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

  /**
   * Installs the default connector for the selected agent.
   * Uses ConnectorManager to handle the installation.
   */
  protected async installConnectorForAgent(selectedAgent: Agent): Promise<void> {
    const defaultType = this.connectorManager.getDefaultConnectorType(selectedAgent)
    const result = await this.connectorManager.installDefault(selectedAgent)

    if (result.success) {
      if (result.alreadyInstalled) {
        this.terminal.log(`${selectedAgent} is already connected via ${defaultType}`)
      } else {
        this.terminal.log(`${selectedAgent} connected via ${defaultType}`)
        this.terminal.log(`   Installed: ${result.configPath}`)

        // Show restart message for hook connector
        if (['hook', 'mcp', 'skill'].includes(defaultType)) {
          this.terminal.warn(`\n⚠️  Please restart ${selectedAgent} to apply the new ${defaultType}.`)
        }
      }
    } else {
      this.terminal.error(`Failed to install connector for ${selectedAgent}: ${result.message}`)
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
      message: 'Remove the ACE folder and its contents',
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
      await this.trackingService.track('init', {status: 'started'})
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

      const {chatLogPath, cwd} = this.detectWorkspacesForAgent(selectedAgent)
      this.terminal.log(`✓ Detected workspace: ${cwd}`)

      const config = BrvConfig.fromSpace({
        chatLogPath,
        cwd,
        ide: selectedAgent,
        space: selectedSpace,
      })
      await this.projectConfigStore.write(config)

      this.terminal.log()
      await this.installConnectorForAgent(selectedAgent)

      await this.trackingService.track('space:init')

      this.logSuccess(selectedSpace)
      await this.trackingService.track('init', {status: 'finished'})
    } catch (error) {
      // Stop action if it's in progress
      this.terminal.actionStop()
      const initErr = `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      await this.trackingService.track('init', {message: initErr, status: 'error'})
      this.terminal.error(initErr)
    }
  }

  protected async syncFromRemoteOrInitialize(params: {
    projectConfig: {spaceId: string; teamId: string}
    token: AuthToken
  }): Promise<void> {
    // Pull from remote - fail if network/API error
    this.terminal.actionStart('Syncing from ByteRover...')
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
        await this.contextTreeWriterService.sync({files: [...coGitSnapshot.files]})
        await this.contextTreeSnapshotService.saveSnapshot()
        this.terminal.log(`✓ Synced ${coGitSnapshot.files.length} context files from remote`)
      }
    } catch (error) {
      const syncFailureErr = `Failed to sync from ByteRover: ${
        error instanceof Error ? error.message : 'Unknown error'
      }. Please try again.`
      await this.trackingService.track('init', {message: syncFailureErr, status: 'error'})
      throw new Error(syncFailureErr)
    }

    this.terminal.actionStop()
  }

  private logSuccess(space: Space): void {
    this.terminal.log(`\n✓ Project initialized successfully!`)
    this.terminal.log(`✓ Connected to space: ${space.getDisplayName()}`)
    this.terminal.log(`✓ Configuration saved to: ${BRV_DIR}/${PROJECT_CONFIG_FILE}`)
    this.terminal.log(
      "NOTE: It's recommended to add .brv/ to your .gitignore file since ByteRover already takes care of memory/context versioning for you.",
    )
  }
}
