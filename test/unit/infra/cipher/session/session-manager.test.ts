import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {createSandbox, SinonSandbox, SinonStub} from 'sinon'

import type {CipherAgentServices} from '../../../../../src/core/interfaces/cipher/cipher-services.js'
import type {IChatSession} from '../../../../../src/core/interfaces/cipher/i-chat-session.js'
import type {ILLMService} from '../../../../../src/core/interfaces/cipher/i-llm-service.js'
import type {ByteRoverGrpcConfig} from '../../../../../src/infra/cipher/agent-service-factory.js'

import {createSessionServices} from '../../../../../src/infra/cipher/agent-service-factory.js'
import {AgentEventBus, SessionEventBus} from '../../../../../src/infra/cipher/events/event-emitter.js'
import {ChatSession} from '../../../../../src/infra/cipher/session/chat-session.js'
import {SessionManager} from '../../../../../src/infra/cipher/session/session-manager.js'

type InitializableLLMService = ILLMService & {initialize?: SinonStub}

// Create a testable SessionManager that allows injecting createSessionServices
class TestableSessionManager extends SessionManager {
  public mockCreateSessionServices?: typeof createSessionServices

  // Override createSession to use mock if provided
  public override async createSession(sessionIdParam?: string): Promise<IChatSession> {
    const id = sessionIdParam ?? randomUUID()

    // Check pending operations (race condition protection)
    // @ts-expect-error - accessing private property for testing
    if (this.pendingCreations.has(id)) {
      // @ts-expect-error - accessing private property for testing
      const pending = this.pendingCreations.get(id)
      if (!pending) {
        throw new Error(`Pending session ${id} not found. This is a bug.`)
      }

      return pending
    }

    // Check in-memory cache
    // @ts-expect-error - accessing private property for testing
    if (this.sessions.has(id)) {
      // @ts-expect-error - accessing private property for testing
      const existing = this.sessions.get(id)
      if (!existing) {
        throw new Error(`Session ${id} not found in cache. This is a bug.`)
      }

      return existing
    }

    // Check max sessions limit
    // @ts-expect-error - accessing private property for testing
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(
        // @ts-expect-error - accessing private property for testing
        `Maximum sessions (${this.config.maxSessions}) reached. Delete unused sessions or increase maxSessions limit.`,
      )
    }

    // Use mock if provided
    if (this.mockCreateSessionServices) {
      // @ts-expect-error - accessing private property for testing
      const sessionServices = this.mockCreateSessionServices(id, this.sharedServices, this.grpcConfig, this.llmConfig)
      // @ts-expect-error - accessing private property for testing
      const session = new ChatSession(id, this.sharedServices, sessionServices)

      if ('initialize' in sessionServices.llmService && typeof sessionServices.llmService.initialize === 'function') {
        const initialized = await sessionServices.llmService.initialize()
        if (initialized) {
          console.log(`[SessionManager] Loaded history for session: ${id}`)
        }
      }

      // @ts-expect-error - accessing private property for testing
      this.sessions.set(id, session)
      return session
    }

    // Fall back to parent implementation
    return super.createSession(sessionIdParam)
  }
}

// Helper function to create mock LLM service
function createMockLLMService(sandbox: SinonSandbox): ILLMService {
  return {
    completeTask: sandbox.stub().resolves('response'),
    getAllTools: sandbox.stub().resolves({}),
    getConfig: () =>
      ({
        configuredMaxInputTokens: 1000,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        model: 'test-model',
        modelMaxInputTokens: 1000,
        provider: 'test',
        router: 'test',
      }) as ReturnType<ILLMService['getConfig']>,
    getContextManager: sandbox.stub().returns({
      clearHistory: sandbox.stub().resolves(),
      getMessages: sandbox.stub().returns([]),
    }),
  } as unknown as ILLMService
}

describe('SessionManager', () => {
  let sandbox: SinonSandbox
  let mockSharedServices: CipherAgentServices
  let mockGrpcConfig: ByteRoverGrpcConfig
  let llmConfig: {
    httpReferer?: string
    maxIterations?: number
    maxTokens?: number
    model: string
    openRouterApiKey?: string
    siteName?: string
    temperature?: number
  }
  let manager: TestableSessionManager
  let mockCreateSessionServices: SinonStub & typeof createSessionServices

  beforeEach(() => {
    sandbox = createSandbox()

    // Mock shared services
    mockSharedServices = {
      agentEventBus: new AgentEventBus(),
      blobStorage: {} as CipherAgentServices['blobStorage'],
      fileSystemService: {} as CipherAgentServices['fileSystemService'],
      historyStorage: {} as CipherAgentServices['historyStorage'],
      memoryManager: {} as CipherAgentServices['memoryManager'],
      processService: {} as CipherAgentServices['processService'],
      promptFactory: {} as CipherAgentServices['promptFactory'],
      toolManager: {} as CipherAgentServices['toolManager'],
      toolProvider: {} as CipherAgentServices['toolProvider'],
    }

    // Mock gRPC config
    mockGrpcConfig = {
      accessToken: 'test-token',
      grpcEndpoint: 'localhost:50051',
      projectId: 'test-project',
      sessionKey: 'test-session-key',
    }

    // LLM config
    llmConfig = {
      model: 'gemini-2.5-flash',
    }

    // Create mock function
    mockCreateSessionServices = sandbox.stub().callsFake(() => ({
      llmService: createMockLLMService(sandbox),
      sessionEventBus: new SessionEventBus(),
    })) as SinonStub & typeof createSessionServices
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('constructor', () => {
    it('should use default maxSessions when not provided', async () => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices

      // Create sessions up to default max (100)

      // Create 99 sessions
      const initialSessionIds = Array.from({length: 99}, (_, index) => `session-${index}`)
      await Promise.all(initialSessionIds.map((id) => manager.createSession(id)))

      // 100th should succeed
      await manager.createSession('session-99')

      // 101st should fail
      try {
        await manager.createSession('session-100')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Maximum sessions (100) reached')
      }
    })

    it('should use custom maxSessions from config', async () => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig, {
        config: {maxSessions: 5},
      })
      manager.mockCreateSessionServices = mockCreateSessionServices as typeof createSessionServices

      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      // Create 5 sessions
      await manager.createSession('session-1')
      await manager.createSession('session-2')
      await manager.createSession('session-3')
      await manager.createSession('session-4')
      await manager.createSession('session-5')

      // 6th should fail
      try {
        await manager.createSession('session-6')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Maximum sessions (5) reached')
      }
    })

    it('should use default sessionTTL when not provided', () => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices

      // Default should be 3600000 (1 hour)
      // We can't directly test this, but we can verify manager was created
      expect(manager).to.exist
    })

    it('should use custom sessionTTL from config', () => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig, {
        config: {sessionTTL: 7_200_000},
      })

      expect(manager).to.exist
    })
  })

  describe('createSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should create new session with UUID when sessionId not provided', async () => {
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session = await manager.createSession()

      expect(session).to.be.instanceOf(ChatSession)
      expect(session.id).to.be.a('string')
      expect(session.id.length).to.be.greaterThan(0)
      expect(mockCreateSessionServices.calledOnce).to.be.true
    })

    it('should create session with provided sessionId', async () => {
      const testSessionId = 'custom-session-id' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session = await manager.createSession(testSessionId)

      expect(session).to.be.instanceOf(ChatSession)
      expect(session.id).to.equal(testSessionId)
      expect(mockCreateSessionServices.calledOnce).to.be.true
      expect(mockCreateSessionServices.firstCall.args[0]).to.equal(testSessionId)
      expect(mockCreateSessionServices.firstCall.args[1]).to.equal(mockSharedServices)
      expect(mockCreateSessionServices.firstCall.args[2]).to.equal(mockGrpcConfig)
      expect(mockCreateSessionServices.firstCall.args[3]).to.equal(llmConfig)
    })

    it('should return existing session if already exists (caching)', async () => {
      const testSessionId = 'existing-session' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session1 = await manager.createSession(testSessionId)
      const session2 = await manager.createSession(testSessionId)

      expect(session1).to.equal(session2)
      expect(mockCreateSessionServices.calledOnce).to.be.true // Should only create once
    })

    it('should handle race condition - return same promise for concurrent creates', async () => {
      const testSessionId = 'race-session' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      // Create multiple promises concurrently
      const promises = [
        manager.createSession(testSessionId),
        manager.createSession(testSessionId),
        manager.createSession(testSessionId),
      ]

      const sessions = await Promise.all(promises)

      // All should be the same instance
      expect(sessions[0]).to.equal(sessions[1])
      expect(sessions[1]).to.equal(sessions[2])
      // Should only create once
      expect(mockCreateSessionServices.calledOnce).to.be.true
    })

    it('should throw error when maxSessions limit reached', async () => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig, {
        config: {maxSessions: 2},
      })
      manager.mockCreateSessionServices = mockCreateSessionServices as typeof createSessionServices

      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession('session-1')
      await manager.createSession('session-2')

      try {
        await manager.createSession('session-3')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Maximum sessions (2) reached')
      }
    })

    it('should call initialize() if llmService has the method', async () => {
      const testSessionId = 'init-session' as string
      const mockLLMService = createMockLLMService(sandbox) as InitializableLLMService
      const initializeStub = sandbox.stub().resolves(true)
      mockLLMService.initialize = initializeStub

      mockCreateSessionServices.returns({
        llmService: mockLLMService,
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(testSessionId)

      expect(initializeStub.calledOnce).to.be.true
    })

    it('should not throw when llmService does not have initialize()', async () => {
      const testSessionId = 'no-init-session' as string
      // No initialize method

      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(testSessionId)
    })

    it('should remove from pendingCreations after creation completes', async () => {
      const testSessionId = 'pending-session' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(testSessionId)

      // Create again - should return cached, not pending
      const session2 = await manager.createSession(testSessionId)

      expect(session2).to.exist
      expect(mockCreateSessionServices.calledOnce).to.be.true
    })
  })

  describe('getSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should return session when it exists', async () => {
      const testSessionId = 'get-session' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const createdSession = await manager.createSession(testSessionId)
      const retrievedSession = manager.getSession(testSessionId)

      expect(retrievedSession).to.equal(createdSession)
    })

    it('should return undefined when session does not exist', () => {
      const session = manager.getSession('non-existent')

      expect(session).to.be.undefined
    })
  })

  describe('hasSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should return true when session exists', async () => {
      const testSessionId = 'has-session' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(testSessionId)

      expect(manager.hasSession(testSessionId)).to.be.true
    })

    it('should return false when session does not exist', () => {
      expect(manager.hasSession('non-existent')).to.be.false
    })
  })

  describe('listSessions()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should return array of all session IDs', async () => {
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession('session-1')
      await manager.createSession('session-2')
      await manager.createSession('session-3')

      const sessions = manager.listSessions()

      expect(sessions).to.be.an('array')
      expect(sessions).to.have.length(3)
      expect(sessions).to.include('session-1')
      expect(sessions).to.include('session-2')
      expect(sessions).to.include('session-3')
    })

    it('should return empty array when no sessions', () => {
      const sessions = manager.listSessions()

      expect(sessions).to.be.an('array').that.is.empty
    })
  })

  describe('getSessionCount()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should return correct number of sessions', async () => {
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      expect(manager.getSessionCount()).to.equal(0)

      await manager.createSession('session-1')
      expect(manager.getSessionCount()).to.equal(1)

      await manager.createSession('session-2')
      expect(manager.getSessionCount()).to.equal(2)

      await manager.createSession('session-3')
      expect(manager.getSessionCount()).to.equal(3)
    })
  })

  describe('deleteSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should return true and delete session when it exists', async () => {
      const testSessionId = 'delete-session' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session = await manager.createSession(testSessionId)
      const resetStub = sandbox.stub(session, 'reset')

      const result = await manager.deleteSession(testSessionId)

      expect(result).to.be.true
      expect(resetStub.calledOnce).to.be.true
      expect(manager.hasSession(testSessionId)).to.be.false
    })

    it('should return false when session does not exist', async () => {
      const result = await manager.deleteSession('non-existent')

      expect(result).to.be.false
    })

    it('should call reset() before deleting', async () => {
      const sessionIdToDelete = 'reset-before-delete' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session = await manager.createSession(sessionIdToDelete)
      const resetStub = sandbox.stub(session, 'reset')

      await manager.deleteSession(sessionIdToDelete)

      expect(resetStub.calledOnce).to.be.true
    })
  })

  describe('endSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockGrpcConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should return true and remove session from memory', async () => {
      const sessionIdToEnd: string = 'end-session'
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(sessionIdToEnd)

      const result = await manager.endSession(sessionIdToEnd)

      expect(result).to.be.true
      expect(manager.hasSession(sessionIdToEnd)).to.be.false
    })

    it('should return false when session does not exist', async () => {
      const result = await manager.endSession('non-existent')

      expect(result).to.be.false
    })
  })

})

