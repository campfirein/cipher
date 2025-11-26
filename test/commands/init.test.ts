import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Space} from '../../src/core/domain/entities/space.js'
import type {Team} from '../../src/core/domain/entities/team.js'
import type {IContextTreeService} from '../../src/core/interfaces/i-context-tree-service.js'
import type {IPlaybookService} from '../../src/core/interfaces/i-playbook-service.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../src/core/interfaces/i-space-service.js'
import type {ITeamService} from '../../src/core/interfaces/i-team-service.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Init from '../../src/commands/init.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../src/core/domain/entities/brv-config.js'
import {Space as SpaceImpl} from '../../src/core/domain/entities/space.js'
import {Team as TeamImpl} from '../../src/core/domain/entities/team.js'

/**
 * Testable Init command that accepts mocked services
 */
class TestableInit extends Init {
  public mockCleanupError: Error | undefined = undefined
  public mockConfirmResult = false

  // eslint-disable-next-line max-params
  constructor(
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockContextTreeService: IContextTreeService,
    private readonly mockPlaybookService: IPlaybookService,
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTeamService: ITeamService,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockTrackingService: ITrackingService,
    private readonly mockSelectedTeam: Team,
    private readonly mockSelectedSpace: Space,
    config: Config,
  ) {
    super([], config)
  }

  protected async cleanupBeforeReInitialization(): Promise<void> {
    if (this.mockCleanupError) {
      throw this.mockCleanupError
    }

    // Otherwise, do nothing in tests (don't actually delete files)
  }

  protected async confirmReInitialization(_config: import('../../src/core/domain/entities/brv-config.js').BrvConfig): Promise<boolean> {
    return this.mockConfirmResult
  }

  protected createServices() {
    return {
      contextTreeService: this.mockContextTreeService,
      playbookService: this.mockPlaybookService,
      projectConfigStore: this.mockConfigStore,
      spaceService: this.mockSpaceService,
      teamService: this.mockTeamService,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    // Throw error to maintain behavior but suppress output
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }

  protected async promptForAgentSelection(): Promise<import('../../src/core/domain/entities/agent.js').Agent> {
    return 'Claude Code' // Default mock agent
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team> {
    return this.mockSelectedTeam
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

describe('Init Command', () => {
  let config: Config
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let contextTreeService: sinon.SinonStubbedInstance<IContextTreeService>
  let playbookService: sinon.SinonStubbedInstance<IPlaybookService>
  let runCommandStub: sinon.SinonStub
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let teamService: sinon.SinonStubbedInstance<ITeamService>
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

    playbookService = {
      addOrUpdateBullet: stub(),
      applyDelta: stub(),
      applyReflectionTags: stub(),
      initialize: stub<[directory?: string], Promise<string>>().resolves('/test/.brv/ace/playbook.json'),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    // Mock config.runCommand to prevent actual gen-rules execution
    runCommandStub = stub(config, 'runCommand').resolves()

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
      configStore.read.resolves(BrvConfig.fromSpace(testSpaces[0], 'chat.log', 'Claude Code', '/test/cwd'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
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
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Not authenticated')
      }
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
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('expired')
      }
    })

    it('should exit gracefully when no teams are available', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: [], total: 0})

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify that initialization did not occur
      expect(configStore.write.called).to.be.false
      expect(playbookService.initialize.called).to.be.false
    })

    it('should exit gracefully when no spaces are available in selected team', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify that initialization did not occur
      expect(configStore.write.called).to.be.false
      expect(playbookService.initialize.called).to.be.false
    })

    it('should successfully initialize with first space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
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
    })

    it('should successfully initialize with second space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
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
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Network timeout')
      }
    })

    it('should propagate errors from space service', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.rejects(new Error('Network timeout'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Network timeout')
      }
    })

    it('should propagate errors from config store', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.rejects(new Error('Permission denied'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Permission denied')
      }
    })

    it('should call gen-rules command after successful initialization', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      expect(runCommandStub.calledOnce).to.be.true
      expect(runCommandStub.calledWith('gen-rules', ['--agent', 'Claude Code'])).to.be.true
    })

    it('should call gen-rules after config write but before success message', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify order: config write happens before gen-rules
      expect(configStore.write.calledBefore(runCommandStub)).to.be.true
    })

    it('should call gen-rules after ACE playbook initialization', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Verify order: playbook initialization happens before gen-rules
      expect(playbookService.initialize.calledBefore(runCommandStub)).to.be.true
    })

    it('should continue with gen-rules even if ACE initialization fails', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()
      playbookService.initialize.rejects(new Error('Playbook already exists'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      await command.run()

      // Should still call gen-rules even though ACE init failed
      expect(runCommandStub.calledOnce).to.be.true
      expect(runCommandStub.calledWith('gen-rules', ['--agent', 'Claude Code'])).to.be.true
    })

    it('should propagate errors from gen-rules command', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()
      runCommandStub.rejects(new Error('gen-rules failed'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('gen-rules failed')
      }
    })
  })

  describe('re-initialization', () => {
    it('should re-initialize when user confirms', async () => {
      configStore.exists.resolves(true)
      configStore.read.resolves(BrvConfig.fromSpace(testSpaces[0], 'chat.log', 'Claude Code', '/test/cwd'))
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
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
      configStore.read.resolves(BrvConfig.fromSpace(testSpaces[0], 'chat.log', 'Claude Code', '/test/cwd'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
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
      configStore.read.resolves(BrvConfig.fromSpace(testSpaces[0], 'chat.log', 'Claude Code', '/test/cwd'))
      configStore.write.resolves()
      tokenStore.load.resolves(validToken)
      teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
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
      configStore.read.resolves(BrvConfig.fromSpace(testSpaces[0], 'chat.log', 'Claude Code', '/test/cwd'))

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      command.mockConfirmResult = true
      command.mockCleanupError = new Error('Permission denied')

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to clean up existing data')
        expect((error as Error).message).to.include('Permission denied')
      }
    })

    it('should handle corrupted config file', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves() // Corrupted/unreadable - returns undefined

      const command = new TestableInit(
        configStore,
        contextTreeService,
        playbookService,
        spaceService,
        teamService,
        tokenStore,
        trackingService,
        testTeams[0],
        testSpaces[0],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Configuration file exists but cannot be read')
      }

      expect(tokenStore.load.calledOnce).to.be.true // Auth happens first
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })
  })
})
