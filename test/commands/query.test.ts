import {
  ConnectionFailedError,
  type ConnectionResult,
  InstanceCrashedError,
  type ITransportClient,
  NoInstanceRunningError,
} from '@campfirein/brv-transport-client'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {ITerminal} from '../../src/server/core/interfaces/services/i-terminal.js'

import {
  QueryUseCase,
  type QueryUseCaseOptions,
  type TransportConnector,
} from '../../src/server/infra/usecase/query-use-case.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

describe('Query Command', () => {
  let loggedMessages: string[]
  let terminal: ITerminal
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: TransportConnector

  beforeEach(() => {
    loggedMessages = []

    terminal = createMockTerminal({
      log(message?: string) {
        if (message) {
          loggedMessages.push(message)
        }
      },
    })

    // Create mock transport client with event handlers
    const eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()

    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getState: stub().returns('connected'),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().callsFake((event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, [])
        }

        eventHandlers.get(event)!.push(handler)
        return () => {
          const handlers = eventHandlers.get(event)
          if (handlers) {
            const index = handlers.indexOf(handler)
            if (index !== -1) handlers.splice(index, 1)
          }
        }
      }),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves({taskId: 'test-task-id'}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    // Capture taskId from requestWithAck and simulate task completion
    ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (_event: string, payload: {taskId: string}) => {
      // Simulate task completion after a short delay with the client-generated taskId
      setTimeout(() => {
        const handlers = eventHandlers.get('task:completed')
        if (handlers) {
          for (const handler of handlers) {
            handler({result: 'Mock query response', taskId: payload.taskId})
          }
        }
      }, 10)
      return {taskId: payload.taskId}
    })

    // Create mock connector (replaces factory pattern)
    mockConnector = stub().resolves({
      client: mockClient,
      projectRoot: '/test/project',
    } as ConnectionResult)
  })

  afterEach(() => {
    restore()
  })

  function createUseCaseOptions(overrides?: Partial<QueryUseCaseOptions>): QueryUseCaseOptions {
    return {
      terminal,
      transportConnector: mockConnector,
      ...overrides,
    }
  }

  describe('run', () => {
    it('should show usage message when query is empty', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: '', verbose: false})

      expect(loggedMessages).to.include('Query argument is required.')
      expect(loggedMessages).to.include('Usage: brv query "your question here"')
    })

    it('should show usage message when query is whitespace only', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: '   ', verbose: false})

      expect(loggedMessages).to.include('Query argument is required.')
    })

    it('should send task:create request with query and taskId', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: 'What is the architecture?', verbose: false})

      expect(mockClient.requestWithAck.calledOnce).to.be.true
      const [event, payload] = (mockClient.requestWithAck as sinon.SinonStub).firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'What is the architecture?')
      expect(payload).to.have.property('type', 'query')
      expect(payload).to.have.property('taskId').that.is.a('string')
    })

    it('should log verbose messages when verbose is true', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: 'test query', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Discovering running instance'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Connected to instance'))).to.be.true
    })

    it('should disconnect client after request', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: 'test query', verbose: false})

      expect(mockClient.disconnect.calledOnce).to.be.true
    })

    it('should handle NoInstanceRunningError', async () => {
      const errorConnector = stub().rejects(new NoInstanceRunningError())
      const useCase = new QueryUseCase(
        createUseCaseOptions({
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('No ByteRover instance is running'))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      const errorConnector = stub().rejects(new InstanceCrashedError())
      const useCase = new QueryUseCase(
        createUseCaseOptions({
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      const errorConnector = stub().rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))
      const useCase = new QueryUseCase(
        createUseCaseOptions({
          retryDelayMs: 0,
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })
  })
})
