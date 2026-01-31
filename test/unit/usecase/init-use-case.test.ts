import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Space} from '../../../src/server/core/domain/entities/space.js'
import type {Team} from '../../../src/server/core/domain/entities/team.js'
import type {ITokenStore} from '../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IConnectorManager} from '../../../src/server/core/interfaces/connectors/i-connector-manager.js'
import type {IContextTreeService} from '../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../src/server/core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../../src/server/core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../../src/server/core/interfaces/services/i-cogit-pull-service.js'
import type {IFileService} from '../../../src/server/core/interfaces/services/i-file-service.js'
import type {ISpaceService} from '../../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../src/server/core/interfaces/services/i-team-service.js'
import type {ITerminal} from '../../../src/server/core/interfaces/services/i-terminal.js'
import type {ITrackingService} from '../../../src/server/core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {Agent} from '../../../src/server/core/domain/entities/agent.js'
import {AuthToken} from '../../../src/server/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/server/core/domain/entities/brv-config.js'
import {Space as SpaceImpl} from '../../../src/server/core/domain/entities/space.js'
import {Team as TeamImpl} from '../../../src/server/core/domain/entities/team.js'
import {
  InitUseCase,
  type InitUseCaseOptions,
  type LegacyProjectConfigInfo,
} from '../../../src/server/infra/usecase/init-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

// ==================== TestableInitUseCase ====================

interface TestableInitUseCaseOptions extends InitUseCaseOptions {
  mockAceDirectoryExists?: boolean
  mockAceRemovalConfirm?: boolean
  mockCleanupError?: Error
  mockConfirmReInit?: boolean
  mockLegacyConfig?: LegacyProjectConfigInfo
  mockSelectedAgent?: Agent
  mockSelectedSpace?: Space
  mockSelectedTeam?: Team
}

class TestableInitUseCase extends InitUseCase {
  public errorMessages: string[] = []
  public logMessages: string[] = []
  public removeAceDirectoryCalled = false
  private readonly mockAceDirectoryExists: boolean
  private readonly mockAceRemovalConfirm: boolean
  private readonly mockCleanupError?: Error
  private readonly mockConfirmReInit: boolean
  private readonly mockLegacyConfig?: LegacyProjectConfigInfo
  private readonly mockSelectedAgent: Agent
  private readonly mockSelectedSpace?: Space
  private readonly mockSelectedTeam?: Team

  constructor(options: TestableInitUseCaseOptions) {
    super(options)
    this.mockAceDirectoryExists = options.mockAceDirectoryExists ?? false
    this.mockAceRemovalConfirm = options.mockAceRemovalConfirm ?? true
    this.mockCleanupError = options.mockCleanupError
    this.mockConfirmReInit = options.mockConfirmReInit ?? false
    this.mockLegacyConfig = options.mockLegacyConfig
    this.mockSelectedAgent = options.mockSelectedAgent ?? 'Claude Code'
    this.mockSelectedSpace = options.mockSelectedSpace
    this.mockSelectedTeam = options.mockSelectedTeam
  }

  protected async aceDirectoryExists(): Promise<boolean> {
    return this.mockAceDirectoryExists
  }

  protected async cleanupBeforeReInitialization(): Promise<void> {
    if (this.mockCleanupError) {
      throw this.mockCleanupError
    }
    // Otherwise, do nothing in tests (don't actually delete files)
  }

  protected async confirmReInitialization(_config: BrvConfig | LegacyProjectConfigInfo): Promise<boolean> {
    return this.mockConfirmReInit
  }

  protected async getExistingConfig(): Promise<BrvConfig | LegacyProjectConfigInfo | undefined> {
    // If legacy config is mocked, return it directly
    if (this.mockLegacyConfig) {
      return this.mockLegacyConfig
    }

    // Otherwise, use the project config store
    const exists = await this.projectConfigStore.exists()
    if (!exists) return undefined

    const config = await this.projectConfigStore.read()
    if (config === undefined) {
      throw new Error('Configuration file exists but cannot be read. Please check .brv/config.json')
    }

    return config
  }

  protected async promptAceDeprecationRemoval(): Promise<boolean> {
    return this.mockAceRemovalConfirm
  }

  protected async promptForAgentSelection(): Promise<Agent> {
    return this.mockSelectedAgent
  }

  protected async promptForCleanupStrategy(): Promise<'manual'> {
    return 'manual'
  }

  protected async promptForFileCreation(): Promise<boolean> {
    return true
  }

  protected async promptForOverwriteConfirmation(_agent: Agent): Promise<boolean> {
    return true
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space | undefined> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team | undefined> {
    return this.mockSelectedTeam
  }

  protected async removeAceDirectory(): Promise<void> {
    this.removeAceDirectoryCalled = true
  }

  // Mock syncFromRemoteOrInitialize to avoid testing remote sync in unit tests
  protected async syncFromRemoteOrInitialize(): Promise<void> {
    // Simulate new space behavior: create templates with empty snapshot
    await this.initializeMemoryContextDir('context tree', () => this.contextTreeService.initialize())
    await this.contextTreeSnapshotService.initEmptySnapshot()
  }
}

// ==================== SyncTestableInitUseCase ====================

/**
 * TestableInitUseCase variant that tests the actual syncFromRemoteOrInitialize implementation
 */
class SyncTestableInitUseCase extends InitUseCase {
  public logMessages: string[] = []
  public mockContextTreeInitializeCalled = false
  private readonly mockSelectedAgent: Agent
  private readonly mockSelectedSpace: Space
  private readonly mockSelectedTeam: Team

  constructor(options: TestableInitUseCaseOptions) {
    super(options)
    this.mockSelectedAgent = options.mockSelectedAgent ?? 'Claude Code'
    this.mockSelectedSpace = options.mockSelectedSpace!
    this.mockSelectedTeam = options.mockSelectedTeam!
  }

  protected async getExistingConfig(): Promise<BrvConfig | LegacyProjectConfigInfo | undefined> {
    return undefined // No existing config for sync tests
  }

  // Track when initializeMemoryContextDir is called
  protected async initializeMemoryContextDir(_label: string, initFn: () => Promise<string>): Promise<void> {
    this.mockContextTreeInitializeCalled = true
    await initFn()
  }

  protected async promptForAgentSelection(): Promise<Agent> {
    return this.mockSelectedAgent
  }

  protected async promptForCleanupStrategy(): Promise<'manual'> {
    return 'manual'
  }

  protected async promptForFileCreation(): Promise<boolean> {
    return true
  }

  protected async promptForOverwriteConfirmation(_agent: Agent): Promise<boolean> {
    return true
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space | undefined> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team | undefined> {
    return this.mockSelectedTeam
  }

  // Expose syncFromRemoteOrInitialize for direct testing
  public async testSyncFromRemoteOrInitialize(token: AuthToken): Promise<void> {
    return this.syncFromRemoteOrInitialize({
      projectConfig: {spaceId: this.mockSelectedSpace.id, teamId: this.mockSelectedTeam.id},
      token,
    })
  }
}

// ==================== Tests ====================

describe('InitUseCase', () => {
  let cogitPullService: sinon.SinonStubbedInstance<ICogitPullService>
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let connectorManager: sinon.SinonStubbedInstance<IConnectorManager>
  let contextTreeService: sinon.SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: sinon.SinonStubbedInstance<IContextTreeSnapshotService>
  let contextTreeWriterService: sinon.SinonStubbedInstance<IContextTreeWriterService>
  let fileService: sinon.SinonStubbedInstance<IFileService>
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let teamService: sinon.SinonStubbedInstance<ITeamService>
  let terminal: ITerminal
  let testSpaces: Space[]
  let testTeams: Team[]
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let validToken: AuthToken

  beforeEach(async () => {
    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    spaceService = {
      getSpaces: stub(),
    }

    teamService = {
      getTeams: stub(),
    }

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    contextTreeService = {
      exists: stub(),
      initialize: stub<[directory?: string], Promise<string>>().resolves('/test/.brv/context-tree'),
    }

    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
    }

    contextTreeWriterService = {
      sync: stub<
        Parameters<IContextTreeWriterService['sync']>,
        ReturnType<IContextTreeWriterService['sync']>
      >().resolves({added: [], deleted: [], edited: []}),
    }

    cogitPullService = {
      pull: stub<Parameters<ICogitPullService['pull']>, ReturnType<ICogitPullService['pull']>>().resolves({
        author: {email: 'test@example.com', name: 'Test', when: new Date()},
        branch: 'main',
        commitSha: 'abc123',
        files: [],
        message: 'Test commit',
      }),
    }

    fileService = {
      createBackup: stub<Parameters<IFileService['createBackup']>, ReturnType<IFileService['createBackup']>>().resolves(
        '/test/backup.md',
      ),
      delete: stub<Parameters<IFileService['delete']>, ReturnType<IFileService['delete']>>().resolves(),
      deleteDirectory: stub<
        Parameters<IFileService['deleteDirectory']>,
        ReturnType<IFileService['deleteDirectory']>
      >().resolves(),
      exists: stub<Parameters<IFileService['exists']>, ReturnType<IFileService['exists']>>().resolves(false),
      read: stub<Parameters<IFileService['read']>, ReturnType<IFileService['read']>>().resolves(''),
      replaceContent: stub<
        Parameters<IFileService['replaceContent']>,
        ReturnType<IFileService['replaceContent']>
      >().resolves(),
      write: stub<Parameters<IFileService['write']>, ReturnType<IFileService['write']>>().resolves(),
    }

    connectorManager = {
      getAllInstalledConnectors: stub<
        Parameters<IConnectorManager['getAllInstalledConnectors']>,
        ReturnType<IConnectorManager['getAllInstalledConnectors']>
      >().resolves(new Map()),
      getConnector: stub(),
      getDefaultConnectorType: stub<
        Parameters<IConnectorManager['getDefaultConnectorType']>,
        ReturnType<IConnectorManager['getDefaultConnectorType']>
      >().returns('hook'),
      getInstalledConnectorType: stub<
        Parameters<IConnectorManager['getInstalledConnectorType']>,
        ReturnType<IConnectorManager['getInstalledConnectorType']>
      >().resolves(null),
      getSupportedConnectorTypes: stub<
        Parameters<IConnectorManager['getSupportedConnectorTypes']>,
        ReturnType<IConnectorManager['getSupportedConnectorTypes']>
      >().returns(['rules', 'hook']),
      installDefault: stub<
        Parameters<IConnectorManager['installDefault']>,
        ReturnType<IConnectorManager['installDefault']>
      >().resolves({
        alreadyInstalled: false,
        configPath: '.claude/settings.local.json',
        message: 'Hook connector installed for Claude Code',
        success: true,
      }),
      migrateOrphanedConnectors: stub<
        Parameters<IConnectorManager['migrateOrphanedConnectors']>,
        ReturnType<IConnectorManager['migrateOrphanedConnectors']>
      >().resolves([]),
      status: stub(),
      switchConnector: stub<
        Parameters<IConnectorManager['switchConnector']>,
        ReturnType<IConnectorManager['switchConnector']>
      >().resolves({
        fromType: null,
        installResult: {
          alreadyInstalled: false,
          configPath: '.claude/settings.local.json',
          message: 'Hook connector installed for Claude Code',
          success: true,
        },
        message: 'Claude Code connected via hook',
        success: true,
        toType: 'hook',
      }),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-id-init',
    })

    testSpaces = [
      new SpaceImpl('space-1', 'frontend-app', 'team-1', 'acme-corp'),
      new SpaceImpl('space-2', 'backend-api', 'team-1', 'acme-corp'),
    ]

    testTeams = [
      new TeamImpl({
        avatarUrl: 'https://example.com/avatar1.png',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        description: 'Acme Corporation',
        displayName: 'Acme Corp',
        id: 'team-1',
        isActive: true,
        name: 'acme-corp',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      }),
    ]
  })

  afterEach(() => {
    restore()
  })

  function createTestUseCase(options: Partial<TestableInitUseCaseOptions> = {}): TestableInitUseCase {
    const errorMessages: string[] = []
    const logMessages: string[] = []
    terminal = createMockTerminal({
      error(msg: string) {
        errorMessages.push(msg)
      },
      log(msg?: string) {
        if (msg !== undefined) {
          logMessages.push(msg)
        }
      },
    })

    const useCase = new TestableInitUseCase({
      cogitPullService,
      connectorManager,
      contextTreeService,
      contextTreeSnapshotService,
      contextTreeWriterService,
      fileService,
      mockSelectedSpace: testSpaces[0],
      mockSelectedTeam: testTeams[0],
      projectConfigStore: configStore,
      spaceService,
      teamService,
      terminal,
      tokenStore,
      trackingService,
      ...options,
    })
    useCase.errorMessages = errorMessages
    useCase.logMessages = logMessages
    return useCase
  }

  describe('run()', () => {
    it('should exit early if project is already initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(tokenStore.load.calledOnce).to.be.true // Auth happens first
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
      expect(teamService.getTeams.called).to.be.false // Should not proceed to fetch teams
    })

    it('should exit early if not authenticated', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves()

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.logMessages.some((msg) => msg.includes('Not authenticated'))).to.be.true
    })

    it('should exit early when token is expired', async () => {
      const expiredToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-expired',
      })

      configStore.exists.resolves(false)
      tokenStore.load.resolves(expiredToken)

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.logMessages.some((msg) => msg.includes('expired'))).to.be.true
    })

    it('should exit gracefully when no teams are available', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: [], total: 0})

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      // Verify that initialization did not occur
      expect(configStore.write.called).to.be.false
    })

    it('should exit gracefully when no spaces are available in selected team', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      // Verify that initialization did not occur
      expect(configStore.write.called).to.be.false
    })

    it('should successfully initialize with first space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(teamService.getTeams.calledWith('session-key', {fetchAll: true})).to.be.true
      expect(spaceService.getSpaces.calledWith('session-key', 'team-1', {fetchAll: true})).to.be.true
      expect(configStore.write.calledOnce).to.be.true

      const writtenConfig = configStore.write.getCall(0).args[0]
      expect(writtenConfig.spaceId).to.equal('space-1')
      expect(writtenConfig.spaceName).to.equal('frontend-app')
      expect(writtenConfig.teamId).to.equal('team-1')
      expect(writtenConfig.teamName).to.equal('acme-corp')

      // Verify initEmptySnapshot is called for new space (so first push treats templates as "added")
      expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
    })

    it('should successfully initialize with second space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase({mockSelectedSpace: testSpaces[1]})

      await useCase.run({force: false})

      const writtenConfig = configStore.write.getCall(0).args[0]
      expect(writtenConfig.spaceId).to.equal('space-2')
      expect(writtenConfig.spaceName).to.equal('backend-api')
    })

    it('should capture errors from team service', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.rejects(new Error('Network timeout'))

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.errorMessages).to.have.lengthOf(1)
      expect(useCase.errorMessages[0]).to.include('Network timeout')
    })

    it('should capture errors from space service', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.rejects(new Error('Network timeout'))

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.errorMessages).to.have.lengthOf(1)
      expect(useCase.errorMessages[0]).to.include('Network timeout')
    })

    it('should capture errors from config store', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.rejects(new Error('Permission denied'))

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.errorMessages).to.have.lengthOf(1)
      expect(useCase.errorMessages[0]).to.include('Permission denied')
    })

    it('should install connector after successful initialization', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(connectorManager.installDefault.calledOnce).to.be.true
    })

    it('should install connector after config write', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      // Verify order: config write happens before connector installation
      expect(configStore.write.calledBefore(connectorManager.installDefault)).to.be.true
    })

    it('should install connector after context tree initialization (ACE deprecated)', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      // Verify order: context tree initialization happens before connector installation
      expect(contextTreeService.initialize.calledBefore(connectorManager.installDefault)).to.be.true
      // Verify: saveSnapshot is called after context tree initialization
      expect(contextTreeService.initialize.calledBefore(contextTreeSnapshotService.saveSnapshot)).to.be.true
    })

    it('should continue with connector installation even if context tree initialization fails', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()
      contextTreeService.initialize.rejects(new Error('Context tree already exists'))

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      // Should still install connector even though context tree init failed
      expect(connectorManager.installDefault.calledOnce).to.be.true
    })

    it('should capture errors from connector installation', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()
      connectorManager.installDefault.resolves({
        alreadyInstalled: false,
        configPath: '',
        message: 'Template not found',
        success: false,
      })

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.errorMessages).to.have.lengthOf(1)
      expect(useCase.errorMessages[0]).to.include('Template not found')
    })
  })

  describe('re-initialization', () => {
    it('should re-initialize when user confirms', async () => {
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const useCase = createTestUseCase({
        mockConfirmReInit: true,
        mockSelectedSpace: testSpaces[1], // Select different space
      })

      await useCase.run({force: false})

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
      expect(tokenStore.load.calledOnce).to.be.true
      expect(teamService.getTeams.calledOnce).to.be.true
      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should not proceed when user cancels re-initialization', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )

      const useCase = createTestUseCase({mockConfirmReInit: false})

      await useCase.run({force: false})

      expect(tokenStore.load.calledOnce).to.be.true // Auth happens first
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
      expect(teamService.getTeams.called).to.be.false // Should not proceed
      expect(spaceService.getSpaces.called).to.be.false
    })

    it('should skip confirmation with force option', async () => {
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const useCase = createTestUseCase({
        mockConfirmReInit: false, // Shouldn't matter with force
        mockSelectedSpace: testSpaces[1],
      })

      await useCase.run({force: true})

      expect(configStore.exists.calledOnce).to.be.true
      expect(tokenStore.load.calledOnce).to.be.true
      expect(teamService.getTeams.calledOnce).to.be.true
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should handle cleanup failure during re-initialization', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )

      const useCase = createTestUseCase({
        mockCleanupError: new Error('Permission denied'),
        mockConfirmReInit: true,
      })

      await useCase.run({force: false})

      expect(useCase.errorMessages).to.have.lengthOf(1)
      expect(useCase.errorMessages[0]).to.include('Permission denied')
    })

    it('should handle corrupted config file', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves() // Corrupted/unreadable - returns undefined

      const useCase = createTestUseCase()

      await useCase.run({force: false})

      expect(useCase.errorMessages).to.have.lengthOf(1)
      expect(useCase.errorMessages[0]).to.include('Configuration file exists but cannot be read')
    })

    it('should handle legacy config without version field', async () => {
      tokenStore.load.resolves(validToken)
      configStore.write.resolves()
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const useCase = createTestUseCase({
        mockConfirmReInit: true,
        mockLegacyConfig: {
          currentVersion: undefined,
          spaceName: 'frontend-app',
          teamName: 'acme-corp',
          type: 'legacy',
        },
      })

      await useCase.run({force: false})

      // Should proceed with re-initialization
      expect(tokenStore.load.calledOnce).to.be.true
      expect(teamService.getTeams.calledOnce).to.be.true
      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should handle config with version mismatch', async () => {
      tokenStore.load.resolves(validToken)
      configStore.write.resolves()
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const useCase = createTestUseCase({
        mockConfirmReInit: true,
        mockLegacyConfig: {
          currentVersion: '0.0.0',
          spaceName: 'frontend-app',
          teamName: 'acme-corp',
          type: 'legacy',
        },
      })

      await useCase.run({force: false})

      // Should proceed with re-initialization
      expect(tokenStore.load.calledOnce).to.be.true
      expect(teamService.getTeams.calledOnce).to.be.true
      expect(configStore.write.calledOnce).to.be.true
    })
  })

  describe('ACE deprecation', () => {
    it('should skip ACE deprecation prompt and not initialize ACE on fresh install', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase({mockAceDirectoryExists: false})

      await useCase.run({force: false})

      // Should not call removeAceDirectory since no ACE folder exists
      expect(useCase.removeAceDirectoryCalled).to.be.false
      // Should still initialize context tree
      expect(contextTreeService.initialize.calledOnce).to.be.true
      // Should complete initialization
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should remove ACE folder when user confirms removal', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase({
        mockAceDirectoryExists: true,
        mockAceRemovalConfirm: true,
      })

      await useCase.run({force: false})

      // Should call removeAceDirectory
      expect(useCase.removeAceDirectoryCalled).to.be.true
      // Should still initialize context tree
      expect(contextTreeService.initialize.calledOnce).to.be.true
      // Should complete initialization
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should leave ACE folder intact when user declines removal', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const useCase = createTestUseCase({
        mockAceDirectoryExists: true,
        mockAceRemovalConfirm: false,
      })

      await useCase.run({force: false})

      // Should NOT call removeAceDirectory
      expect(useCase.removeAceDirectoryCalled).to.be.false
      // Should still initialize context tree
      expect(contextTreeService.initialize.calledOnce).to.be.true
      // Should complete initialization
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should handle ACE deprecation during re-initialization with force option', async () => {
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const useCase = createTestUseCase({
        mockAceDirectoryExists: true,
        mockAceRemovalConfirm: true,
      })

      await useCase.run({force: true})

      // Should call removeAceDirectory (ACE folder existed and user confirmed)
      expect(useCase.removeAceDirectoryCalled).to.be.true
      // Should complete initialization
      expect(configStore.write.calledOnce).to.be.true
    })
  })

  describe('syncFromRemoteOrInitialize', () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    function createSyncTestUseCase(): SyncTestableInitUseCase {
      const logMessages: string[] = []
      terminal = createMockTerminal({
        log(msg?: string) {
          if (msg !== undefined) {
            logMessages.push(msg)
          }
        },
      })

      const useCase = new SyncTestableInitUseCase({
        cogitPullService,
        connectorManager,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        mockSelectedSpace: testSpaces[0],
        mockSelectedTeam: testTeams[0],
        projectConfigStore: configStore,
        spaceService,
        teamService,
        terminal,
        tokenStore,
        trackingService,
      })
      useCase.logMessages = logMessages
      return useCase
    }

    it('should call initEmptySnapshot when remote has only README.md placeholder', async () => {
      // Set up pull to return only README.md placeholder
      cogitPullService.pull.resolves({
        author: {email: 'test@example.com', name: 'Test', when: new Date()},
        branch: 'main',
        commitSha: 'abc123',
        files: [
          {
            content: Buffer.from('# README').toString('base64'),
            decodeContent: () => '# README',
            mode: '100644',
            path: 'README.md',
            sha: 'readme-sha',
            size: 8,
          },
        ],
        message: 'Initial commit',
      })

      const useCase = createSyncTestUseCase()

      await useCase.testSyncFromRemoteOrInitialize(validToken)

      // Should detect README.md as placeholder and treat as empty space
      expect(useCase.mockContextTreeInitializeCalled).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
      expect(contextTreeWriterService.sync.called).to.be.false
    })

    it('should call initEmptySnapshot when remote is truly empty', async () => {
      // Set up pull to return empty files array
      cogitPullService.pull.resolves({
        author: {email: 'test@example.com', name: 'Test', when: new Date()},
        branch: 'main',
        commitSha: 'abc123',
        files: [],
        message: 'Initial commit',
      })

      const useCase = createSyncTestUseCase()

      await useCase.testSyncFromRemoteOrInitialize(validToken)

      // Should treat as empty space
      expect(useCase.mockContextTreeInitializeCalled).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
      expect(contextTreeWriterService.sync.called).to.be.false
    })

    it('should sync and saveSnapshot when remote has real content', async () => {
      // Set up pull to return real content files
      cogitPullService.pull.resolves({
        author: {email: 'test@example.com', name: 'Test', when: new Date()},
        branch: 'main',
        commitSha: 'abc123',
        files: [
          {
            content: Buffer.from('# Context').toString('base64'),
            decodeContent: () => '# Context',
            mode: '100644',
            path: 'context.md',
            sha: 'context-sha',
            size: 9,
          },
          {
            content: Buffer.from('# Domain').toString('base64'),
            decodeContent: () => '# Domain',
            mode: '100644',
            path: 'domain.md',
            sha: 'domain-sha',
            size: 8,
          },
        ],
        message: 'Add context files',
      })

      const useCase = createSyncTestUseCase()

      await useCase.testSyncFromRemoteOrInitialize(validToken)

      // Should sync from remote and save snapshot
      expect(useCase.mockContextTreeInitializeCalled).to.be.false
      expect(contextTreeWriterService.sync.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
    })

    it('should sync when remote has README.md plus other files', async () => {
      // Set up pull to return README.md + other content
      cogitPullService.pull.resolves({
        author: {email: 'test@example.com', name: 'Test', when: new Date()},
        branch: 'main',
        commitSha: 'abc123',
        files: [
          {
            content: Buffer.from('# README').toString('base64'),
            decodeContent: () => '# README',
            mode: '100644',
            path: 'README.md',
            sha: 'readme-sha',
            size: 8,
          },
          {
            content: Buffer.from('# Context').toString('base64'),
            decodeContent: () => '# Context',
            mode: '100644',
            path: 'context.md',
            sha: 'context-sha',
            size: 9,
          },
        ],
        message: 'Add files',
      })

      const useCase = createSyncTestUseCase()

      await useCase.testSyncFromRemoteOrInitialize(validToken)

      // README.md + other files = real content, should sync
      expect(useCase.mockContextTreeInitializeCalled).to.be.false
      expect(contextTreeWriterService.sync.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
    })

    it('should throw error when pull fails', async () => {
      cogitPullService.pull.rejects(new Error('Network error'))

      const useCase = createSyncTestUseCase()

      try {
        await useCase.testSyncFromRemoteOrInitialize(validToken)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).to.include('Failed to sync from ByteRover')
        expect((error as Error).message).to.include('Network error')
      }
    })
  })
})
