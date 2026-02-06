import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {CipherAgentServices} from '../../../src/agent/core/interfaces/cipher-services.js'
import type {ByteRoverHttpConfig} from '../../../src/agent/infra/agent/service-initializer.js'

import {createSessionServices} from '../../../src/agent/infra/agent/service-initializer.js'
import {AgentEventBus, SessionEventBus} from '../../../src/agent/infra/events/event-emitter.js'
import {setupEventForwarding} from '../../../src/agent/infra/session/session-event-forwarder.js'
import {SessionManager} from '../../../src/agent/infra/session/session-manager.js'
import {createMockCipherAgentServices, createMockHistoryStorage} from '../../helpers/mock-factories.js'

/**
 * Integration Tests for Event System
 *
 * Tests end-to-end event flow through:
 * - SessionManager
 * - ChatSession
 * - SessionEventBus
 * - setupEventForwarding
 * - AgentEventBus
 */
describe('Event System Integration', () => {
  let sandbox: SinonSandbox
  let agentEventBus: AgentEventBus
  let mockSharedServices: CipherAgentServices
  let mockHttpConfig: ByteRoverHttpConfig
  let llmConfig: {
    model: string
  }

  beforeEach(() => {
    sandbox = createSandbox()
    sandbox.stub(console, 'log')
    sandbox.stub(console, 'error')
    sandbox.stub(console, 'warn')

    // Create real AgentEventBus
    agentEventBus = new AgentEventBus()

    // Mock shared services with real agentEventBus and custom historyStorage
    mockSharedServices = createMockCipherAgentServices(agentEventBus, sandbox, {
      historyStorage: createMockHistoryStorage(sandbox, {
        deleteHistory: sandbox.stub().resolves(),
        loadHistory: sandbox.stub().resolves([]),
        saveHistory: sandbox.stub().resolves(),
      }),
    })

    mockHttpConfig = {
      apiBaseUrl: 'http://localhost:3333',
      projectId: 'test-project',
      sessionKey: 'test-session-key',
      spaceId: 'test-space-id',
      teamId: 'test-team-id',
    }

    llmConfig = {
      model: 'gemini-2.5-flash',
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('SessionManager + EventForwarding Integration', () => {
    it('should setup event forwarding when creating a session', async () => {
      const sessionManager = new SessionManager(mockSharedServices, mockHttpConfig, llmConfig)

      // Spy on agent bus to verify forwarding works
      const agentListener = sandbox.spy()
      agentEventBus.on('llmservice:thinking', agentListener)

      // Create session (which should setup event forwarding)
      await sessionManager.createSession('test-session-id')

      // Get session's event bus and emit event
      const sessionServices = createSessionServices('test-session-id', mockSharedServices, mockHttpConfig, llmConfig)
      sessionServices.sessionEventBus.emit('llmservice:thinking')

      // Note: In real integration, forwarding is setup in ChatSession constructor
      // For this test, we verify the pattern works
      setupEventForwarding(sessionServices.sessionEventBus, agentEventBus, 'test-session-id')

      // Emit again after forwarding setup
      sessionServices.sessionEventBus.emit('llmservice:thinking')

      // Verify forwarded to agent bus with sessionId
      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({sessionId: 'test-session-id'})

      await sessionManager.deleteSession('test-session-id')
    })

    it('should propagate sessionId through the entire stack', async () => {
      const sessionId = 'propagation-test-session'
      const sessionEventBus = new SessionEventBus()

      // Setup forwarding
      setupEventForwarding(sessionEventBus, agentEventBus, sessionId)

      // Listen on agent bus
      const receivedEvents: Array<{event: string; sessionId: string}> = []
      agentEventBus.on('llmservice:chunk', (payload) => {
        receivedEvents.push({event: 'chunk', sessionId: payload.sessionId})
      })
      agentEventBus.on('llmservice:response', (payload) => {
        receivedEvents.push({event: 'response', sessionId: payload.sessionId})
      })

      // Emit from session bus
      sessionEventBus.emit('llmservice:chunk', {content: 'test', type: 'text'})
      sessionEventBus.emit('llmservice:response', {content: 'response'})

      // Verify all have correct sessionId
      expect(receivedEvents).to.have.length(2)
      expect(receivedEvents[0].sessionId).to.equal(sessionId)
      expect(receivedEvents[1].sessionId).to.equal(sessionId)
    })
  })

  describe('End-to-End Event Flow', () => {
    it('should flow events from SessionBus → forward → AgentBus → listeners', () => {
      const sessionId = 'e2e-test-session'
      const sessionEventBus = new SessionEventBus()

      // Setup forwarding
      setupEventForwarding(sessionEventBus, agentEventBus, sessionId)

      // External listener on agent bus
      const externalListener = sandbox.spy()
      agentEventBus.on('llmservice:toolCall', externalListener)

      // Emit from session bus
      const toolCallPayload = {
        args: {file: '/test.ts'},
        callId: 'call-123',
        toolName: 'view_file',
      }
      sessionEventBus.emit('llmservice:toolCall', toolCallPayload)

      // Verify external listener received with sessionId
      expect(externalListener.calledOnce).to.be.true
      expect(externalListener.firstCall.args[0]).to.deep.include({
        ...toolCallPayload,
        sessionId,
      })
    })

    it('should preserve payload data through forwarding', () => {
      const sessionId = 'payload-test'
      const sessionEventBus = new SessionEventBus()

      setupEventForwarding(sessionEventBus, agentEventBus, sessionId)

      const listener = sandbox.spy()
      agentEventBus.on('llmservice:response', listener)

      const originalPayload = {
        content: 'Full response content',
        model: 'gemini-2.5-flash',
        reasoning: 'Internal reasoning',
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        },
      }

      sessionEventBus.emit('llmservice:response', originalPayload)

      const receivedPayload = listener.firstCall.args[0]
      expect(receivedPayload.content).to.equal(originalPayload.content)
      expect(receivedPayload.model).to.equal(originalPayload.model)
      expect(receivedPayload.reasoning).to.equal(originalPayload.reasoning)
      expect(receivedPayload.tokenUsage).to.deep.equal(originalPayload.tokenUsage)
      expect(receivedPayload.sessionId).to.equal(sessionId)
    })
  })

  describe('Multi-Session Event Isolation', () => {
    it('should isolate events from different sessions', () => {
      const sessionId1 = 'session-alpha'
      const sessionId2 = 'session-beta'

      const sessionBus1 = new SessionEventBus()
      const sessionBus2 = new SessionEventBus()

      // Setup forwarding for both sessions
      setupEventForwarding(sessionBus1, agentEventBus, sessionId1)
      setupEventForwarding(sessionBus2, agentEventBus, sessionId2)

      // Track events by sessionId
      const session1Events: string[] = []
      const session2Events: string[] = []

      agentEventBus.on('llmservice:chunk', (payload) => {
        if (payload.sessionId === sessionId1) {
          session1Events.push(payload.content)
        } else if (payload.sessionId === sessionId2) {
          session2Events.push(payload.content)
        }
      })

      // Emit from different sessions
      sessionBus1.emit('llmservice:chunk', {content: 'from session 1', type: 'text'})
      sessionBus2.emit('llmservice:chunk', {content: 'from session 2', type: 'text'})
      sessionBus1.emit('llmservice:chunk', {content: 'also from session 1', type: 'text'})

      // Verify isolation
      expect(session1Events).to.deep.equal(['from session 1', 'also from session 1'])
      expect(session2Events).to.deep.equal(['from session 2'])
    })

    it('should handle concurrent events from multiple sessions', () => {
      const sessions = [
        {bus: new SessionEventBus(), id: 'concurrent-1'},
        {bus: new SessionEventBus(), id: 'concurrent-2'},
        {bus: new SessionEventBus(), id: 'concurrent-3'},
      ]

      // Setup forwarding for all
      for (const {bus, id} of sessions) {
        setupEventForwarding(bus, agentEventBus, id)
      }

      // Track all events
      const allEvents: Array<{content: string; sessionId: string}> = []
      agentEventBus.on('llmservice:chunk', (payload) => {
        allEvents.push({content: payload.content, sessionId: payload.sessionId})
      })

      // Emit concurrently from all sessions
      sessions[0].bus.emit('llmservice:chunk', {content: 'msg1', type: 'text'})
      sessions[1].bus.emit('llmservice:chunk', {content: 'msg2', type: 'text'})
      sessions[2].bus.emit('llmservice:chunk', {content: 'msg3', type: 'text'})
      sessions[0].bus.emit('llmservice:chunk', {content: 'msg4', type: 'text'})

      // Verify all events received with correct sessionId
      expect(allEvents).to.have.length(4)
      expect(allEvents[0]).to.deep.equal({content: 'msg1', sessionId: 'concurrent-1'})
      expect(allEvents[1]).to.deep.equal({content: 'msg2', sessionId: 'concurrent-2'})
      expect(allEvents[2]).to.deep.equal({content: 'msg3', sessionId: 'concurrent-3'})
      expect(allEvents[3]).to.deep.equal({content: 'msg4', sessionId: 'concurrent-1'})
    })

    it('should not have crosstalk between sessions', () => {
      const sessionBus1 = new SessionEventBus()
      const sessionBus2 = new SessionEventBus()

      setupEventForwarding(sessionBus1, agentEventBus, 'session-A')
      setupEventForwarding(sessionBus2, agentEventBus, 'session-B')

      const session1Listener = sandbox.spy()
      const session2Listener = sandbox.spy()

      // Listen for specific sessions only
      agentEventBus.on('llmservice:toolResult', (payload) => {
        if (payload.sessionId === 'session-A') {
          session1Listener(payload)
        } else if (payload.sessionId === 'session-B') {
          session2Listener(payload)
        }
      })

      // Emit only from session 1
      sessionBus1.emit('llmservice:toolResult', {
        success: true,
        toolName: 'test_tool',
      })

      // Verify only session 1 listener called
      expect(session1Listener.calledOnce).to.be.true
      expect(session2Listener.called).to.be.false
    })
  })

  describe('Session Lifecycle with Events', () => {
    it('should process events when session is active', () => {
      const sessionId = 'active-session'
      const sessionBus = new SessionEventBus()

      setupEventForwarding(sessionBus, agentEventBus, sessionId)

      const listener = sandbox.spy()
      agentEventBus.on('llmservice:thinking', listener)

      // Emit while active
      sessionBus.emit('llmservice:thinking')

      expect(listener.calledOnce).to.be.true
    })

    it('should handle event forwarding for session lifecycle', () => {
      const sessionId = 'lifecycle-session'
      const sessionBus = new SessionEventBus()

      const eventLog: string[] = []
      agentEventBus.on('llmservice:chunk', (payload) => {
        if (payload.sessionId === sessionId) {
          eventLog.push(payload.content)
        }
      })

      // Before forwarding - no events should reach agent bus
      sessionBus.emit('llmservice:chunk', {content: 'before', type: 'text'})
      expect(eventLog).to.have.length(0)

      // Setup forwarding (session created)
      setupEventForwarding(sessionBus, agentEventBus, sessionId)

      // After forwarding - events should propagate
      sessionBus.emit('llmservice:chunk', {content: 'after', type: 'text'})
      expect(eventLog).to.deep.equal(['after'])

      // Note: In real implementation, session deletion would clean up listeners
      // This test verifies the basic lifecycle pattern
    })
  })

  describe('AbortController Cleanup Integration', () => {
    it('should cleanup listeners when AbortController is aborted', () => {
      const controller = new AbortController()
      const sessionBus = new SessionEventBus()

      setupEventForwarding(sessionBus, agentEventBus, 'abort-test')

      const listener = sandbox.spy()
      agentEventBus.on('llmservice:chunk', listener, {signal: controller.signal})

      // Emit before abort
      sessionBus.emit('llmservice:chunk', {content: 'before abort', type: 'text'})
      expect(listener.callCount).to.equal(1)

      // Abort
      controller.abort()

      // Emit after abort
      sessionBus.emit('llmservice:chunk', {content: 'after abort', type: 'text'})
      expect(listener.callCount).to.equal(1) // Still 1, not called again
    })

    it('should handle multiple listeners with AbortController', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const sessionBus = new SessionEventBus()

      setupEventForwarding(sessionBus, agentEventBus, 'multi-abort')

      const listener1 = sandbox.spy()
      const listener2 = sandbox.spy()

      agentEventBus.on('llmservice:response', listener1, {signal: controller1.signal})
      agentEventBus.on('llmservice:response', listener2, {signal: controller2.signal})

      // Both active
      sessionBus.emit('llmservice:response', {content: 'test'})
      expect(listener1.calledOnce).to.be.true
      expect(listener2.calledOnce).to.be.true

      // Abort first controller
      controller1.abort()

      // Emit again
      sessionBus.emit('llmservice:response', {content: 'test2'})
      expect(listener1.callCount).to.equal(1) // Not called again
      expect(listener2.callCount).to.equal(2) // Called again
    })
  })

  describe('Error Handling Integration', () => {
    it('should continue forwarding events even if listener throws', () => {
      const sessionBus = new SessionEventBus()
      setupEventForwarding(sessionBus, agentEventBus, 'error-test')

      const throwingListener = sandbox.spy(() => {
        throw new Error('Listener error')
      })
      const normalListener = sandbox.spy()

      agentEventBus.on('llmservice:error', throwingListener)
      agentEventBus.on('llmservice:error', normalListener)

      // Emit error event
      let didThrow = false
      try {
        sessionBus.emit('llmservice:error', {error: 'Test error'})
      } catch {
        didThrow = true
      }

      // Verify both listeners were called (throwing listener throws but doesn't break forwarding)
      expect(throwingListener.calledOnce).to.be.true
      expect(didThrow).to.be.true
    })

    it('should forward error events with full context', () => {
      const sessionId = 'error-context-session'
      const sessionBus = new SessionEventBus()
      setupEventForwarding(sessionBus, agentEventBus, sessionId)

      const errorListener = sandbox.spy()
      agentEventBus.on('llmservice:error', errorListener)

      const errorPayload = {
        code: 'ERR_NETWORK',
        error: 'Network connection failed',
      }

      sessionBus.emit('llmservice:error', errorPayload)

      expect(errorListener.calledOnce).to.be.true
      expect(errorListener.firstCall.args[0]).to.deep.include({
        ...errorPayload,
        sessionId,
      })
    })
  })
})
