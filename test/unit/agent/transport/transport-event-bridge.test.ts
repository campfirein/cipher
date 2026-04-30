import type {ITransportClient} from '@campfirein/brv-transport-client'

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub, stub} from 'sinon'

import {AgentEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {TransportEventBridge} from '../../../../src/agent/infra/transport/transport-event-bridge.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockTransport(): ITransportClient & {request: SinonStub} {
  return {
    connect: stub().resolves(),
    disconnect: stub().resolves(),
    getClientId: stub().returns('mock-client-id'),
    getDaemonVersion: stub(),
    getState: stub().returns('connected'),
    isConnected: stub().resolves(true),
    joinRoom: stub().resolves(),
    leaveRoom: stub().resolves(),
    on: stub().returns(() => {}),
    once: stub(),
    onStateChange: stub().returns(() => {}),
    request: stub(),
    requestWithAck: stub().resolves({}),
  }
}

function createBridge(): {
  bridge: TransportEventBridge
  eventBus: AgentEventBus
  transport: ReturnType<typeof createMockTransport>
} {
  const eventBus = new AgentEventBus()
  const transport = createMockTransport()
  const bridge = new TransportEventBridge({eventBus, transport})
  return {bridge, eventBus, transport}
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportEventBridge', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
    sandbox.stub(console, 'log')
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('setupForTask', () => {
    it('forwards llmservice:toolCall events matching taskId to transport', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:toolCall', {
        args: {filePath: '/test'},
        callId: 'call-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        toolName: 'read_file',
      })

      expect(transport.request.calledOnce).to.be.true
      expect(transport.request.firstCall.args[0]).to.equal('llmservice:toolCall')
      expect(transport.request.firstCall.args[1]).to.deep.include({
        taskId: 'task-1',
        toolName: 'read_file',
      })
    })

    it('does not forward events with non-matching taskId', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:toolCall', {
        args: {},
        sessionId: 'session-1',
        taskId: 'task-OTHER',
        toolName: 'read_file',
      })

      expect(transport.request.called).to.be.false
    })

    it('does not forward events without taskId', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:thinking', {
        sessionId: 'session-1',
      })

      expect(transport.request.called).to.be.false
    })

    it('forwards llmservice:response events', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:response', {
        content: 'Hello world',
        sessionId: 'session-1',
        taskId: 'task-1',
      })

      expect(transport.request.calledOnce).to.be.true
      expect(transport.request.firstCall.args[0]).to.equal('llmservice:response')
    })

    it('forwards llmservice:error events', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:error', {
        error: 'Something failed',
        sessionId: 'session-1',
        taskId: 'task-1',
      })

      expect(transport.request.calledOnce).to.be.true
      expect(transport.request.firstCall.args[0]).to.equal('llmservice:error')
    })

    it('forwards llmservice:chunk events', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:chunk', {
        content: 'partial content',
        sessionId: 'session-1',
        taskId: 'task-1',
        type: 'text',
      })

      expect(transport.request.calledOnce).to.be.true
      expect(transport.request.firstCall.args[0]).to.equal('llmservice:chunk')
    })

    it('forwards llmservice:toolResult events', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:toolResult', {
        callId: 'call-1',
        result: 'file contents',
        sessionId: 'session-1',
        success: true,
        taskId: 'task-1',
        toolName: 'read_file',
      })

      expect(transport.request.calledOnce).to.be.true
      expect(transport.request.firstCall.args[0]).to.equal('llmservice:toolResult')
    })

    it('forwards llmservice:unsupportedInput events', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('llmservice:unsupportedInput', {
        reason: 'Image not supported',
        sessionId: 'session-1',
        taskId: 'task-1',
      })

      expect(transport.request.calledOnce).to.be.true
      expect(transport.request.firstCall.args[0]).to.equal('llmservice:unsupportedInput')
    })

    it('does not forward non-LLM events (e.g. cipher:stateChanged)', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')

      eventBus.emit('cipher:stateChanged', {
        field: 'model',
        newValue: 'gemini-3',
        sessionId: 'session-1',
      })

      expect(transport.request.called).to.be.false
    })

    it('supports multiple concurrent tasks with independent forwarding', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-A')
      bridge.setupForTask('task-B')

      eventBus.emit('llmservice:response', {
        content: 'Response for A',
        sessionId: 'session-1',
        taskId: 'task-A',
      })

      eventBus.emit('llmservice:response', {
        content: 'Response for B',
        sessionId: 'session-2',
        taskId: 'task-B',
      })

      expect(transport.request.callCount).to.equal(2)
      expect(transport.request.firstCall.args[1]).to.deep.include({taskId: 'task-A'})
      expect(transport.request.secondCall.args[1]).to.deep.include({taskId: 'task-B'})
    })

    it('returns cleanup function that removes listeners', () => {
      const {bridge, eventBus, transport} = createBridge()
      const cleanup = bridge.setupForTask('task-1')

      // Before cleanup - events forwarded
      eventBus.emit('llmservice:response', {
        content: 'Before',
        sessionId: 'session-1',
        taskId: 'task-1',
      })
      expect(transport.request.calledOnce).to.be.true

      // Cleanup
      cleanup()

      // After cleanup - events not forwarded
      eventBus.emit('llmservice:response', {
        content: 'After',
        sessionId: 'session-1',
        taskId: 'task-1',
      })
      expect(transport.request.calledOnce).to.be.true // still 1, not 2
    })

    it('cleanup is idempotent (safe to call multiple times)', () => {
      const {bridge, eventBus, transport} = createBridge()
      const cleanup = bridge.setupForTask('task-1')

      cleanup()
      cleanup() // second call is safe

      eventBus.emit('llmservice:response', {
        content: 'test',
        sessionId: 'session-1',
        taskId: 'task-1',
      })

      expect(transport.request.called).to.be.false
    })
  })

  describe('dispose', () => {
    it('removes all active task listeners', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')
      bridge.setupForTask('task-2')

      bridge.dispose()

      eventBus.emit('llmservice:response', {
        content: 'test',
        sessionId: 'session-1',
        taskId: 'task-1',
      })
      eventBus.emit('llmservice:response', {
        content: 'test',
        sessionId: 'session-2',
        taskId: 'task-2',
      })

      expect(transport.request.called).to.be.false
    })

    it('is idempotent (safe to call multiple times)', () => {
      const {bridge} = createBridge()
      bridge.setupForTask('task-1')

      bridge.dispose()
      bridge.dispose() // second call is safe
    })

    it('allows new tasks to be set up after dispose', () => {
      const {bridge, eventBus, transport} = createBridge()
      bridge.setupForTask('task-1')
      bridge.dispose()

      // Set up a new task after dispose
      bridge.setupForTask('task-2')

      eventBus.emit('llmservice:response', {
        content: 'test',
        sessionId: 'session-1',
        taskId: 'task-2',
      })

      expect(transport.request.calledOnce).to.be.true
    })
  })
})
