/**
 * Load tests for SessionManager - verifies no memory leak over many sequential cycles.
 *
 * Background:
 * Before the fix, deleteSession() and endSession() only called session.reset() / session.cleanup()
 * but never session.dispose(). ChatSession.dispose() is the only path that removes event
 * forwarders (21 listeners) from the SessionEventBus.
 *
 * Without dispose(), after N sequential brv query/curate runs:
 *   N × 21 = dangling listeners accumulate → heap exhaustion → V8 abort
 *
 * These tests verify:
 *   1. Listener count on SessionEventBus drops to 0 after each deleteSession() / endSession()
 *   2. Heap memory growth is bounded (not proportional to cycle count)
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {CipherAgentServices} from '../../../../src/agent/core/interfaces/cipher-services.js'
import type {IChatSession} from '../../../../src/agent/core/interfaces/i-chat-session.js'
import type {ILLMService} from '../../../../src/agent/core/interfaces/i-llm-service.js'
import type {ByteRoverHttpConfig} from '../../../../src/agent/infra/agent/service-initializer.js'

import {createSessionServices} from '../../../../src/agent/infra/agent/service-initializer.js'
import {AgentEventBus, SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {ChatSession} from '../../../../src/agent/infra/session/chat-session.js'
import {SessionManager} from '../../../../src/agent/infra/session/session-manager.js'
import {createMockCipherAgentServices, createMockLLMService} from '../../../helpers/mock-factories.js'

// ---------------------------------------------------------------------------
// TestableSessionManager (same pattern as session-manager.test.ts)
// ---------------------------------------------------------------------------

class TestableSessionManager extends SessionManager {
  public mockCreateSessionServices?: typeof createSessionServices

  public override async createSession(sessionIdParam?: string): Promise<IChatSession> {
    const id = sessionIdParam ?? randomUUID()

    // @ts-expect-error - accessing private property for testing
    if (this.pendingCreations.has(id)) {
      // @ts-expect-error - accessing private property for testing
      const pending = this.pendingCreations.get(id)
      if (!pending) throw new Error(`Pending session ${id} not found. This is a bug.`)
      return pending
    }

    // @ts-expect-error - accessing private property for testing
    if (this.sessions.has(id)) {
      // @ts-expect-error - accessing private property for testing
      const existing = this.sessions.get(id)
      if (!existing) throw new Error(`Session ${id} not found in cache. This is a bug.`)
      return existing
    }

    // @ts-expect-error - accessing private property for testing
    if (this.sessions.size >= this.config.maxSessions) {
      // @ts-expect-error - accessing private property for testing
      throw new Error(`Maximum sessions (${this.config.maxSessions}) reached.`)
    }

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

    return super.createSession(sessionIdParam)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count total active listeners across ALL registered event names on a given bus.
 * Should be 0 after dispose().
 * Note: ChatSession registers a subset of session events (14 events) as forwarders.
 */
function countSessionListeners(bus: SessionEventBus): number {
  return bus.eventNames().reduce((sum, name) => sum + bus.listenerCount(name as string), 0)
}

/**
 * Snapshot heap in MB.
 */
function heapMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SessionManager – load tests (memory leak prevention)', function () {
  // Generous timeout for 3000-cycle tests
  this.timeout(120_000)

  let sandbox: SinonSandbox
  let mockSharedServices: CipherAgentServices
  let mockHttpConfig: ByteRoverHttpConfig
  let llmConfig: {model: string}
  let manager: TestableSessionManager
  let mockCreateSessionServices: SinonStub & typeof createSessionServices

  beforeEach(() => {
    sandbox = createSandbox()
    const agentEventBus = new AgentEventBus()
    mockSharedServices = createMockCipherAgentServices(agentEventBus, sandbox)

    mockHttpConfig = {
      apiBaseUrl: 'http://localhost:3333',
      projectId: 'test-project',
      sessionKey: 'test-session-key',
      spaceId: 'test-space-id',
      teamId: 'test-team-id',
    }
    llmConfig = {model: 'test-model'}

    mockCreateSessionServices = sandbox.stub().callsFake(() => ({
      llmService: createMockLLMService(sandbox) as ILLMService,
      sessionEventBus: new SessionEventBus(),
    })) as SinonStub & typeof createSessionServices

    manager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
    manager.mockCreateSessionServices = mockCreateSessionServices
  })

  afterEach(() => {
    manager.dispose()
    sandbox.restore()
  })

  // -------------------------------------------------------------------------
  // Diagnostic: verify ChatSession.dispose() directly removes listeners
  // -------------------------------------------------------------------------

  describe('ChatSession.dispose() – direct verification', () => {
    it('should remove all forwarder listeners from the sessionEventBus', () => {
      const sessionEventBus = new SessionEventBus()
      const session = new ChatSession('direct-test', mockSharedServices, {
        llmService: createMockLLMService(sandbox),
        sessionEventBus,
      })

      const before = countSessionListeners(sessionEventBus)
      expect(before).to.be.greaterThan(0, `ChatSession registered no listeners on creation`)

      session.dispose()

      const after = countSessionListeners(sessionEventBus)
      expect(after).to.equal(
        0,
        `ChatSession.dispose() did not remove listeners. Before: ${before}, after: ${after}. Events still present: ${JSON.stringify(sessionEventBus.eventNames())}`,
      )
    })

    it('deleteSession() should call dispose() and result in 0 listeners', async () => {
      const sessionId = 'diag-delete-test'
      const sessionEventBus = new SessionEventBus()

      mockCreateSessionServices.returns({
        llmService: createMockLLMService(sandbox),
        sessionEventBus,
      })

      const session = await manager.createSession(sessionId)
      // Access the actual eventBus the ChatSession holds (it's public readonly)
      const actualBus = (session as ChatSession).eventBus

      // Verify session was stored
      expect(manager.hasSession(sessionId)).to.be.true
      const before = countSessionListeners(actualBus)
      const externalBefore = countSessionListeners(sessionEventBus)
      expect(before).to.be.greaterThan(0, `No listeners on actual session.eventBus before delete`)
      expect(before).to.equal(externalBefore, `session.eventBus !== external sessionEventBus!`)

      const deleted = await manager.deleteSession(sessionId)
      expect(deleted).to.be.true

      const after = countSessionListeners(actualBus)
      expect(after).to.equal(
        0,
        `After deleteSession(): ${after} listeners remain on session.eventBus (was ${before}). Events: ${JSON.stringify(actualBus.eventNames())}`,
      )
    })
  })

  // -------------------------------------------------------------------------
  // deleteSession() – listener leak (the primary crash bug)
  // -------------------------------------------------------------------------

  describe('deleteSession() – no listener leak', () => {
    const CYCLES = 3000

    it(`should remove all event listeners per session over ${CYCLES} sequential deleteSession() cycles`, async () => {
      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < CYCLES; i++) {
        const sessionId = `query-load-${i}`
        const sessionEventBus = new SessionEventBus()

        mockCreateSessionServices.returns({
          llmService: createMockLLMService(sandbox),
          sessionEventBus,
        })

        await manager.createSession(sessionId)

        // ChatSession registers its forwarders on the bus — must be > 0
        const beforeCount = countSessionListeners(sessionEventBus)
        expect(beforeCount).to.be.greaterThan(
          0,
          `Cycle ${i}: no listeners registered — ChatSession.setupEventForwarding() may have changed`,
        )

        await manager.deleteSession(sessionId)

        // After deletion, ALL listeners must be gone
        const remaining = countSessionListeners(sessionEventBus)
        expect(remaining).to.equal(
          0,
          `Cycle ${i}: expected 0 listeners after deleteSession(), got ${remaining} (was ${beforeCount}) — memory leak detected`,
        )

        expect(manager.getSessionCount()).to.equal(0, `Cycle ${i}: session still in map after deleteSession()`)
      }
      /* eslint-enable no-await-in-loop */
    })
  })

  // -------------------------------------------------------------------------
  // endSession() – same bug, different code path (used by TTL cleanup timer)
  // -------------------------------------------------------------------------

  describe('endSession() – no listener leak', () => {
    const CYCLES = 3000

    it(`should remove all event listeners per session over ${CYCLES} sequential endSession() cycles`, async () => {
      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < CYCLES; i++) {
        const sessionId = `curate-load-${i}`
        const sessionEventBus = new SessionEventBus()

        mockCreateSessionServices.returns({
          llmService: createMockLLMService(sandbox),
          sessionEventBus,
        })

        await manager.createSession(sessionId)

        const beforeCount = countSessionListeners(sessionEventBus)
        expect(beforeCount).to.be.greaterThan(0)

        await manager.endSession(sessionId)

        const remaining = countSessionListeners(sessionEventBus)
        expect(remaining).to.equal(
          0,
          `Cycle ${i}: expected 0 listeners after endSession(), got ${remaining} (was ${beforeCount}) — memory leak detected`,
        )

        expect(manager.getSessionCount()).to.equal(0)
      }
      /* eslint-enable no-await-in-loop */
    })
  })

  // -------------------------------------------------------------------------
  // Mixed – simulate real brv query/curate alternating pattern
  // -------------------------------------------------------------------------

  describe('mixed deleteSession()/endSession() – no listener accumulation', () => {
    const CYCLES = 1000

    it(`should keep total listener count at 0 across ${CYCLES} mixed query+curate cycles`, async () => {
      /** All buses we've seen — to verify none still have listeners at the end */
      const allBuses: SessionEventBus[] = []

      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < CYCLES; i++) {
        const isQuery = i % 2 === 0

        const sessionEventBus = new SessionEventBus()
        allBuses.push(sessionEventBus)

        mockCreateSessionServices.returns({
          llmService: createMockLLMService(sandbox),
          sessionEventBus,
        })

        const sessionId = `mixed-${i}`
        await manager.createSession(sessionId)

        // eslint-disable-next-line unicorn/prefer-ternary
        if (isQuery) {
          await manager.deleteSession(sessionId) // brv query path
        } else {
          await manager.endSession(sessionId) // TTL cleanup path
        }
      }
      /* eslint-enable no-await-in-loop */

      // After all cycles: every bus must have 0 listeners
      let totalRemaining = 0
      for (const bus of allBuses) {
        totalRemaining += countSessionListeners(bus)
      }

      expect(totalRemaining).to.equal(
        0,
        `Total dangling listeners after ${CYCLES} cycles: ${totalRemaining} — memory leak detected`,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Heap memory – verify non-linear growth
  // Uses plain objects (not sinon stubs) to avoid sinon's internal tracking
  // accumulating across thousands of cycles and distorting heap measurements.
  // -------------------------------------------------------------------------

  describe('heap memory – bounded growth over 3000 cycles', () => {
    it('should not grow heap proportionally to session cycle count', async () => {
      const WARMUP = 100
      const MEASURED = 3000

      // Plain mock factory — no sinon stubs, no sandbox tracking.
      // These plain objects are GC-able and won't inflate the heap artificially.
      // eslint-disable-next-line unicorn/consistent-function-scoping
      const makePlainMock = () => ({
        llmService: {
          completeTask: async () => 'response',
          getAllTools: async () => ({}),
          getConfig: () => ({
            configuredMaxInputTokens: 1000,
            maxInputTokens: 1000,
            maxOutputTokens: 1000,
            model: 'test',
            modelMaxInputTokens: 1000,
            provider: 'test',
            router: 'test',
          }),
          getContextManager: () => ({
            async clearHistory() {},
            async flush() {},
            getMessages: () => [],
          }),
        } as unknown as ILLMService,
        sessionEventBus: new SessionEventBus(),
      })

      // Create a fresh SessionManager for this test to avoid cross-test state
      const heapManager = new TestableSessionManager(mockSharedServices, mockHttpConfig, llmConfig)
      heapManager.mockCreateSessionServices = mockCreateSessionServices

      // Warmup: let the runtime settle (JIT, initial allocations)
      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < WARMUP; i++) {
        const mock = makePlainMock()
        mockCreateSessionServices.returns(mock)
        await heapManager.createSession(`warmup-${i}`)
        await heapManager.deleteSession(`warmup-${i}`)
      }
      /* eslint-enable no-await-in-loop */

      const heapBefore = heapMB()

      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < MEASURED; i++) {
        const mock = makePlainMock()
        mockCreateSessionServices.returns(mock)
        await heapManager.createSession(`heap-${i}`)
        await heapManager.deleteSession(`heap-${i}`)
      }
      /* eslint-enable no-await-in-loop */

      heapManager.dispose()

      const heapAfter = heapMB()
      const growthMB = heapAfter - heapBefore

      // With the bug: each cycle keeps 14 listener closures alive (not GC-able due to bus references).
      // Each listener closure ~1-2 KB × 14 × 3000 cycles ≈ 42-84 MB growth.
      // With the fix: objects are properly disposed, growth should be <30 MB (GC lag, JIT, etc.)
      const MAX_ALLOWED_GROWTH_MB = 30
      expect(growthMB).to.be.lessThan(
        MAX_ALLOWED_GROWTH_MB,
        `Heap grew by ${growthMB.toFixed(1)} MB over ${MEASURED} cycles — exceeds ${MAX_ALLOWED_GROWTH_MB} MB threshold. Possible memory leak.`,
      )
    })
  })
})
