/// <reference types="mocha" />

import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {BrvConfig} from '../../src/core/domain/entities/brv-config.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import {BRV_CONFIG_VERSION} from '../../src/constants.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrvConfig as BrvConfigImpl} from '../../src/core/domain/entities/brv-config.js'
import {CipherAgent} from '../../src/infra/cipher/agent/index.js'
import {QueryUseCase, type QueryUseCaseOptions} from '../../src/infra/usecase/query-use-case.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

// ==================== Mock CipherAgent ====================

class MockCipherAgent {
  public agentEventBus = {
    on: stub(),
  }
  public createSessionCalled = false
  public executeCalled = false
  public executeResponse = 'Mock query response'
  public startCalled = false

  async createSession(_sessionId: string): Promise<void> {
    this.createSessionCalled = true
  }

  async execute(_prompt: string, _sessionId: string, _options: unknown): Promise<string> {
    this.executeCalled = true
    return this.executeResponse
  }

  async start(): Promise<void> {
    this.startCalled = true
  }

  async stop(): Promise<void> {
    // Mock stop
  }
}

// ==================== TestableQueryUseCase ====================

interface TestableQueryUseCaseOptions extends QueryUseCaseOptions {
  mockCipherAgent?: MockCipherAgent
}

class TestableQueryUseCase extends QueryUseCase {
  private readonly mockCipherAgent?: MockCipherAgent

  constructor(options: TestableQueryUseCaseOptions) {
    super(options)
    this.mockCipherAgent = options.mockCipherAgent
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected createCipherAgent(_llmConfig: any, _brvConfig: BrvConfig): CipherAgent {
    return this.mockCipherAgent as unknown as CipherAgent
  }

  protected generateSessionId(): string {
    return 'test-session-id'
  }
}

// ==================== Tests ====================

describe('Query Command', () => {
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let loggedMessages: string[]
  let mockCipherAgent: MockCipherAgent
  let terminal: ITerminal
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let validToken: AuthToken
  let testConfig: BrvConfigImpl

  beforeEach(() => {
    loggedMessages = []

    terminal = createMockTerminal({
      log: (msg) => msg && loggedMessages.push(msg),
    })

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    mockCipherAgent = new MockCipherAgent()

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-123',
    })

    testConfig = new BrvConfigImpl({
      chatLogPath: 'chat.log',
      createdAt: new Date().toISOString(),
      cwd: '/test/cwd',
      ide: 'Claude Code',
      spaceId: 'space-1',
      spaceName: 'backend-api',
      teamId: 'team-1',
      teamName: 'acme-corp',
      version: BRV_CONFIG_VERSION,
    })
  })

  afterEach(() => {
    restore()
  })

  function createTestUseCase(): TestableQueryUseCase {
    return new TestableQueryUseCase({
      mockCipherAgent,
      terminal,
      trackingService,
    })
  }

  describe('authentication', () => {
    it('should exit early if not authenticated', async () => {
      tokenStore.load.resolves()

      const useCase = createTestUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(tokenStore.load.calledOnce).to.be.true
      expect(loggedMessages.some((m) => m.includes('Authentication required'))).to.be.true
      expect(mockCipherAgent.startCalled).to.be.false
    })
  })

  describe('project configuration', () => {
    it('should exit early if project is not initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves()

      const useCase = createTestUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(configStore.read.calledOnce).to.be.true
      expect(loggedMessages.some((m) => m.includes('Project not initialized'))).to.be.true
      expect(mockCipherAgent.startCalled).to.be.false
    })
  })

  describe('query execution', () => {
    it('should execute query successfully', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(testConfig)

      const useCase = createTestUseCase()

      await useCase.run({query: 'What is the architecture?', verbose: false})

      expect(mockCipherAgent.startCalled).to.be.true
      expect(mockCipherAgent.executeCalled).to.be.true
      expect(loggedMessages.some((m) => m.includes('Querying context tree'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Query Results'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Mock query response'))).to.be.true
    })

    it('should track query after successful execution', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(testConfig)

      const useCase = createTestUseCase()

      await useCase.run({query: 'What is the architecture?', verbose: false})

      expect(trackingService.track.calledWith('mem:query')).to.be.true
    })
  })
})
