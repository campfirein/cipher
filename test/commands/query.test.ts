import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Query from '../../src/oclif/commands/query.js'

// ==================== TestableQueryCommand ====================

class TestableQueryCommand extends Query {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    }
  }
}

// ==================== Tests ====================

describe('Query Command', () => {
  let config: Config
  let loggedMessages: string[]
  let stdoutOutput: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []

    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getState: stub().returns('connected'),
      isConnected: stub().resolves(true),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().returns(() => {}),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves({}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableQueryCommand {
    const command = new TestableQueryCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableQueryCommand {
    const command = new TestableQueryCommand([...argv, '--format', 'json'], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  function parseJsonOutput(): Array<{command: string; data: Record<string, unknown>; success: boolean}> {
    const output = stdoutOutput.join('')
    return output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  }

  // ==================== Input Validation ====================

  describe('input validation', () => {
    it('should show usage message when query is empty', async () => {
      await createCommand('').run()

      expect(loggedMessages).to.include('Query argument is required.')
      expect(loggedMessages).to.include('Usage: brv query "your question here"')
    })

    it('should show usage message when query is whitespace only', async () => {
      await createCommand('   ').run()

      expect(loggedMessages).to.include('Query argument is required.')
    })

    it('should output JSON error when query is empty in json mode', async () => {
      await createJsonCommand('').run()

      const [json] = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('message', 'Query argument is required.')
    })
  })

  // ==================== Provider Validation ====================

  describe('provider validation', () => {
    it('should error when no provider is connected', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({activeProviderId: ''})

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('No provider connected'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv provider connect'))).to.be.true
    })

    it('should output JSON error when no provider is connected', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({activeProviderId: ''})

      await createJsonCommand('test query').run()

      const [json] = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error').that.includes('No provider connected')
    })
  })

  // ==================== Task Submission ====================

  describe('task submission', () => {
    it('should send task:create request with query and taskId', async () => {
      // Simulate task:completed via event handler
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          const handlers = eventHandlers.get('task:completed')
          if (handlers) {
            for (const handler of handlers) handler({result: 'Mock response', taskId: payload.taskId})
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createCommand('What is the architecture?').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      expect(requestStub.calledTwice).to.be.true
      const [event, payload] = requestStub.secondCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'What is the architecture?')
      expect(payload).to.have.property('type', 'query')
      expect(payload).to.have.property('taskId').that.is.a('string')
      expect(payload).to.have.property('projectPath', '/test/project')
    })

    it('should display result from task:completed fallback', async () => {
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          const handlers = eventHandlers.get('task:completed')
          if (handlers) {
            for (const handler of handlers) handler({result: 'Direct search result', taskId: payload.taskId})
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('Direct search result'))).to.be.true
    })

    it('should display result from llmservice:response', async () => {
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          // Fire llmservice:response first, then task:completed
          const responseHandlers = eventHandlers.get('llmservice:response')
          if (responseHandlers) {
            for (const handler of responseHandlers) {
              handler({content: 'LLM final answer', sessionId: 'sess-1', taskId: payload.taskId})
            }
          }

          const completedHandlers = eventHandlers.get('task:completed')
          if (completedHandlers) {
            for (const handler of completedHandlers) handler({taskId: payload.taskId})
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('LLM final answer'))).to.be.true
    })

    it('should surface attribution footer from completed payload when streaming (text)', async () => {
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          // llmservice:response fires first WITHOUT the attribution footer
          const responseHandlers = eventHandlers.get('llmservice:response')
          if (responseHandlers) {
            for (const handler of responseHandlers) {
              handler({content: 'The answer is 42.', sessionId: 'sess-1', taskId: payload.taskId})
            }
          }

          // task:completed fires with the result that NOW includes the attribution footer
          const completedHandlers = eventHandlers.get('task:completed')
          if (completedHandlers) {
            for (const handler of completedHandlers) {
              handler({
                result: 'The answer is 42.\n\nSource: ByteRover Knowledge Base',
                taskId: payload.taskId,
              })
            }
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('The answer is 42.'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Source: ByteRover Knowledge Base'))).to.be.true
    })

    it('should surface attribution footer from completed payload when streaming (json)', async () => {
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          const responseHandlers = eventHandlers.get('llmservice:response')
          if (responseHandlers) {
            for (const handler of responseHandlers) {
              handler({content: 'The answer is 42.', sessionId: 'sess-1', taskId: payload.taskId})
            }
          }

          const completedHandlers = eventHandlers.get('task:completed')
          if (completedHandlers) {
            for (const handler of completedHandlers) {
              handler({
                result: 'The answer is 42.\n\nSource: ByteRover Knowledge Base',
                taskId: payload.taskId,
              })
            }
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createJsonCommand('test query').run()

      const lines = parseJsonOutput()
      const completedEvent = lines.find((l) => (l.data as Record<string, unknown>).event === 'completed')
      expect(completedEvent).to.exist
      expect(completedEvent!.data).to.have.property('result', 'The answer is 42.\n\nSource: ByteRover Knowledge Base')
    })

    it('should disconnect client after successful request', async () => {
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          const handlers = eventHandlers.get('task:completed')
          if (handlers) {
            for (const handler of handlers) handler({result: 'done', taskId: payload.taskId})
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createCommand('test query').run()

      expect(mockClient.disconnect.calledOnce).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should stream response event and completed event as separate JSON lines', async () => {
      const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()
      ;(mockClient.on as sinon.SinonStub).callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, [])
        eventHandlers.get(event)!.push(handler)
        return () => {}
      })
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string, payload: {taskId: string}) => {
        if (event === 'provider:getActive') return {activeProviderId: 'anthropic'}
        setTimeout(() => {
          const responseHandlers = eventHandlers.get('llmservice:response')
          if (responseHandlers) {
            for (const handler of responseHandlers) {
              handler({content: 'JSON answer', sessionId: 'sess-1', taskId: payload.taskId})
            }
          }

          const completedHandlers = eventHandlers.get('task:completed')
          if (completedHandlers) {
            for (const handler of completedHandlers) handler({taskId: payload.taskId})
          }
        }, 10)
        return {taskId: payload.taskId}
      })

      await createJsonCommand('test query').run()

      const lines = parseJsonOutput()
      expect(lines.length).to.be.at.least(2)

      const responseEvent = lines.find((l) => (l.data as Record<string, unknown>).event === 'response')
      expect(responseEvent).to.exist
      expect(responseEvent!.data).to.have.property('content', 'JSON answer')

      const completedEvent = lines.find((l) => (l.data as Record<string, unknown>).event === 'completed')
      expect(completedEvent).to.exist
      expect(completedEvent!.data).to.have.property('result', 'JSON answer')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle NoInstanceRunningError', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('No ByteRover instance is running'))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      mockConnector.rejects(new InstanceCrashedError())

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand('test query').run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })

    it('should output JSON on connection error', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createJsonCommand('test query').run()

      const [json] = parseJsonOutput()
      expect(json.command).to.equal('query')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })
  })
})
