import {expect} from 'chai'
import {createSandbox, SinonSandbox, SinonStub} from 'sinon'

import type {CipherAgentServices, SessionServices} from '../../../../../src/core/interfaces/cipher/cipher-services.js'
import type {ILLMService} from '../../../../../src/core/interfaces/cipher/i-llm-service.js'
import type {InternalMessage} from '../../../../../src/core/interfaces/cipher/message-types.js'

import {LLMError, SessionCancelledError} from '../../../../../src/core/domain/cipher/errors/session-error.js'
import {AgentEventBus, SessionEventBus} from '../../../../../src/infra/cipher/events/event-emitter.js'
import {ContextManager} from '../../../../../src/infra/cipher/llm/context/context-manager.js'
import {ChatSession} from '../../../../../src/infra/cipher/session/chat-session.js'
import {
  createMockCipherAgentServices,
  createMockContextManager,
  createMockLLMService,
} from '../../../../helpers/mock-factories.js'

describe('ChatSession', () => {
  let sandbox: SinonSandbox
  let mockLLMService: ILLMService
  let mockContextManager: ContextManager<unknown>
  let mockSharedServices: CipherAgentServices
  let mockSessionServices: SessionServices
  let sessionEventBus: SessionEventBus
  let agentEventBus: AgentEventBus
  let session: ChatSession
  let sessionId: string

  beforeEach(() => {
    sandbox = createSandbox()
    sessionId = 'test-session-id'

    // Create real event buses for testing
    sessionEventBus = new SessionEventBus()
    agentEventBus = new AgentEventBus()

    // Use factory functions instead of `as unknown as Type`
    mockContextManager = createMockContextManager(sandbox)

    // Use factory with override for custom behavior
    mockLLMService = createMockLLMService(sandbox, {
      getContextManager: sandbox.stub().returns(mockContextManager),
    })

    // Use factory for full service mocking
    mockSharedServices = createMockCipherAgentServices(agentEventBus, sandbox)

    // Mock session services
    mockSessionServices = {
      llmService: mockLLMService,
      sessionEventBus,
    }

    session = new ChatSession(sessionId, mockSharedServices, mockSessionServices)
  })

  afterEach(() => {
    sandbox.restore()
    session.dispose()
  })

  describe('constructor', () => {
    it('should setup event forwarding for all SESSION_EVENT_NAMES', () => {
      // These are the events that ChatSession actually forwards (defined in chat-session.ts)
      const eventNames = [
        'llmservice:thinking',
        'llmservice:chunk',
        'llmservice:response',
        'llmservice:toolCall',
        'llmservice:toolResult',
        'llmservice:error',
        'llmservice:unsupportedInput',
        'message:queued',
        'message:dequeued',
      ]

      const agentEmitStub = sandbox.stub(agentEventBus, 'emit')

      // Emit each event on session bus
      for (const eventName of eventNames) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessionEventBus.emit(eventName as any, {test: 'data'})
      }

      // Verify all events were forwarded to agent bus with sessionId
      expect(agentEmitStub.callCount).to.equal(eventNames.length)
      for (const [index, eventName] of eventNames.entries()) {
        const call = agentEmitStub.getCall(index)
        expect(call.args[0]).to.equal(eventName)
        expect(call.args[1]).to.deep.include({sessionId})
      }
    })
  })

  describe('getHistory()', () => {
    it('should return empty array when no messages', () => {
      const history = session.getHistory()

      expect(history).to.be.an('array').that.is.empty
      expect((mockLLMService.getContextManager as SinonStub).calledOnce).to.be.true
      expect((mockContextManager.getMessages as SinonStub).calledOnce).to.be.true
    })

    it('should convert internal messages to session Message format', () => {
      const internalMessages: InternalMessage[] = [
        {
          content: 'Hello',
          role: 'user',
        },
        {
          content: 'Hi there!',
          role: 'assistant',
          toolCalls: [
            {
              function: {
                arguments: '{"key":"value"}',
                name: 'testTool',
              },
              id: 'call-123',
              type: 'function',
            },
          ],
        },
        {
          content: 'result',
          name: 'testTool',
          role: 'tool',
          toolCallId: 'call-123',
        },
      ]

      ;(mockContextManager.getMessages as SinonStub).returns(internalMessages)

      const history = session.getHistory()

      expect(history).to.have.length(3)
      expect(history[0]).to.deep.include({
        content: 'Hello',
        role: 'user',
      })
      expect(history[0]).to.have.property('timestamp')

      expect(history[1]).to.deep.include({
        content: 'Hi there!',
        role: 'assistant',
      })
      expect(history[1].toolCalls).to.deep.equal([
        {
          arguments: {key: 'value'},
          id: 'call-123',
          name: 'testTool',
        },
      ])

      expect(history[2]).to.deep.include({
        content: 'result',
        role: 'tool',
        toolCallId: 'call-123',
        toolName: 'testTool',
      })
    })

    it('should handle non-string content by converting to empty string', () => {
      const internalMessages: InternalMessage[] = [
        {
          content: null,
          role: 'assistant',
        },
      ]

      ;(mockContextManager.getMessages as SinonStub).returns(internalMessages)

      const history = session.getHistory()

      expect(history[0].content).to.equal('')
    })
  })

  describe('getMessageCount()', () => {
    it('should return 0 when no messages', () => {
      const count = session.getMessageCount()

      expect(count).to.equal(0)
      expect((mockLLMService.getContextManager as SinonStub).calledOnce).to.be.true
      expect((mockContextManager.getMessages as SinonStub).calledOnce).to.be.true
    })

    it('should return correct message count', () => {
      const internalMessages: InternalMessage[] = [
        {content: 'msg1', role: 'user'},
        {content: 'msg2', role: 'assistant'},
      ]

      ;(mockContextManager.getMessages as SinonStub).returns(internalMessages)

      const count = session.getMessageCount()

      expect(count).to.equal(2)
    })

    it('should match getHistory().length', () => {
      const internalMessages: InternalMessage[] = [
        {content: 'msg1', role: 'user'},
        {content: 'msg2', role: 'assistant'},
        {content: 'msg3', role: 'user'},
      ]

      ;(mockContextManager.getMessages as SinonStub).returns(internalMessages)

      const count = session.getMessageCount()
      const history = session.getHistory()

      expect(count).to.equal(history.length)
    })
  })

  describe('run()', () => {
    it('should return response from llmService', async () => {
      ;(mockLLMService.completeTask as SinonStub).resolves('test response')

      const result = await session.run('test input')

      expect(result).to.equal('test response')
      expect((mockLLMService.completeTask as SinonStub).calledOnce).to.be.true
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[0]).to.equal('test input')
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[1]).to.equal(sessionId)
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[2].signal).to.be.instanceOf(AbortSignal)
    })

    it('should pass signal to completeTask', async () => {
      const signalSpy = sandbox.spy()
      ;(mockLLMService.completeTask as SinonStub).callsFake((_input, _sessionId, options) => {
        signalSpy(options?.signal)
        return Promise.resolve('response')
      })

      await session.run('input')

      expect(signalSpy.calledOnce).to.be.true
      expect(signalSpy.firstCall.args[0]).to.be.instanceOf(AbortSignal)
    })

    it('should support executionContext with commandType query', async () => {
      await session.run('input', {executionContext: {commandType: 'query'}})

      expect((mockLLMService.completeTask as SinonStub).calledOnce).to.be.true
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[0]).to.equal('input')
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[1]).to.equal(sessionId)
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[2]).to.deep.include({
        executionContext: {commandType: 'query'},
      })
      expect((mockLLMService.completeTask as SinonStub).firstCall.args[2].signal).to.be.instanceOf(AbortSignal)
    })

    it('should throw SessionCancelledError when cancelled', async () => {
      const abortController = new AbortController()
      ;(mockLLMService.completeTask as SinonStub).callsFake(async () => {
        abortController.abort()
        await new Promise((resolve) => {
          setTimeout(resolve, 10)
        })
        throw new Error('Cancelled')
      })

      // Start run and cancel immediately
      const runPromise = session.run('input')
      session.cancel()

      try {
        await runPromise
        expect.fail('Should have thrown SessionCancelledError')
      } catch (error) {
        expect(error).to.be.instanceOf(SessionCancelledError)
        expect((error as SessionCancelledError).details?.sessionId).to.equal(sessionId)
      }
    })

    it('should throw LLMError when llmService throws error', async () => {
      const llmError = new Error('LLM service error')
      ;(mockLLMService.completeTask as SinonStub).rejects(llmError)

      try {
        await session.run('input')
        expect.fail('Should have thrown LLMError')
      } catch (error) {
        expect(error).to.be.instanceOf(LLMError)
        expect((error as LLMError).message).to.include('LLM service error')
        expect((error as LLMError).details?.sessionId).to.equal(sessionId)
      }
    })

    it('should clear currentController after completion', async () => {
      await session.run('input')

      // currentController should be undefined after completion
      // We can't directly access private property, but we can verify by running again
      // If controller wasn't cleared, second run would have issues
      await session.run('input2')

      expect((mockLLMService.completeTask as SinonStub).calledTwice).to.be.true
    })
  })

  describe('reset()', () => {
    it('should clear history via contextManager', () => {
      session.reset()

      expect((mockLLMService.getContextManager as SinonStub).calledOnce).to.be.true
      expect((mockContextManager.clearHistory as SinonStub).calledOnce).to.be.true
    })

    it('should emit cipher:conversationReset event with sessionId', () => {
      const emitStub = sandbox.stub(agentEventBus, 'emit')

      session.reset()

      expect(emitStub.calledOnce).to.be.true
      expect(emitStub.firstCall.args[0]).to.equal('cipher:conversationReset')
      expect(emitStub.firstCall.args[1]).to.deep.equal({
        sessionId,
      })
    })
  })

  describe('cancel()', () => {
    it('should abort currentController when it exists', async () => {
      const abortSpy = sandbox.spy()
      ;(mockLLMService.completeTask as SinonStub).callsFake(async (_input, _sessionId, options) => {
        const signal = options?.signal as AbortSignal
        signal.addEventListener('abort', abortSpy)
        await new Promise((resolve) => {
          setTimeout(resolve, 10)
        })
        return 'response'
      })

      const runPromise = session.run('input')
      session.cancel()
      await runPromise.catch(() => {
        // Expected to fail
      })

      // Verify abort was called
      expect(abortSpy.called).to.be.true
    })

    it('should not throw when no currentController exists', () => {
      expect(() => session.cancel()).to.not.throw()
    })
  })

  describe('dispose()', () => {
    it('should cleanup event forwarders', () => {
      const offStub = sandbox.stub(sessionEventBus, 'off')

      session.dispose()

      // Should call off for each event name (10 events in ChatSession's SESSION_EVENT_NAMES)
      expect(offStub.callCount).to.equal(10)
    })

    it('should clear forwarders map', () => {
      // Access private forwarders through dispose behavior
      session.dispose()

      // After dispose, emitting events should not forward (forwarders cleared)
      const agentEmitStub = sandbox.stub(agentEventBus, 'emit')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionEventBus.emit('llmservice:chunk' as any, {})

      // Should not forward after dispose
      expect(agentEmitStub.called).to.be.false
    })
  })

  describe('getLLMService()', () => {
    it('should return llmService instance', () => {
      const service = session.getLLMService()

      expect(service).to.equal(mockLLMService)
    })
  })
})
