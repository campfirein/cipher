import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Space} from '../../src/core/domain/entities/space.js'
import type {Team} from '../../src/core/domain/entities/team.js'
import type {ICogitPullService} from '../../src/core/interfaces/i-cogit-pull-service.js'
import type {IContextTreeService} from '../../src/core/interfaces/i-context-tree-service.js'
import type {IContextTreeWriterService} from '../../src/core/interfaces/i-context-tree-writer-service.js'
import type {IFileService} from '../../src/core/interfaces/i-file-service.js'
import type {ILegacyRuleDetector} from '../../src/core/interfaces/i-legacy-rule-detector.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {IRuleTemplateService} from '../../src/core/interfaces/i-rule-template-service.js'
import type {ISpaceService} from '../../src/core/interfaces/i-space-service.js'
import type {ITeamService} from '../../src/core/interfaces/i-team-service.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Init, {type LegacyProjectConfigInfo} from '../../src/commands/init.js'
import {Agent} from '../../src/core/domain/entities/agent.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../src/core/domain/entities/brv-config.js'
import {Space as SpaceImpl} from '../../src/core/domain/entities/space.js'
import {Team as TeamImpl} from '../../src/core/domain/entities/team.js'
import {IContextTreeSnapshotService} from '../../src/core/interfaces/i-context-tree-snapshot-service.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

/**
 * Testable Init command that accepts mocked services
 */
class TestableInit extends Init {
  public errorMessages: string[] = []
  public logMessages: string[] = []
  public mockAceDirectoryExists = false
  public mockAceRemovalConfirmResult = true
  public mockCleanupError: Error | undefined = undefined
  public mockConfirmResult = false
  public mockLegacyConfig: LegacyProjectConfigInfo | undefined = undefined
  public removeAceDirectoryCalled = false

  // eslint-disable-next-line max-params
  constructor(
    private readonly mockCogitPullService: ICogitPullService,
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockContextTreeService: IContextTreeService,
    private readonly mockContextTreeSnapshotService: IContextTreeSnapshotService,
    private readonly mockContextTreeWriterService: IContextTreeWriterService,
    private readonly mockFileService: IFileService,
    private readonly mockLegacyRuleDetector: ILegacyRuleDetector,
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTeamService: ITeamService,
    private readonly mockTemplateService: IRuleTemplateService,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockTrackingService: ITrackingService,
    private readonly mockSelectedTeam: Team,
    private readonly mockSelectedSpace: Space,
    config: Config,
  ) {
    super([], config)
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
    return this.mockConfirmResult
  }

  protected createServices() {
    this.terminal = createMockTerminal({
      error: (message: string) => {
        this.errorMessages.push(message)
      },
      log: (message?: string) => {
        if (message !== undefined) {
          this.logMessages.push(message)
        }
      },
    })
    return {
      cogitPullService: this.mockCogitPullService,
      contextTreeService: this.mockContextTreeService,
      contextTreeSnapshotService: this.mockContextTreeSnapshotService,
      contextTreeWriterService: this.mockContextTreeWriterService,
      fileService: this.mockFileService,
      legacyRuleDetector: this.mockLegacyRuleDetector,
      projectConfigStore: this.mockConfigStore,
      spaceService: this.mockSpaceService,
      teamService: this.mockTeamService,
      templateService: this.mockTemplateService,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
  }

  protected async getExistingConfig(): Promise<BrvConfig | LegacyProjectConfigInfo | undefined> {
    // If legacy config is mocked, return it directly
    if (this.mockLegacyConfig) {
      return this.mockLegacyConfig
    }

    // Otherwise, use the mock config store
    const exists = await this.mockConfigStore.exists()
    if (!exists) return undefined

    const config = await this.mockConfigStore.read()
    if (config === undefined) {
      throw new Error('Configuration file exists but cannot be read. Please check .brv/config.json')
    }

    return config
  }

  protected async promptAceDeprecationRemoval(): Promise<boolean> {
    return this.mockAceRemovalConfirmResult
  }

  protected async promptForAgentSelection(): Promise<Agent> {
    return 'Claude Code' // Default mock agent
  }

  protected async promptForCleanupStrategy(): Promise<'manual'> {
    return 'manual'
  }

  protected async promptForFileCreation(): Promise<boolean> {
    return true
  }

  protected async promptForOverwriteConfirmation(_agent: Agent): Promise<boolean> {
    return true // Default to true for tests
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team> {
    return this.mockSelectedTeam
  }

  protected async removeAceDirectory(): Promise<void> {
    this.removeAceDirectoryCalled = true
  }

  // Mock syncFromRemoteOrInitialize to avoid testing remote sync in unit tests
  protected async syncFromRemoteOrInitialize(): Promise<void> {
    // Simulate new space behavior: create templates with empty snapshot
    // Use initializeMemoryContextDir to handle errors gracefully (like real implementation)
    await this.initializeMemoryContextDir('context tree', () => this.mockContextTreeService.initialize())
    await this.mockContextTreeSnapshotService.initEmptySnapshot()
  }
}

/**
 * TestableInit variant that tests the actual syncFromRemoteOrInitialize implementation
 * Extends Init directly to avoid TestableInit's override
 */
class SyncTestableInit extends Init {
  public errorMessages: string[] = []
  public logMessages: string[] = []
  public mockContextTreeInitializeCalled = false

  // eslint-disable-next-line max-params
  constructor(
    private readonly mockCogitPullService: ICogitPullService,
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockContextTreeService: IContextTreeService,
    private readonly mockContextTreeSnapshotService: IContextTreeSnapshotService,
    private readonly mockContextTreeWriterService: IContextTreeWriterService,
    private readonly mockFileService: IFileService,
    private readonly mockLegacyRuleDetector: ILegacyRuleDetector,
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTeamService: ITeamService,
    private readonly mockTemplateService: IRuleTemplateService,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockTrackingService: ITrackingService,
    private readonly mockSelectedTeam: Team,
    private readonly mockSelectedSpace: Space,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    this.terminal = createMockTerminal({
      error: (message: string) => {
        this.errorMessages.push(message)
      },
      log: (message?: string) => {
        if (message !== undefined) {
          this.logMessages.push(message)
        }
      },
    })
    return {
      cogitPullService: this.mockCogitPullService,
      contextTreeService: this.mockContextTreeService,
      contextTreeSnapshotService: this.mockContextTreeSnapshotService,
      contextTreeWriterService: this.mockContextTreeWriterService,
      fileService: this.mockFileService,
      legacyRuleDetector: this.mockLegacyRuleDetector,
      projectConfigStore: this.mockConfigStore,
      spaceService: this.mockSpaceService,
      teamService: this.mockTeamService,
      templateService: this.mockTemplateService,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
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
    return 'Claude Code'
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

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team> {
    return this.mockSelectedTeam
  }

  // Expose syncFromRemoteOrInitialize for direct testing
  public async testSyncFromRemoteOrInitialize(token: AuthToken): Promise<void> {
    // Initialize terminal before calling syncFromRemoteOrInitialize (normally done in createServices)
    this.terminal = createMockTerminal({
      error: (message: string) => {
        this.errorMessages.push(message)
      },
      log: (message?: string) => {
        if (message !== undefined) {
          this.logMessages.push(message)
        }
      },
    })
    return this.syncFromRemoteOrInitialize({
      cogitPullService: this.mockCogitPullService,
      contextTreeService: this.mockContextTreeService,
      contextTreeSnapshotService: this.mockContextTreeSnapshotService,
      contextTreeWriterService: this.mockContextTreeWriterService,
      projectConfig: {spaceId: this.mockSelectedSpace.id, teamId: this.mockSelectedTeam.id},
      token,
    })
  }
}

describe('Init Command', () => {
  let cogitPullService: sinon.SinonStubbedInstance<ICogitPullService>
  let config: Config
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let contextTreeService: sinon.SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: sinon.SinonStubbedInstance<IContextTreeSnapshotService>
  let contextTreeWriterService: sinon.SinonStubbedInstance<IContextTreeWriterService>
  let fileService: sinon.SinonStubbedInstance<IFileService>
  let legacyRuleDetector: sinon.SinonStubbedInstance<ILegacyRuleDetector>
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let teamService: sinon.SinonStubbedInstance<ITeamService>
  let templateService: sinon.SinonStubbedInstance<IRuleTemplateService>
  let testSpaces: Space[]
  let testTeams: Team[]
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let uxActionStartStub: sinon.SinonStub
  let uxActionStopStub: sinon.SinonStub
  let validToken: AuthToken

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(async () => {
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

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
      exists: stub<Parameters<IFileService['exists']>, ReturnType<IFileService['exists']>>().resolves(false),
      read: stub<Parameters<IFileService['read']>, ReturnType<IFileService['read']>>().resolves(''),
      replaceContent: stub<
        Parameters<IFileService['replaceContent']>,
        ReturnType<IFileService['replaceContent']>
      >().resolves(),
      write: stub<Parameters<IFileService['write']>, ReturnType<IFileService['write']>>().resolves(),
    }

    legacyRuleDetector = {
      detectLegacyRules: stub<
        Parameters<ILegacyRuleDetector['detectLegacyRules']>,
        ReturnType<ILegacyRuleDetector['detectLegacyRules']>
      >().returns({reliableMatches: [], uncertainMatches: []}),
    }

    templateService = {
      generateRuleContent: stub<
        Parameters<IRuleTemplateService['generateRuleContent']>,
        ReturnType<IRuleTemplateService['generateRuleContent']>
      >().resolves('# Generated ByteRover rules'),
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
    // Call these to negate eslint's no-unused-expressions rule
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    restore()
  })

  describe('execute()', () => {
    it('should exit early if project is already initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true // Auth happens first
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
      expect(teamService.getTeams.called).to.be.false // Should not proceed to fetch teams
    })

    it('should throw error when not authenticated', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves()

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Not authenticated')
    })

    it('should throw error when token is expired', async () => {
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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('expired')
    })

    it('should exit gracefully when no teams are available', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: [], total: 0})

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify that initialization did not occur
      expect(configStore.write.called).to.be.false
    })

    it('should exit gracefully when no spaces are available in selected team', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify that initialization did not occur
      expect(configStore.write.called).to.be.false
    })

    it('should successfully initialize with first space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(teamService.getTeams.calledWith('access-token', 'session-key', {fetchAll: true})).to.be.true
      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {fetchAll: true})).to.be.true
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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[1],
        config,
      )

      await command.run()

      const writtenConfig = configStore.write.getCall(0).args[0]
      expect(writtenConfig.spaceId).to.equal('space-2')
      expect(writtenConfig.spaceName).to.equal('backend-api')
    })

    it('should propagate errors from team service', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.rejects(new Error('Network timeout'))

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Network timeout')
    })

    it('should propagate errors from space service', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.rejects(new Error('Network timeout'))

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Network timeout')
    })

    it('should propagate errors from config store', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.rejects(new Error('Permission denied'))

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Permission denied')
    })

    it('should call gen-rules command after successful initialization', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(templateService.generateRuleContent.calledOnce).to.be.true
      expect(fileService.write.calledOnce).to.be.true
    })

    it('should call templateService after config write', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify order: config write happens before templateService
      expect(configStore.write.calledBefore(templateService.generateRuleContent)).to.be.true
    })

    it('should call templateService after context tree initialization (ACE deprecated)', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify order: context tree initialization happens before templateService
      expect(contextTreeService.initialize.calledBefore(templateService.generateRuleContent)).to.be.true
      // Verify: saveSnapshot is called after context tree initialization
      expect(contextTreeService.initialize.calledBefore(contextTreeSnapshotService.saveSnapshot)).to.be.true
    })

    it('should continue with rule generation even if context tree initialization fails', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()
      contextTreeService.initialize.rejects(new Error('Context tree already exists'))

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Should still call templateService even though context tree init failed
      expect(templateService.generateRuleContent.calledOnce).to.be.true
      expect(fileService.write.calledOnce).to.be.true
    })

    it('should propagate errors from templateService', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()
      templateService.generateRuleContent.rejects(new Error('Template not found'))

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Template not found')
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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[1], // Select different space
        config,
      )

      command.mockConfirmResult = true // User confirms

      await command.run()

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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockConfirmResult = false // User cancels

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true // Auth happens first
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
      expect(teamService.getTeams.called).to.be.false // Should not proceed
      expect(spaceService.getSpaces.called).to.be.false
    })

    it('should skip confirmation with --force flag', async () => {
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[1],
        config,
      )

      command.mockConfirmResult = false // Shouldn't matter with --force
      // Override argv to include --force flag
      ;(command as never as {argv: string[]}).argv = ['--force']

      await command.run()

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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockConfirmResult = true
      command.mockCleanupError = new Error('Permission denied')

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Permission denied')
    })

    it('should handle corrupted config file', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves() // Corrupted/unreadable - returns undefined

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Configuration file exists but cannot be read')
      expect(tokenStore.load.calledOnce).to.be.true // Auth happens first
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should handle legacy config without version field', async () => {
      tokenStore.load.resolves(validToken)
      configStore.write.resolves()
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )
      // Mock legacy config with missing version
      command.mockLegacyConfig = {
        currentVersion: undefined,
        spaceName: 'frontend-app',
        teamName: 'acme-corp',
        type: 'legacy',
      }
      command.mockConfirmResult = true

      await command.run()

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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )
      // Mock legacy config with version mismatch
      command.mockLegacyConfig = {
        currentVersion: '0.0.0',
        spaceName: 'frontend-app',
        teamName: 'acme-corp',
        type: 'legacy',
      }
      command.mockConfirmResult = true

      await command.run()

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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockAceDirectoryExists = false // No existing ACE folder

      await command.run()

      // Should not call removeAceDirectory since no ACE folder exists
      expect(command.removeAceDirectoryCalled).to.be.false
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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockAceDirectoryExists = true // Existing ACE folder
      command.mockAceRemovalConfirmResult = true // User confirms removal

      await command.run()

      // Should call removeAceDirectory
      expect(command.removeAceDirectoryCalled).to.be.true
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

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockAceDirectoryExists = true // Existing ACE folder
      command.mockAceRemovalConfirmResult = false // User declines removal

      await command.run()

      // Should NOT call removeAceDirectory
      expect(command.removeAceDirectoryCalled).to.be.false
      // Should still initialize context tree
      expect(contextTreeService.initialize.calledOnce).to.be.true
      // Should complete initialization
      expect(configStore.write.calledOnce).to.be.true
    })

    it('should handle ACE deprecation during re-initialization with --force flag', async () => {
      configStore.exists.resolves(true)
      configStore.read.resolves(
        BrvConfig.fromSpace({chatLogPath: 'chat.log', cwd: '/test/cwd', ide: 'Claude Code', space: testSpaces[0]}),
      )
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockAceDirectoryExists = true // Existing ACE folder
      command.mockAceRemovalConfirmResult = true // User confirms removal
      ;(command as never as {argv: string[]}).argv = ['--force']

      await command.run()

      // Should call removeAceDirectory (ACE folder existed and user confirmed)
      expect(command.removeAceDirectoryCalled).to.be.true
      // Should complete initialization
      expect(configStore.write.calledOnce).to.be.true
    })
  })

  describe('syncFromRemoteOrInitialize', () => {
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

      const command = new SyncTestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.testSyncFromRemoteOrInitialize(validToken)

      // Should detect README.md as placeholder and treat as empty space
      expect(command.mockContextTreeInitializeCalled).to.be.true
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

      const command = new SyncTestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.testSyncFromRemoteOrInitialize(validToken)

      // Should treat as empty space
      expect(command.mockContextTreeInitializeCalled).to.be.true
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

      const command = new SyncTestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.testSyncFromRemoteOrInitialize(validToken)

      // Should sync from remote and save snapshot
      expect(command.mockContextTreeInitializeCalled).to.be.false
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

      const command = new SyncTestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.testSyncFromRemoteOrInitialize(validToken)

      // README.md + other files = real content, should sync
      expect(command.mockContextTreeInitializeCalled).to.be.false
      expect(contextTreeWriterService.sync.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
    })

    it('should throw error when pull fails', async () => {
      cogitPullService.pull.rejects(new Error('Network error'))

      const command = new SyncTestableInit(
        cogitPullService,
        configStore,
        contextTreeService,
        contextTreeSnapshotService,
        contextTreeWriterService,
        fileService,
        legacyRuleDetector,
        spaceService,
        teamService,
        templateService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.testSyncFromRemoteOrInitialize(validToken)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).to.include('Failed to sync from ByteRover')
        expect((error as Error).message).to.include('Network error')
      }
    })
  })
})
