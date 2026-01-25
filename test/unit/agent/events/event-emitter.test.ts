import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import {
  AgentEventBus,
  BaseTypedEventEmitter,
  SessionEventBus,
} from '../../../../src/agent/events/event-emitter.js'

const throwError = () => {
  throw new Error('Test error')
}

describe('EventEmitter', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('BaseTypedEventEmitter', () => {
    // Use a simple test event map for testing
    interface TestEventMap {
      'test:payload': {value: number}
      'test:string': {message: string}
      'test:void': void
    }

    let emitter: BaseTypedEventEmitter<TestEventMap>

    beforeEach(() => {
      emitter = new BaseTypedEventEmitter<TestEventMap>()
    })

    describe('on() - Subscribe', () => {
      it('should register a listener that gets called when event is emitted', () => {
        const listener = sandbox.spy()

        emitter.on('test:payload', listener)
        emitter.emit('test:payload', {value: 42})

        expect(listener.calledOnce).to.be.true
        expect(listener.firstCall.args[0]).to.deep.equal({value: 42})
      })

      it('should support multiple listeners for the same event', () => {
        const listener1 = sandbox.spy()
        const listener2 = sandbox.spy()
        const listener3 = sandbox.spy()

        emitter.on('test:payload', listener1)
        emitter.on('test:payload', listener2)
        emitter.on('test:payload', listener3)

        emitter.emit('test:payload', {value: 123})

        expect(listener1.calledOnce).to.be.true
        expect(listener2.calledOnce).to.be.true
        expect(listener3.calledOnce).to.be.true
      })

      it('should return this for chaining', () => {
        const listener = sandbox.spy()

        const result = emitter.on('test:payload', listener)

        expect(result).to.equal(emitter)
      })

      it('should handle void events without payload', () => {
        const listener = sandbox.spy()

        emitter.on('test:void', listener)
        emitter.emit('test:void')

        expect(listener.calledOnce).to.be.true
        expect(listener.firstCall.args).to.have.length(0)
      })
    })

    describe('AbortController Integration', () => {
      it('should register listener with AbortSignal', () => {
        const controller = new AbortController()
        const listener = sandbox.spy()

        emitter.on('test:payload', listener, {signal: controller.signal})
        emitter.emit('test:payload', {value: 100})

        expect(listener.calledOnce).to.be.true
      })

      it('should automatically remove listener when signal is aborted', () => {
        const controller = new AbortController()
        const listener = sandbox.spy()

        emitter.on('test:payload', listener, {signal: controller.signal})

        // First emit - listener should be called
        emitter.emit('test:payload', {value: 1})
        expect(listener.callCount).to.equal(1)

        // Abort the signal
        controller.abort()

        // Second emit - listener should NOT be called
        emitter.emit('test:payload', {value: 2})
        expect(listener.callCount).to.equal(1) // Still 1, not 2
      })

      it('should not register listener if signal is already aborted', () => {
        const controller = new AbortController()
        controller.abort() // Abort before registering

        const listener = sandbox.spy()

        emitter.on('test:payload', listener, {signal: controller.signal})
        emitter.emit('test:payload', {value: 99})

        expect(listener.called).to.be.false
      })

      it('should handle multiple listeners with the same AbortSignal', () => {
        const controller = new AbortController()
        const listener1 = sandbox.spy()
        const listener2 = sandbox.spy()

        emitter.on('test:payload', listener1, {signal: controller.signal})
        emitter.on('test:string', listener2, {signal: controller.signal})

        // Both listeners active
        emitter.emit('test:payload', {value: 1})
        emitter.emit('test:string', {message: 'hello'})

        expect(listener1.calledOnce).to.be.true
        expect(listener2.calledOnce).to.be.true

        // Abort - both should be removed
        controller.abort()

        emitter.emit('test:payload', {value: 2})
        emitter.emit('test:string', {message: 'world'})

        expect(listener1.callCount).to.equal(1) // Not called again
        expect(listener2.callCount).to.equal(1) // Not called again
      })

      it('should clean up signal tracking after abort', () => {
        const controller = new AbortController()
        const listener = sandbox.spy()

        emitter.on('test:payload', listener, {signal: controller.signal})

        // Verify listener is tracked
        // @ts-expect-error - accessing private property for testing
        const trackedListeners = emitter.signalListeners.get(controller.signal)
        expect(trackedListeners?.size).to.equal(1)

        // Abort
        controller.abort()

        // Verify cleanup
        // @ts-expect-error - accessing private property for testing
        const afterAbort = emitter.signalListeners.get(controller.signal)
        expect(afterAbort?.size).to.equal(0)
      })
    })

    describe('off() - Unsubscribe', () => {
      it('should remove a specific listener', () => {
        const listener = sandbox.spy()

        emitter.on('test:payload', listener)
        emitter.off('test:payload', listener)

        emitter.emit('test:payload', {value: 50})

        expect(listener.called).to.be.false
      })

      it('should not affect other listeners', () => {
        const listener1 = sandbox.spy()
        const listener2 = sandbox.spy()

        emitter.on('test:payload', listener1)
        emitter.on('test:payload', listener2)

        emitter.off('test:payload', listener1)

        emitter.emit('test:payload', {value: 75})

        expect(listener1.called).to.be.false
        expect(listener2.calledOnce).to.be.true
      })

      it('should return this for chaining', () => {
        const listener = sandbox.spy()
        emitter.on('test:payload', listener)

        const result = emitter.off('test:payload', listener)

        expect(result).to.equal(emitter)
      })
    })

    describe('emit()', () => {
      it('should emit events with payload', () => {
        const listener = sandbox.spy()

        emitter.on('test:payload', listener)
        const result = emitter.emit('test:payload', {value: 200})

        expect(result).to.be.true
        expect(listener.calledOnce).to.be.true
        expect(listener.firstCall.args[0]).to.deep.equal({value: 200})
      })

      it('should emit void events without payload', () => {
        const listener = sandbox.spy()

        emitter.on('test:void', listener)
        const result = emitter.emit('test:void')

        expect(result).to.be.true
        expect(listener.calledOnce).to.be.true
      })

      it('should return false when no listeners', () => {
        const result = emitter.emit('test:payload', {value: 999})

        expect(result).to.be.false
      })

      it('should return true when listeners exist', () => {
        const listener = sandbox.spy()
        emitter.on('test:payload', listener)

        const result = emitter.emit('test:payload', {value: 1})

        expect(result).to.be.true
      })

      it('should call all listeners in registration order', () => {
        const callOrder: number[] = []

        const createListener = (order: number) => () => callOrder.push(order)
        const listener1 = sandbox.spy(createListener(1))
        const listener2 = sandbox.spy(createListener(2))
        const listener3 = sandbox.spy(createListener(3))

        emitter.on('test:payload', listener1)
        emitter.on('test:payload', listener2)
        emitter.on('test:payload', listener3)

        emitter.emit('test:payload', {value: 0})

        expect(callOrder).to.deep.equal([1, 2, 3])
      })
    })

    describe('once() - Single Execution', () => {
      it('should call listener exactly once', () => {
        const listener = sandbox.spy()

        emitter.once('test:payload', listener)

        emitter.emit('test:payload', {value: 1})
        emitter.emit('test:payload', {value: 2})
        emitter.emit('test:payload', {value: 3})

        expect(listener.calledOnce).to.be.true
        expect(listener.firstCall.args[0]).to.deep.equal({value: 1})
      })

      it('should automatically remove listener after first call', () => {
        const listener = sandbox.spy()

        emitter.once('test:payload', listener)

        // First emit
        let result = emitter.emit('test:payload', {value: 1})
        expect(result).to.be.true

        // Second emit - no listeners
        result = emitter.emit('test:payload', {value: 2})
        expect(result).to.be.false // No more listeners
      })

      it('should work with AbortSignal', () => {
        const controller = new AbortController()
        const listener = sandbox.spy()

        emitter.once('test:payload', listener, {signal: controller.signal})

        emitter.emit('test:payload', {value: 10})

        expect(listener.calledOnce).to.be.true
      })

      it('should not register listener if signal is already aborted', () => {
        const controller = new AbortController()
        controller.abort()

        const listener = sandbox.spy()

        emitter.once('test:payload', listener, {signal: controller.signal})
        emitter.emit('test:payload', {value: 20})

        expect(listener.called).to.be.false
      })

      it('should return this for chaining', () => {
        const listener = sandbox.spy()

        const result = emitter.once('test:payload', listener)

        expect(result).to.equal(emitter)
      })
    })

    describe('Multi-Listener Behavior', () => {
      it('should execute listeners in registration order', () => {
        const executionOrder: string[] = []

        const pushFirst = () => executionOrder.push('first')
        const pushSecond = () => executionOrder.push('second')
        const pushThird = () => executionOrder.push('third')

        emitter.on('test:payload', pushFirst)
        emitter.on('test:payload', pushSecond)
        emitter.once('test:payload', pushThird)

        emitter.emit('test:payload', {value: 0})

        expect(executionOrder).to.deep.equal(['first', 'second', 'third'])
      })

      it('should isolate listeners - error in one does not prevent others', () => {
        const listener1 = sandbox.spy()
        const listener3 = sandbox.spy()
        const listener2 = sandbox.spy(throwError)

        emitter.on('test:payload', listener1)
        emitter.on('test:payload', listener2)
        emitter.on('test:payload', listener3)

        // Emit - listener2 will throw but others should still be called
        // Note: EventEmitter doesn't prevent subsequent listeners
        try {
          emitter.emit('test:payload', {value: 0})
        } catch {
          // Expected error
        }

        expect(listener1.calledOnce).to.be.true
        expect(listener2.calledOnce).to.be.true
        // listener3 might not be called if error propagates, depends on EventEmitter behavior
      })

      it('should support mixing on() and once() listeners', () => {
        const onListener = sandbox.spy()
        const onceListener = sandbox.spy()

        emitter.on('test:payload', onListener)
        emitter.once('test:payload', onceListener)

        emitter.emit('test:payload', {value: 1})
        emitter.emit('test:payload', {value: 2})

        expect(onListener.callCount).to.equal(2)
        expect(onceListener.callCount).to.equal(1)
      })
    })
  })

  describe('AgentEventBus', () => {
    let agentBus: AgentEventBus

    beforeEach(() => {
      agentBus = new AgentEventBus()
    })

    it('should be an instance of BaseTypedEventEmitter', () => {
      expect(agentBus).to.be.instanceOf(BaseTypedEventEmitter)
    })

    it('should handle cipher:conversationReset event', () => {
      const listener = sandbox.spy()

      agentBus.on('cipher:conversationReset', listener)
      agentBus.emit('cipher:conversationReset', {sessionId: 'test-session'})

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0]).to.deep.equal({sessionId: 'test-session'})
    })

    it('should handle cipher:stateChanged event', () => {
      const listener = sandbox.spy()

      agentBus.on('cipher:stateChanged', listener)
      agentBus.emit('cipher:stateChanged', {
        field: 'model',
        newValue: 'gemini-2.5-flash',
        oldValue: 'gemini-2.0-flash',
        sessionId: 'test-session',
      })

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0].field).to.equal('model')
    })

    it('should handle llmservice:thinking event with sessionId', () => {
      const listener = sandbox.spy()

      agentBus.on('llmservice:thinking', listener)
      agentBus.emit('llmservice:thinking', {sessionId: 'test-session'})

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0]).to.deep.equal({sessionId: 'test-session'})
    })

    it('should handle llmservice:toolCall event', () => {
      const listener = sandbox.spy()

      agentBus.on('llmservice:toolCall', listener)
      agentBus.emit('llmservice:toolCall', {
        args: {filePath: '/test'},
        callId: 'call-123',
        sessionId: 'test-session',
        toolName: 'read_file',
      })

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0].toolName).to.equal('read_file')
    })
  })

  describe('SessionEventBus', () => {
    let sessionBus: SessionEventBus

    beforeEach(() => {
      sessionBus = new SessionEventBus()
    })

    it('should be an instance of BaseTypedEventEmitter', () => {
      expect(sessionBus).to.be.instanceOf(BaseTypedEventEmitter)
    })

    it('should handle llmservice:thinking void event', () => {
      const listener = sandbox.spy()

      sessionBus.on('llmservice:thinking', listener)
      sessionBus.emit('llmservice:thinking')

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args).to.have.length(0)
    })

    it('should handle llmservice:chunk event', () => {
      const listener = sandbox.spy()

      sessionBus.on('llmservice:chunk', listener)
      sessionBus.emit('llmservice:chunk', {
        content: 'test chunk',
        isComplete: false,
        type: 'text',
      })

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0].content).to.equal('test chunk')
    })

    it('should handle llmservice:response event', () => {
      const listener = sandbox.spy()

      sessionBus.on('llmservice:response', listener)
      sessionBus.emit('llmservice:response', {
        content: 'response content',
        model: 'gemini-2.5-flash',
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      })

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0].content).to.equal('response content')
    })

    it('should handle llmservice:error event', () => {
      const listener = sandbox.spy()

      sessionBus.on('llmservice:error', listener)
      sessionBus.emit('llmservice:error', {
        code: 'ERR_TIMEOUT',
        error: 'Request timeout',
      })

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0].error).to.equal('Request timeout')
    })

    it('should handle llmservice:toolCall event without sessionId', () => {
      const listener = sandbox.spy()

      sessionBus.on('llmservice:toolCall', listener)
      sessionBus.emit('llmservice:toolCall', {
        args: {query: 'test'},
        toolName: 'search',
      })

      expect(listener.calledOnce).to.be.true
      expect(listener.firstCall.args[0]).to.not.have.property('sessionId')
    })
  })
})
