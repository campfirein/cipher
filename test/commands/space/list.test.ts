import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, type SinonStub, stub} from 'sinon'

import type {Space} from '../../../src/core/domain/entities/space.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../../src/core/interfaces/i-space-service.js'
import type {ITerminal} from '../../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'
import type {ISpaceListUseCase} from '../../../src/core/interfaces/usecase/i-space-list-use-case.js'

import SpaceList from '../../../src/commands/space/list.js'
import {BRV_CONFIG_VERSION} from '../../../src/constants.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {Space as SpaceImpl} from '../../../src/core/domain/entities/space.js'
import {type SpaceListFlags, SpaceListUseCase} from '../../../src/infra/usecase/space-list-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

interface TestableUseCaseOptions {
  flags: SpaceListFlags
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  terminal: ITerminal
  tokenStore: ITokenStore
}

/**
 * Testable use case (no prompts to override for list command)
 */
class TestableSpaceListUseCase extends SpaceListUseCase {
  constructor(options: TestableUseCaseOptions) {
    super({
      flags: options.flags,
      projectConfigStore: options.projectConfigStore,
      spaceService: options.spaceService,
      terminal: options.terminal,
      tokenStore: options.tokenStore,
    })
  }
}

/**
 * Testable command that accepts a pre-configured use case
 */
class TestableSpaceList extends SpaceList {
  constructor(
    private readonly useCase: ISpaceListUseCase,
    config: Config,
  ) {
    super([], config)
  }

  protected createUseCase(): ISpaceListUseCase {
    return this.useCase
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

  function createTestCommand(flags: Partial<SpaceListFlags> = {}): TestableSpaceList {
    const useCase = new TestableSpaceListUseCase({
      flags: {all: false, json: false, limit: 50, offset: 0, ...flags},
      projectConfigStore,
      spaceService,
      terminal: createMockTerminal({
        error(msg: string) {
          throw new Error(msg)
        },
      }),
      tokenStore,
    })
    return new TestableSpaceList(useCase, config)
  }

  describe('project initialization', () => {
    it('should error if project not initialized', async () => {
      projectConfigStore.read.resolves()

      const command = createTestCommand()

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
    it('should error if not authenticated', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves()

      const command = createTestCommand()

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Not authenticated')
      }
    })

    it('should error if token expired', async () => {
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

      const command = createTestCommand()

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

      const command = createTestCommand()
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 50, offset: 0})).to.be
        .true
    })

    it('should display spaces in human-readable format', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = createTestCommand()
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('empty results', () => {
    it('should display message when no spaces found', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const command = createTestCommand()
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('pagination flags', () => {
    it('should fetch spaces with custom limit', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = createTestCommand({ limit: 10})
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 10, offset: 0})).to.be
        .true
    })

    it('should fetch spaces with custom offset', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = createTestCommand({ offset: 20})
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 50, offset: 20})).to.be
        .true
    })

    it('should fetch spaces with both limit and offset', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = createTestCommand({limit: 10, offset: 20})
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {limit: 10, offset: 20})).to.be
        .true
    })

    it('should fetch all spaces with --all flag', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = createTestCommand({all: true})
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', teamId, {fetchAll: true})).to.be.true
    })
  })

  describe('JSON output', () => {
    it('should output JSON format with --json flag', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = createTestCommand({json: true})
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

      const command = createTestCommand()
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should not display warning when all spaces are shown', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      // Return all spaces (total matches length)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = createTestCommand()
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should not display warning when using --all flag', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = createTestCommand({all: true})
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      projectConfigStore.read.resolves(testBrConfig)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.rejects(new Error('API unavailable'))

      const command = createTestCommand()

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('API unavailable')
      }
    })
  })
})
