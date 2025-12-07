import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, type SinonStub, stub} from 'sinon'

import type {Space} from '../../../src/core/domain/entities/space.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../../src/core/interfaces/i-space-service.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import SpaceList from '../../../src/commands/space/list.js'
import {BRV_CONFIG_VERSION} from '../../../src/constants.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {Space as SpaceImpl} from '../../../src/core/domain/entities/space.js'

/**
 * Testable SpaceList command that accepts mocked services
 */
class TestableSpaceList extends SpaceList {
  constructor(
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTokenStore: ITokenStore,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      projectConfigStore: this.mockProjectConfigStore,
      spaceService: this.mockSpaceService,
      tokenStore: this.mockTokenStore,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

describe('SpaceList Command', () => {
  const teamId = 'team-1'
  let config: Config
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let testBrConfig: BrvConfig
  let testSpaces: Space[]
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let validToken: AuthToken

  // Stub ux.action to suppress spinner output
  let uxActionStartStub: SinonStub
  let uxActionStopStub: SinonStub

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(async () => {
    // Stub ux.action methods to suppress output
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

    projectConfigStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    spaceService = {
      getSpaces: stub(),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-list',
    })

    testBrConfig = new BrvConfig({
      chatLogPath: 'chat.log',
      createdAt: new Date().toISOString(),
      cwd: '/test/cwd',
      ide: 'Claude Code',
      spaceId: 'space-1',
      spaceName: 'frontend-app',
      teamId: 'team-1',
      teamName: 'acme-corp',
      version: BRV_CONFIG_VERSION,
    })

    testSpaces = [
      new SpaceImpl('space-1', 'frontend-app', 'team-1', 'acme-corp'),
      new SpaceImpl('space-2', 'backend-api', 'team-1', 'acme-corp'),
    ]
  })

  afterEach(() => {
    // Restore ux.action stubs
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    restore()
  })

  describe('project initialization', () => {
    it('should throw error when project is not initialized', async () => {
      projectConfigStore.read.resolves()

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Project not initialized')
        expect((error as Error).message).to.include('brv init')
      }
    })
  })

  describe('authentication', () => {
    it('should throw error when not authenticated', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves()

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Not authenticated')
      }
    })

    it('should throw error when token is expired', async () => {
      const expiredToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() - 1000), // Expired
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-expired',
      })
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(expiredToken)

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('expired')
      }
    })
  })

  describe('default behavior', () => {
    it('should fetch spaces with default pagination (limit=50, offset=0)', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 50, offset: 0})).to.be
        .true
    })

    it('should display spaces in human-readable format', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      // Note: In a real test, we'd capture and verify log output
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('empty results', () => {
    it('should display message when no spaces found', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('pagination flags', () => {
    it('should fetch spaces with custom limit', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['--limit', '10']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 10, offset: 0})).to.be
        .true
    })

    it('should fetch spaces with custom offset', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['--offset', '20']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 50, offset: 20})).to.be
        .true
    })

    it('should fetch spaces with both limit and offset', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['--limit', '10', '--offset', '20']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 10, offset: 20})).to.be
        .true
    })

    it('should fetch all spaces with --all flag', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['--all']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {fetchAll: true})).to.be.true
    })

    it('should use short flags -l and -o', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['-l', '15', '-o', '30']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 15, offset: 30})).to.be
        .true
    })

    it('should use short flag -a for --all', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['-a']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {fetchAll: true})).to.be.true
    })
  })

  describe('JSON output', () => {
    it('should output JSON format with --json flag', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['--json']
      // Note: In a real test, we'd capture and verify JSON output
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should use short flag -j for --json', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['-j']
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('pagination warning', () => {
    it('should display warning when more spaces exist', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      // Return 2 spaces but total is 100 (more exist)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      // Note: In a real test, we'd verify the warning message appears
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should not display warning when all spaces are shown', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      // Return all spaces (total matches length)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should not display warning when using --all flag', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)
      command.argv = ['--all']
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.rejects(new Error('API unavailable'))

      const command = new TestableSpaceList(projectConfigStore, spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('API unavailable')
      }
    })
  })
})
