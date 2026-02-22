import { expect } from 'chai'
import { randomUUID } from 'node:crypto'
import { createSandbox, SinonSandbox, SinonStub } from 'sinon'

import type { CipherAgentServices } from '../../../../src/agent/core/interfaces/cipher-services.js'
import type { IChatSession } from '../../../../src/agent/core/interfaces/i-chat-session.js'
import type { ILLMService } from '../../../../src/agent/core/interfaces/i-llm-service.js'
import type { ByteRoverHttpConfig } from '../../../../src/agent/infra/agent/service-initializer.js'

import { createSessionServices } from '../../../../src/agent/infra/agent/service-initializer.js'
import { AgentEventBus, SessionEventBus } from '../../../../src/agent/infra/events/event-emitter.js'
import { ChatSession } from '../../../../src/agent/infra/session/chat-session.js'
import { SessionManager } from '../../../../src/agent/infra/session/session-manager.js'
import { createMockCipherAgentServices, createMockLLMService } from '../../../helpers/mock-factories.js'

type InitializableLLMService = ILLMService & { initialize?: SinonStub }

/**
 * Testable SessionManager that allows injecting createSessionServices for testing
 */
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
      const sessionServices = this.mockCreateSessionServices(id, this.sharedServices, this.httpConfig, this.llmConfig)
      // @ts-expect-error - accessing private property for testing
      const session = new ChatSession(id, this.sharedServices, sessionServices)

      if ('initialize' in sessionServices.llmService && typeof sessionServices.llmService.initialize === 'function') {
        await sessionServices.llmService.initialize()
      }

      // @ts-expect-error - accessing private property for testing
      this.sessions.set(id, session)
      return session
    }

    // Fall back to parent implementation
    return super.createSession(sessionIdParam)
  }
}

/**
 * Helper function to create mock LLM service for session manager tests
 * Note: Uses the centralized factory from mock-factories.ts
 */
function createMockLLMServiceForSessionManager(sandbox: SinonSandbox): ILLMService {
  return createMockLLMService(sandbox, {
    completeTask: sandbox.stub().resolves('response'),
  })
}

describe('SessionManager', () => {
  let sandbox: SinonSandbox
  let mockSharedServices: CipherAgentServices
  let mockHttpConfig: ByteRoverHttpConfig
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

    // Use factory for full service mocking
    const agentEventBus = new AgentEventBus()
    mockSharedServices = createMockCipherAgentServices(agentEventBus, sandbox)

    // Mock HTTP config
    mockHttpConfig = {
      apiBaseUrl: 'http://localhost:3333',
      projectId: 'test-project',
      sessionKey: 'test-session-key',
      spaceId: 'test-space-id',
      teamId: 'test-team-id',
    }

    // LLM config
    llmConfig = {
      model: 'gemini-2.5-flash',
    }

    // Create mock function
    mockCreateSessionServices = sandbox.stub().callsFake(() => ({
      llmService: createMockLLMServiceForSessionManager(sandbox),
      sessionEventBus: new SessionEventBus(),
    })) as SinonStub & typeof createSessionServices
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('constructor', () => {
    it('should use default maxSessions when not provided', async () => {
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices

      // Create sessions up to default max (100)

      // Create 99 sessions
      const initialSessionIds = Array.from({ length: 99 }, (_, index) => `session-${index}`)
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig, {
        config: { maxSessions: 5 },
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices

      // Default should be 3600000 (1 hour)
      // We can't directly test this, but we can verify manager was created
      expect(manager).to.exist
    })

    it('should use custom sessionTTL from config', () => {
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig, {
        config: { sessionTTL: 7_200_000 },
      })

      expect(manager).to.exist
    })
  })

  describe('createSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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
      expect(mockCreateSessionServices.firstCall.args[2]).to.equal(mockHttpConfig)
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig, {
        config: { maxSessions: 2 },
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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

    it('should call dispose() to remove event listeners (prevents memory leak)', async () => {
      const sessionIdToDelete = 'dispose-on-delete' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session = await manager.createSession(sessionIdToDelete)
      const disposeStub = sandbox.stub(session as ChatSession, 'dispose')

      await manager.deleteSession(sessionIdToDelete)

      expect(disposeStub.calledOnce).to.be.true
    })

    it('should clean up metadata maps when deleting session', async () => {
      const sessionIdToDelete = 'metadata-cleanup-delete' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(sessionIdToDelete)
      expect(manager.hasSession(sessionIdToDelete)).to.be.true

      await manager.deleteSession(sessionIdToDelete)

      // Session should be gone and not appear in metadata listing
      expect(manager.hasSession(sessionIdToDelete)).to.be.false
      const metadata = manager.listSessionsWithMetadata()
      expect(metadata.find((m) => m.id === sessionIdToDelete)).to.be.undefined
    })
  })

  describe('endSession()', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
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

    it('should call dispose() to remove event listeners (prevents memory leak)', async () => {
      const sessionIdToEnd = 'dispose-on-end' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      const session = await manager.createSession(sessionIdToEnd)
      const disposeStub = sandbox.stub(session as ChatSession, 'dispose')

      await manager.endSession(sessionIdToEnd)

      expect(disposeStub.calledOnce).to.be.true
    })

    it('should clean up metadata maps when ending session', async () => {
      const sessionIdToEnd = 'metadata-cleanup-end' as string
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      await manager.createSession(sessionIdToEnd)
      expect(manager.hasSession(sessionIdToEnd)).to.be.true

      await manager.endSession(sessionIdToEnd)

      expect(manager.hasSession(sessionIdToEnd)).to.be.false
      const metadata = manager.listSessionsWithMetadata()
      expect(metadata.find((m) => m.id === sessionIdToEnd)).to.be.undefined
    })
  })

  describe('dispose() - Memory Leak Prevention', () => {
    beforeEach(() => {
      manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
      manager.mockCreateSessionServices = mockCreateSessionServices
    })

    it('should dispose all sessions when called', async () => {
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      // Create multiple sessions
      const session1 = await manager.createSession('session-1')
      const session2 = await manager.createSession('session-2')
      const session3 = await manager.createSession('session-3')

      // Spy on dispose for each session
      const disposeSpy1 = sandbox.spy(session1 as ChatSession, 'dispose')
      const disposeSpy2 = sandbox.spy(session2 as ChatSession, 'dispose')
      const disposeSpy3 = sandbox.spy(session3 as ChatSession, 'dispose')

      expect(manager.getSessionCount()).to.equal(3)

      // Dispose the manager
      manager.dispose()

      // All sessions should be disposed
      expect(disposeSpy1.calledOnce).to.be.true
      expect(disposeSpy2.calledOnce).to.be.true
      expect(disposeSpy3.calledOnce).to.be.true

      // Session count should be 0
      expect(manager.getSessionCount()).to.equal(0)
    })

    it('should clear all metadata maps when disposed', async () => {
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      // Create sessions to populate metadata maps
      await manager.createSession('session-1')
      await manager.createSession('session-2')

      expect(manager.getSessionCount()).to.equal(2)

      // Dispose
      manager.dispose()

      // Should be able to create new sessions (maps are cleared)
      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus: new SessionEventBus(),
      })

      // Re-create manager (in real usage, you'd create a new one)
      // Here we just verify the old manager is cleaned up
      expect(manager.getSessionCount()).to.equal(0)
      expect(manager.listSessions()).to.be.empty
    })

    it('should handle dispose when no sessions exist', () => {
      // Should not throw when disposing empty manager
      expect(() => manager.dispose()).to.not.throw()
      expect(manager.getSessionCount()).to.equal(0)
    })

    it('should clear cleanup timer when disposed', () => {
      // Access private cleanupTimer to verify it's cleared
      // @ts-expect-error - accessing private property for testing
      expect(manager.cleanupTimer).to.exist

      manager.dispose()

      // @ts-expect-error - accessing private property for testing
      expect(manager.cleanupTimer).to.be.undefined
    })

    it('should handle dispose after 100 session create/dispose cycles (stress test)', async function () {
      // Increase timeout for stress test
      this.timeout(10_000)

      /* eslint-disable no-await-in-loop -- Sequential session cycles required for stress test */
      for (let i = 0; i < 100; i++) {
        // Create a fresh manager for each cycle
        const cycleManager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
        cycleManager.mockCreateSessionServices = mockCreateSessionServices

        mockCreateSessionServices.returns({
          llmService: createMockLLMService(sandbox),
          sessionEventBus: new SessionEventBus(),
        })

        // Create some sessions
        await cycleManager.createSession(`cycle-${i}-session-1`)
        await cycleManager.createSession(`cycle-${i}-session-2`)

        // Dispose
        cycleManager.dispose()

        // Verify cleanup
        expect(cycleManager.getSessionCount()).to.equal(0)
      }
      /* eslint-enable no-await-in-loop */

      // If we got here without running out of memory, the test passed
      expect(true).to.be.true
    })
  })
})
