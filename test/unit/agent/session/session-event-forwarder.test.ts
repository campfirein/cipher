import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import {AgentEventBus, SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {setupEventForwarding} from '../../../../src/agent/infra/session/session-event-forwarder.js'

describe('SessionEventForwarder', () => {
  let sandbox: SinonSandbox
  let sessionBus: SessionEventBus
  let agentBus: AgentEventBus
  const testSessionId = 'test-session-123'

  beforeEach(() => {
    sandbox = createSandbox()
    sessionBus = new SessionEventBus()
    agentBus = new AgentEventBus()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('setupEventForwarding()', () => {
    it('should setup forwarding without errors', () => {
      expect(() => {
        setupEventForwarding(sessionBus, agentBus, testSessionId)
      }).to.not.throw()
    })

    it('should register listeners on sessionBus for all 8 event types', () => {
      const listenerCountBefore = sessionBus.listenerCount('llmservice:thinking')

      setupEventForwarding(sessionBus, agentBus, testSessionId)

      // Verify listeners registered for each event type
      expect(sessionBus.listenerCount('llmservice:thinking')).to.be.greaterThan(listenerCountBefore)
      expect(sessionBus.listenerCount('llmservice:chunk')).to.be.greaterThan(0)
      expect(sessionBus.listenerCount('llmservice:compressionQuality')).to.be.greaterThan(0)
      expect(sessionBus.listenerCount('llmservice:response')).to.be.greaterThan(0)
      expect(sessionBus.listenerCount('llmservice:toolCall')).to.be.greaterThan(0)
      expect(sessionBus.listenerCount('llmservice:toolResult')).to.be.greaterThan(0)
      expect(sessionBus.listenerCount('llmservice:error')).to.be.greaterThan(0)
      expect(sessionBus.listenerCount('llmservice:unsupportedInput')).to.be.greaterThan(0)
    })
  })

  describe('Void Event Forwarding', () => {
    it('should forward llmservice:thinking (void) with sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:thinking', agentListener)

      // Emit void event on session bus
      sessionBus.emit('llmservice:thinking')

      // Verify forwarded to agent bus with sessionId
      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({sessionId: testSessionId})
    })
  })

  describe('Payload Event Forwarding', () => {
    it('should forward llmservice:chunk with payload and sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:chunk', agentListener)

      const chunkPayload = {
        content: 'test chunk content',
        isComplete: false,
        type: 'text' as const,
      }

      sessionBus.emit('llmservice:chunk', chunkPayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({
        ...chunkPayload,
        sessionId: testSessionId,
      })
    })

    it('should forward llmservice:response with payload and sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:response', agentListener)

      const responsePayload = {
        content: 'response content',
        model: 'gemini-2.5-flash',
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      }

      sessionBus.emit('llmservice:response', responsePayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({
        ...responsePayload,
        sessionId: testSessionId,
      })
    })

    it('should forward llmservice:toolCall with payload and sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:toolCall', agentListener)

      const toolCallPayload = {
        args: {filePath: '/test/file.ts'},
        callId: 'call-456',
        toolName: 'read_file',
      }

      sessionBus.emit('llmservice:toolCall', toolCallPayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({
        ...toolCallPayload,
        sessionId: testSessionId,
      })
    })

    it('should forward llmservice:toolResult with payload and sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:toolResult', agentListener)

      const toolResultPayload = {
        callId: 'call-789',
        result: {data: 'file contents'},
        success: true,
        toolName: 'read_file',
      }

      sessionBus.emit('llmservice:toolResult', toolResultPayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({
        ...toolResultPayload,
        sessionId: testSessionId,
      })
    })

    it('should forward llmservice:error with payload and sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:error', agentListener)

      const errorPayload = {
        code: 'ERR_TIMEOUT',
        error: 'Request timeout',
      }

      sessionBus.emit('llmservice:error', errorPayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({
        ...errorPayload,
        sessionId: testSessionId,
      })
    })

    it('should forward llmservice:unsupportedInput with payload and sessionId', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:unsupportedInput', agentListener)

      const unsupportedInputPayload = {
        reason: 'Unsupported file type',
      }

      sessionBus.emit('llmservice:unsupportedInput', unsupportedInputPayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0]).to.deep.equal({
        ...unsupportedInputPayload,
        sessionId: testSessionId,
      })
    })
  })

  describe('SessionId Injection', () => {
    it('should add sessionId to all forwarded events', () => {
      const listeners = {
        chunk: sandbox.spy(),
        error: sandbox.spy(),
        response: sandbox.spy(),
        thinking: sandbox.spy(),
        toolCall: sandbox.spy(),
        toolResult: sandbox.spy(),
        unsupportedInput: sandbox.spy(),
      }

      setupEventForwarding(sessionBus, agentBus, testSessionId)

      agentBus.on('llmservice:thinking', listeners.thinking)
      agentBus.on('llmservice:chunk', listeners.chunk)
      agentBus.on('llmservice:response', listeners.response)
      agentBus.on('llmservice:toolCall', listeners.toolCall)
      agentBus.on('llmservice:toolResult', listeners.toolResult)
      agentBus.on('llmservice:error', listeners.error)
      agentBus.on('llmservice:unsupportedInput', listeners.unsupportedInput)

      // Emit all events
      sessionBus.emit('llmservice:thinking')
      sessionBus.emit('llmservice:chunk', {content: 'c', type: 'text'})
      sessionBus.emit('llmservice:response', {content: 'r'})
      sessionBus.emit('llmservice:toolCall', {args: {}, toolName: 't'})
      sessionBus.emit('llmservice:toolResult', {success: true, toolName: 't'})
      sessionBus.emit('llmservice:error', {error: 'e'})
      sessionBus.emit('llmservice:unsupportedInput', {reason: 'u'})

      // Verify all have sessionId
      expect(listeners.thinking.firstCall.args[0].sessionId).to.equal(testSessionId)
      expect(listeners.chunk.firstCall.args[0].sessionId).to.equal(testSessionId)
      expect(listeners.response.firstCall.args[0].sessionId).to.equal(testSessionId)
      expect(listeners.toolCall.firstCall.args[0].sessionId).to.equal(testSessionId)
      expect(listeners.toolResult.firstCall.args[0].sessionId).to.equal(testSessionId)
      expect(listeners.error.firstCall.args[0].sessionId).to.equal(testSessionId)
      expect(listeners.unsupportedInput.firstCall.args[0].sessionId).to.equal(testSessionId)
    })

    it('should preserve original payload properties', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:chunk', agentListener)

      const originalPayload = {
        content: 'original content',
        isComplete: true,
        type: 'reasoning' as const,
      }

      sessionBus.emit('llmservice:chunk', originalPayload)

      const forwardedPayload = agentListener.firstCall.args[0]
      expect(forwardedPayload.content).to.equal(originalPayload.content)
      expect(forwardedPayload.isComplete).to.equal(originalPayload.isComplete)
      expect(forwardedPayload.type).to.equal(originalPayload.type)
      expect(forwardedPayload.sessionId).to.equal(testSessionId)
    })
  })

  describe('Error Handling', () => {
    it('should forward error events correctly', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:error', agentListener)

      const errorPayload = {
        code: 'ERR_NETWORK',
        error: 'Network failure',
      }

      sessionBus.emit('llmservice:error', errorPayload)

      expect(agentListener.calledOnce).to.be.true
      expect(agentListener.firstCall.args[0].error).to.equal('Network failure')
      expect(agentListener.firstCall.args[0].code).to.equal('ERR_NETWORK')
    })

    it('should forward events even if agent listener throws', () => {
      setupEventForwarding(sessionBus, agentBus, testSessionId)

      const throwingListener = sandbox.spy(() => {
        throw new Error('Listener error')
      })

      // Add throwing listener to agent bus
      agentBus.on('llmservice:chunk', throwingListener)

      // Emit event - should forward despite potential listener errors
      // The forwarding itself should work, even if listeners fail
      let didThrow = false
      try {
        sessionBus.emit('llmservice:chunk', {content: 'test', type: 'text'})
      } catch {
        didThrow = true
      }

      // Verify the throwing listener was called (forwarding worked)
      expect(throwingListener.calledOnce).to.be.true
      // Verify error was thrown
      expect(didThrow).to.be.true
    })
  })

  describe('Concurrent Events', () => {
    it('should handle multiple events emitted rapidly', () => {
      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus, agentBus, testSessionId)
      agentBus.on('llmservice:chunk', agentListener)

      // Emit multiple events rapidly
      sessionBus.emit('llmservice:chunk', {content: 'chunk1', type: 'text'})
      sessionBus.emit('llmservice:chunk', {content: 'chunk2', type: 'text'})
      sessionBus.emit('llmservice:chunk', {content: 'chunk3', type: 'text'})

      // All should be forwarded
      expect(agentListener.callCount).to.equal(3)
      expect(agentListener.firstCall.args[0].content).to.equal('chunk1')
      expect(agentListener.secondCall.args[0].content).to.equal('chunk2')
      expect(agentListener.thirdCall.args[0].content).to.equal('chunk3')
    })

    it('should forward events in correct order', () => {
      const receivedEvents: string[] = []

      setupEventForwarding(sessionBus, agentBus, testSessionId)

      agentBus.on('llmservice:thinking', () => receivedEvents.push('thinking'))
      agentBus.on('llmservice:chunk', () => receivedEvents.push('chunk'))
      agentBus.on('llmservice:response', () => receivedEvents.push('response'))

      // Emit in specific order
      sessionBus.emit('llmservice:thinking')
      sessionBus.emit('llmservice:chunk', {content: 'c', type: 'text'})
      sessionBus.emit('llmservice:response', {content: 'r'})

      expect(receivedEvents).to.deep.equal(['thinking', 'chunk', 'response'])
    })
  })

  describe('Multiple Sessions', () => {
    it('should allow multiple sessions forwarding to same agent bus with different sessionIds', () => {
      const sessionBus1 = new SessionEventBus()
      const sessionBus2 = new SessionEventBus()
      const sessionId1 = 'session-1'
      const sessionId2 = 'session-2'

      const agentListener = sandbox.spy()

      setupEventForwarding(sessionBus1, agentBus, sessionId1)
      setupEventForwarding(sessionBus2, agentBus, sessionId2)

      agentBus.on('llmservice:chunk', agentListener)

      // Emit from both sessions
      sessionBus1.emit('llmservice:chunk', {content: 'from session 1', type: 'text'})
      sessionBus2.emit('llmservice:chunk', {content: 'from session 2', type: 'text'})

      expect(agentListener.callCount).to.equal(2)
      expect(agentListener.firstCall.args[0].sessionId).to.equal(sessionId1)
      expect(agentListener.secondCall.args[0].sessionId).to.equal(sessionId2)
    })

    it('should not have crosstalk between sessions', () => {
      const sessionBus1 = new SessionEventBus()
      const sessionBus2 = new SessionEventBus()
      const sessionId1 = 'session-alpha'
      const sessionId2 = 'session-beta'

      const session1Listener = sandbox.spy()
      const session2Listener = sandbox.spy()

      setupEventForwarding(sessionBus1, agentBus, sessionId1)
      setupEventForwarding(sessionBus2, agentBus, sessionId2)

      // Listen for events from specific sessions
      agentBus.on('llmservice:toolCall', (payload) => {
        if (payload.sessionId === sessionId1) {
          session1Listener(payload)
        } else if (payload.sessionId === sessionId2) {
          session2Listener(payload)
        }
      })

      // Emit from session 1
      sessionBus1.emit('llmservice:toolCall', {args: {}, toolName: 'tool1'})

      // Only session1Listener should be called
      expect(session1Listener.calledOnce).to.be.true
      expect(session2Listener.called).to.be.false

      // Emit from session 2
      sessionBus2.emit('llmservice:toolCall', {args: {}, toolName: 'tool2'})

      // Now session2Listener should be called
      expect(session1Listener.callCount).to.equal(1) // Still 1
      expect(session2Listener.calledOnce).to.be.true
    })
  })
})
