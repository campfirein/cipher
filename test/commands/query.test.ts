/// <reference types="mocha" />

import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'
import type {TransportClientFactory} from '../../src/infra/transport/transport-client-factory.js'

import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../../src/core/domain/errors/connection-error.js'
import {QueryUseCase, type QueryUseCaseOptions} from '../../src/infra/usecase/query-use-case.js'
import {
  createMockTerminal,
  createMockTransportClient,
  createMockTransportFactory,
  type MockTransportClient,
  type MockTransportFactory,
} from '../helpers/mock-factories.js'

/**
 * Testable subclass that allows injecting mock transport factory.
 * Uses type assertion to bypass strict type checking for test mocks.
 */
class TestableQueryUseCase extends QueryUseCase {
  constructor(options: QueryUseCaseOptions, private mockFactory: MockTransportFactory) {
    super(options)
  }

  protected createTransportFactory(): TransportClientFactory {
    return this.mockFactory as unknown as TransportClientFactory
  }
}

describe('Query Command', () => {
  let sandbox: sinon.SinonSandbox
  let loggedMessages: string[]
  let terminal: ITerminal
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let mockClient: MockTransportClient
  let mockFactory: MockTransportFactory

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    loggedMessages = []

    terminal = createMockTerminal({
      log: (msg) => msg && loggedMessages.push(msg),
    })

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    mockClient = createMockTransportClient(sandbox)
    mockFactory = createMockTransportFactory(sandbox, mockClient)
  })

  afterEach(() => {
    sandbox.restore()
    restore()
  })

  function createUseCaseOptions(): QueryUseCaseOptions {
    return {
      terminal,
      trackingService,
    }
  }

  function createTestableUseCase(): TestableQueryUseCase {
    return new TestableQueryUseCase(createUseCaseOptions(), mockFactory)
  }

  /**
   * Helper to setup mock that captures taskId from request and simulates completion.
   * The UseCase generates its own taskId via randomUUID(), so we capture it from the request.
   *
   * @param beforeComplete - Optional callback to simulate intermediate events before task:completed
   */
  function setupTaskCompletion(beforeComplete?: (taskId: string, client: MockTransportClient) => void): void {
    const requestStub = mockClient.request as sinon.SinonStub
    requestStub.callsFake(async (_event: string, payload: {taskId: string}) => {
      // Simulate events after event handlers are registered
      setImmediate(() => {
        // Allow test to simulate intermediate events
        if (beforeComplete) {
          beforeComplete(payload.taskId, mockClient)
        }

        // Finally complete the task
        mockClient._simulateEvent('task:completed', {taskId: payload.taskId})
      })
      return {taskId: payload.taskId}
    })
  }

  /**
   * Helper to setup mock that simulates task:error instead of task:completed.
   */
  function setupTaskError(errorMessage: string): void {
    const requestStub = mockClient.request as sinon.SinonStub
    requestStub.callsFake(async (_event: string, payload: {taskId: string}) => {
      setImmediate(() => {
        mockClient._simulateEvent('task:error', {
          error: {message: errorMessage},
          taskId: payload.taskId,
        })
      })
      return {taskId: payload.taskId}
    })
  }

  describe('run - validation', () => {
    it('should require non-empty query argument', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: '', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Query argument is required'))).to.be.true
    })

    it('should require non-whitespace query argument', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: '   ', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Query argument is required'))).to.be.true
    })

    it('should show usage message when query is empty', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: '', verbose: false})

      expect(loggedMessages.some((m) => m.includes('brv query "your question here"'))).to.be.true
    })

    it('should track query started event', async () => {
      const useCase = new QueryUseCase(createUseCaseOptions())

      await useCase.run({query: '', verbose: false})

      expect(trackingService.track.calledWith('mem:query', {status: 'started'})).to.be.true
    })
  })

  describe('run - connection errors', () => {
    it('should handle NoInstanceRunningError with appropriate message', async () => {
      mockFactory.connect.rejects(new NoInstanceRunningError())
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      // Either sandbox or non-sandbox message should be shown
      const hasNoInstanceMessage = loggedMessages.some(
        (m) => m.includes('No ByteRover instance is running') || m.includes("run 'brv' command"),
      )
      expect(hasNoInstanceMessage).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      mockFactory.connect.rejects(new InstanceCrashedError())
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Please restart with: brv'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockFactory.connect.rejects(new ConnectionFailedError(9847, new Error('Connection refused')))
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      // Either sandbox network restriction or generic connection failed message
      const hasConnectionFailedMessage = loggedMessages.some(
        (m) => m.includes('Failed to connect') || m.includes('Sandbox network restriction'),
      )
      expect(hasConnectionFailedMessage).to.be.true
    })

    it('should handle generic ConnectionError', async () => {
      mockFactory.connect.rejects(new ConnectionError('Generic connection error'))
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Connection error'))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      mockFactory.connect.rejects(new Error('Something went wrong'))
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Unexpected error'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })

    it('should track error event on connection failure', async () => {
      mockFactory.connect.rejects(new NoInstanceRunningError())
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(trackingService.track.calledWith('mem:query', sinon.match({status: 'error'}))).to.be.true
    })
  })

  describe('run - success path', () => {
    it('should send task:create request with correct payload', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      await useCase.run({query: 'How does auth work?', verbose: false})

      const requestStub = mockClient.request as sinon.SinonStub
      expect(requestStub.calledOnce).to.be.true
      const [event, payload] = requestStub.firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'How does auth work?')
      expect(payload).to.have.property('type', 'query')
      expect(payload).to.have.property('taskId')
    })

    it('should track finished event on success', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(trackingService.track.calledWith('mem:query', {status: 'finished'})).to.be.true
    })

    it('should disconnect client after completion', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      const disconnectStub = mockClient.disconnect as sinon.SinonStub
      expect(disconnectStub.calledOnce).to.be.true
    })
  })

  describe('run - verbose mode', () => {
    it('should log discovery message when verbose', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Discovering running instance'))).to.be.true
    })

    it('should log connection info when verbose', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Connected to instance'))).to.be.true
    })

    it('should log task created when verbose', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Task created'))).to.be.true
    })
  })

  describe('streamTaskResults - event handling', () => {
    it('should log task acknowledged when verbose', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('task:ack', {taskId})
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Task acknowledged'))).to.be.true
    })

    it('should log task started when verbose', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('task:started', {taskId})
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Task started processing'))).to.be.true
    })

    it('should print response on llmservice:response', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:response', {
          content: 'Authentication uses JWT tokens stored in cookies.',
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Result:'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Authentication uses JWT tokens'))).to.be.true
    })

    it('should not print duplicate responses', async () => {
      setupTaskCompletion((taskId, client) => {
        // Simulate two response events (should only print once)
        client._simulateEvent('llmservice:response', {content: 'First response', taskId})
        client._simulateEvent('llmservice:response', {content: 'Second response', taskId})
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      const resultMessages = loggedMessages.filter((m) => m.includes('Result:'))
      expect(resultMessages).to.have.lengthOf(1)
    })

    it('should format tool calls with tool name', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolCall', {
          args: {pattern: '**/*.ts'},
          taskId,
          toolName: 'glob_files',
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('🔧 glob_files'))).to.be.true
    })

    it('should format tool results with success status', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          result: JSON.stringify({files: ['src/auth.ts', 'src/login.ts']}),
          success: true,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('✓') && m.includes('2 files'))).to.be.true
    })

    it('should format tool results with error status', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          error: 'File not found',
          success: false,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('✗') && m.includes('File not found'))).to.be.true
    })

    it('should resolve on task:completed', async () => {
      setupTaskCompletion()
      const useCase = createTestableUseCase()

      // Should not throw
      await useCase.run({query: 'test query', verbose: false})
    })

    it('should reject on task:error', async () => {
      setupTaskError('Agent execution failed')
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(trackingService.track.calledWith('mem:query', sinon.match({status: 'error'}))).to.be.true
    })

    it('should ignore events for different taskIds', async () => {
      setupTaskCompletion((taskId, client) => {
        // Simulate event for different taskId - should be ignored
        client._simulateEvent('llmservice:response', {
          content: 'Response for different task',
          taskId: 'different-task-id',
        })
        // Also simulate event for correct taskId
        client._simulateEvent('llmservice:response', {
          content: 'Response for correct task',
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      // Should not print the response for different taskId
      expect(loggedMessages.some((m) => m.includes('Response for different task'))).to.be.false
      expect(loggedMessages.some((m) => m.includes('Response for correct task'))).to.be.true
    })
  })

  describe('streamTaskResults - formatting', () => {
    it('should format topics array result', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          result: JSON.stringify({topics: ['auth', 'api', 'database']}),
          success: true,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('3 topics found'))).to.be.true
    })

    it('should format matches array result', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          result: JSON.stringify({matches: ['match1', 'match2']}),
          success: true,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('2 matches'))).to.be.true
    })

    it('should format entries array result', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          result: JSON.stringify({entries: ['entry1', 'entry2', 'entry3', 'entry4']}),
          success: true,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('4 entries'))).to.be.true
    })

    it('should format content with line count', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          result: JSON.stringify({content: 'line1\nline2\nline3'}),
          success: true,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('3 lines'))).to.be.true
    })

    it('should format array result directly', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          result: ['item1', 'item2', 'item3', 'item4', 'item5'],
          success: true,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('5 results'))).to.be.true
    })

    it('should truncate long error messages', async () => {
      const longError = 'A'.repeat(100)
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {
          error: longError,
          success: false,
          taskId,
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      // Should be truncated with ...
      expect(loggedMessages.some((m) => m.includes('...'))).to.be.true
    })

    it('should return Done for no result', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolResult', {success: true, taskId})
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Done'))).to.be.true
    })
  })

  describe('streamTaskResults - tool args formatting', () => {
    it('should extract meaningful args for glob_files', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolCall', {
          args: {pattern: 'src/**/*.ts'},
          taskId,
          toolName: 'glob_files',
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('src/**/*.ts'))).to.be.true
    })

    it('should extract meaningful args for read_file', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolCall', {
          args: {filePath: 'src/auth/login.ts'},
          taskId,
          toolName: 'read_file',
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('src/auth/login.ts'))).to.be.true
    })

    it('should truncate long arg values', async () => {
      const longPath = 'a'.repeat(50) + '/file.ts'
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolCall', {
          args: {filePath: longPath},
          taskId,
          toolName: 'read_file',
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('...'))).to.be.true
    })

    it('should format array args with count', async () => {
      setupTaskCompletion((taskId, client) => {
        client._simulateEvent('llmservice:toolCall', {
          args: {operations: ['add', 'update', 'delete']},
          taskId,
          toolName: 'curate',
        })
      })
      const useCase = createTestableUseCase()

      await useCase.run({query: 'test query', verbose: false})

      expect(loggedMessages.some((m) => m.includes('3 items'))).to.be.true
    })
  })
})
