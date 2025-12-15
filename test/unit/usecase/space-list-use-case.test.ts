import {expect} from 'chai'
import * as sinon from 'sinon'

import type {Space} from '../../../src/core/domain/entities/space.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../../src/core/interfaces/i-space-service.js'
import type {ITerminal} from '../../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import {BRV_CONFIG_VERSION} from '../../../src/constants.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {Space as SpaceImpl} from '../../../src/core/domain/entities/space.js'
import {type SpaceListFlags, SpaceListUseCase} from '../../../src/infra/usecase/space-list-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

const createMockToken = (): AuthToken =>
  new AuthToken({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: 'refresh-token',
    sessionKey: 'session-key',
    tokenType: 'Bearer',
    userEmail: 'user@example.com',
    userId: 'user-123',
  })

const createExpiredToken = (): AuthToken =>
  new AuthToken({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() - 1000), // Expired
    refreshToken: 'refresh-token',
    sessionKey: 'session-key',
    tokenType: 'Bearer',
    userEmail: 'user@example.com',
    userId: 'user-expired',
  })

const createMockConfig = (): BrvConfig =>
  new BrvConfig({
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

const createMockSpaces = (): Space[] => [
  new SpaceImpl('space-1', 'frontend-app', 'team-1', 'acme-corp'),
  new SpaceImpl('space-2', 'backend-api', 'team-1', 'acme-corp'),
]

// ==================== Tests ====================

describe('SpaceListUseCase', () => {
  let errorMessages: string[]
  let logMessages: string[]
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let terminal: ITerminal
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>

  beforeEach(() => {
    errorMessages = []
    logMessages = []

    terminal = createMockTerminal({
      error: (msg) => errorMessages.push(msg),
      log: (msg) => msg !== undefined && logMessages.push(msg),
    })

    projectConfigStore = {
      exists: sinon.stub(),
      read: sinon.stub(),
      write: sinon.stub(),
    }

    tokenStore = {
      clear: sinon.stub(),
      load: sinon.stub(),
      save: sinon.stub(),
    }

    spaceService = {
      getSpaces: sinon.stub(),
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  function createUseCase(flags: Partial<SpaceListFlags> = {}): SpaceListUseCase {
    return new SpaceListUseCase({
      flags: {all: false, json: false, limit: 50, offset: 0, ...flags},
      projectConfigStore,
      spaceService,
      terminal,
      tokenStore,
    })
  }

  describe('Project initialization', () => {
    it('should error if project not initialized', async () => {
      projectConfigStore.read.resolves()

      const useCase = createUseCase()
      await useCase.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Project not initialized')
      expect(errorMessages[0]).to.include('brv init')
    })
  })

  describe('Authentication', () => {
    it('should error if not authenticated', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves()

      const useCase = createUseCase()
      await useCase.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Not authenticated')
    })

    it('should error if token expired', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createExpiredToken())

      const useCase = createUseCase()
      await useCase.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('expired')
    })
  })

  describe('Default behavior', () => {
    it('should fetch spaces with default pagination (limit=50, offset=0)', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const useCase = createUseCase()
      await useCase.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {limit: 50, offset: 0})).to.be
        .true
    })

    it('should display spaces in human-readable format', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const useCase = createUseCase()
      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(logMessages.some((m) => m.includes('frontend-app'))).to.be.true
      expect(logMessages.some((m) => m.includes('backend-api'))).to.be.true
    })
  })

  describe('Empty results', () => {
    it('should display message when no spaces found', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const useCase = createUseCase()
      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(logMessages.some((m) => m.includes('No spaces found'))).to.be.true
    })
  })

  describe('Pagination flags', () => {
    it('should fetch spaces with custom limit', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 100})

      const useCase = createUseCase({limit: 10})
      await useCase.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {limit: 10, offset: 0})).to.be
        .true
    })

    it('should fetch spaces with custom offset', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 100})

      const useCase = createUseCase({offset: 20})
      await useCase.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {limit: 50, offset: 20})).to.be
        .true
    })

    it('should fetch spaces with both limit and offset', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 100})

      const useCase = createUseCase({limit: 10, offset: 20})
      await useCase.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {limit: 10, offset: 20})).to.be
        .true
    })

    it('should fetch all spaces with --all flag', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const useCase = createUseCase({all: true})
      await useCase.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {fetchAll: true})).to.be.true
    })
  })

  describe('JSON output', () => {
    it('should output JSON format with --json flag', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const useCase = createUseCase({json: true})
      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      // Find the JSON output message
      const jsonOutput = logMessages.find((m) => m.includes('"spaces"'))
      expect(jsonOutput).to.exist
      const parsed = JSON.parse(jsonOutput!)
      expect(parsed.spaces).to.have.lengthOf(2)
      expect(parsed.total).to.equal(2)
    })
  })

  describe('Pagination warning', () => {
    it('should display warning when more spaces exist', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      // Return 2 spaces but total is 100 (more exist)
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 100})

      const useCase = createUseCase()
      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(logMessages.some((m) => m.includes('Showing 2 of 100'))).to.be.true
    })

    it('should not display warning when all spaces are shown', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      // Return all spaces (total matches length)
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const useCase = createUseCase()
      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(logMessages.some((m) => m.includes('Showing'))).to.be.false
    })

    it('should not display warning when using --all flag', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const useCase = createUseCase({all: true})
      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(logMessages.some((m) => m.includes('Showing'))).to.be.false
    })
  })

  describe('Error handling', () => {
    it('should propagate API errors', async () => {
      projectConfigStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      spaceService.getSpaces.rejects(new Error('API unavailable'))

      const useCase = createUseCase()

      try {
        await useCase.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('API unavailable')
      }
    })
  })
})
