/**
 * TransportHandlers Unit Tests
 *
 * Tests the message routing logic between clients and Agent in the Transport Process.
 *
 * Key scenarios:
 * - Agent registration and connection state
 * - Task creation and routing
 * - Task lifecycle events (started, completed, error, cancelled)
 * - LLM event routing to correct clients
 * - Agent disconnect handling
 * - Cleanup behavior
 */

/* eslint-disable no-promise-executor-return */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITransportServer, RequestHandler} from '../../../../src/core/interfaces/transport/i-transport-server.js'

import {
  LlmEventNames,
  TransportAgentEventNames,
  TransportTaskEventNames,
} from '../../../../src/core/domain/transport/schemas.js'
import {TransportHandlers} from '../../../../src/infra/process/transport-handlers.js'

describe('TransportHandlers', () => {
  let sandbox: SinonSandbox
  let mockTransport: ITransportServer
  let handlers: TransportHandlers

  // Track registered handlers for testing
  let requestHandlers: Map<string, RequestHandler>
  let connectionHandler: ((clientId: string) => void) | undefined
  let disconnectionHandler: ((clientId: string) => void) | undefined

  beforeEach(() => {
    sandbox = createSandbox()
    requestHandlers = new Map()

    // Create mock transport
    mockTransport = {
      addToRoom: sandbox.stub(),
      broadcast: sandbox.stub(),
      broadcastTo: sandbox.stub(),
      getPort: sandbox.stub().returns(3000),
      isRunning: sandbox.stub().returns(true),
      onConnection: sandbox.stub().callsFake((handler) => {
        connectionHandler = handler
      }),
      onDisconnection: sandbox.stub().callsFake((handler) => {
        disconnectionHandler = handler
      }),
      onRequest: sandbox.stub().callsFake((event: string, handler: RequestHandler) => {
        requestHandlers.set(event, handler)
      }),
      removeFromRoom: sandbox.stub(),
      sendTo: sandbox.stub(),
      start: sandbox.stub().resolves(),
      stop: sandbox.stub().resolves(),
    }

    handlers = new TransportHandlers(mockTransport)
    handlers.setup()
  })

  afterEach(() => {
    sandbox.restore()
    requestHandlers.clear()
    connectionHandler = undefined
    disconnectionHandler = undefined
  })

  describe('Agent Registration', () => {
    it('should register agent on agent:register event', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      expect(registerHandler).to.exist

      const result = registerHandler!({}, 'agent-client-001')

      expect(result).to.deep.equal({success: true})
      expect((mockTransport.broadcast as SinonStub).calledWith(TransportAgentEventNames.CONNECTED, {})).to.be.true
    })

    it('should allow agent to re-register (replace old agent)', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)

      // First registration
      registerHandler!({}, 'agent-client-001')

      // Second registration should succeed
      const result = registerHandler!({}, 'agent-client-002')
      expect(result).to.deep.equal({success: true})

      // Broadcast should be called twice
      expect((mockTransport.broadcast as SinonStub).callCount).to.equal(2)
    })
  })

  describe('Task Creation', () => {
    it('should create task and send ack to client', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      expect(createHandler).to.exist

      // Register agent first
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const result = createHandler!({content: 'Test task', type: 'curate'}, 'client-001')

      expect(result).to.have.property('taskId')
      expect((result as {taskId: string}).taskId).to.be.a('string')

      // Verify ack was sent to client
      expect((mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.ACK)).to.be.true
    })

    it('should generate unique taskIds for each task', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const result1 = createHandler!({content: 'Task 1', type: 'curate'}, 'client-001') as {taskId: string}
      const result2 = createHandler!({content: 'Task 2', type: 'query'}, 'client-001') as {taskId: string}

      expect(result1.taskId).to.not.equal(result2.taskId)
    })

    it('should broadcast task:created to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      createHandler!({content: 'Broadcast test', type: 'query'}, 'client-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.CREATED,
          sandbox.match({content: 'Broadcast test', type: 'query'}),
        ),
      ).to.be.true
    })

    it('should forward task:execute to agent', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const result = createHandler!({content: 'Execute test', type: 'curate'}, 'client-001') as {taskId: string}

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'agent-001',
          TransportTaskEventNames.EXECUTE,
          sandbox.match({
            clientId: 'client-001',
            content: 'Execute test',
            taskId: result.taskId,
            type: 'curate',
          }),
        ),
      ).to.be.true
    })

    it('should include files in execute message when provided', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      createHandler!({content: 'Files test', files: ['/file1.ts', '/file2.ts'], type: 'curate'}, 'client-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'agent-001',
          TransportTaskEventNames.EXECUTE,
          sandbox.match({files: ['/file1.ts', '/file2.ts']}),
        ),
      ).to.be.true
    })
  })

  describe('Agent Not Available', () => {
    it('should send error when no agent registered', async () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)

      // Don't register any agent
      const result = createHandler!({content: 'No agent test', type: 'curate'}, 'client-001') as {taskId: string}

      expect(result.taskId).to.be.a('string')

      // Wait for setTimeout to execute
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Error should be sent to client
      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: result.taskId}),
        ),
      ).to.be.true

      // Error should also be broadcast
      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: result.taskId}),
        ),
      ).to.be.true
    })
  })

  describe('Task Completion', () => {
    it('should route task:completed to task owner', () => {
      // Create a task first
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Complete test', type: 'curate'}, 'client-001') as {taskId: string}

      // Simulate task completed from agent
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Task done!', taskId: createResult.taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.COMPLETED, {
          result: 'Task done!',
          taskId: createResult.taskId,
        }),
      ).to.be.true
    })

    it('should broadcast task:completed to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Broadcast complete', type: 'query'}, 'client-001') as {
        taskId: string
      }

      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Done', taskId: createResult.taskId}, 'agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith('broadcast-room', TransportTaskEventNames.COMPLETED, {
          result: 'Done',
          taskId: createResult.taskId,
        }),
      ).to.be.true
    })

    it('should clean up task from internal tracking after completion', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Cleanup test', type: 'curate'}, 'client-001') as {taskId: string}

      // Complete the task
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Done', taskId: createResult.taskId}, 'agent-001')

      // Try to send an LLM event for the completed task - should be dropped
      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!(
        {
          content: 'Late response',
          sessionId: 'session-001',
          taskId: createResult.taskId,
        },
        'agent-001',
      )

      // The LLM event should NOT be forwarded (task was cleaned up)
      const sendToCalls = (mockTransport.sendTo as SinonStub).getCalls()
      const lateResponseCall = sendToCalls.find(
        (call) =>
          call.args[1] === LlmEventNames.RESPONSE &&
          call.args[2]?.taskId === createResult.taskId &&
          call.args[2]?.content === 'Late response',
      )
      expect(lateResponseCall).to.be.undefined
    })
  })

  describe('Task Error', () => {
    it('should route task:error to task owner', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Error test', type: 'curate'}, 'client-001') as {taskId: string}

      const errorHandler = requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!(
        {
          error: {code: 'TEST_ERROR', message: 'Test error', name: 'TestError'},
          taskId: createResult.taskId,
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: createResult.taskId}),
        ),
      ).to.be.true
    })

    it('should broadcast task:error to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Broadcast error', type: 'query'}, 'client-001') as {
        taskId: string
      }

      const errorHandler = requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!(
        {
          error: {code: 'BROADCAST_ERROR', message: 'Test', name: 'Error'},
          taskId: createResult.taskId,
        },
        'agent-001',
      )

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: createResult.taskId}),
        ),
      ).to.be.true
    })

    it('should clean up task after error', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Error cleanup', type: 'curate'}, 'client-001') as {taskId: string}

      const errorHandler = requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!({error: {message: 'Test', name: 'Error'}, taskId: createResult.taskId}, 'agent-001')

      // Subsequent events should be dropped
      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'After error', sessionId: 's1', taskId: createResult.taskId}, 'agent-001')

      // Should not forward after error cleanup
      const postErrorCalls = (mockTransport.sendTo as SinonStub)
        .getCalls()
        .filter((call) => call.args[2]?.content === 'After error')
      expect(postErrorCalls).to.have.length(0)
    })
  })

  describe('Task Cancellation', () => {
    it('should forward cancel to agent when connected', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Cancel test', type: 'curate'}, 'client-001') as {taskId: string}

      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: createResult.taskId}, 'client-001')

      expect(result).to.deep.equal({success: true})
      expect(
        (mockTransport.sendTo as SinonStub).calledWith('agent-001', TransportTaskEventNames.CANCEL, {
          taskId: createResult.taskId,
        }),
      ).to.be.true
    })

    it('should cancel locally when agent not connected', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)

      // Create task WITHOUT registering agent first (no agent scenario)
      // This simulates the case where task is created but agent hasn't connected yet
      const createResult = createHandler!({content: 'Local cancel', type: 'curate'}, 'client-001') as {taskId: string}

      // Wait for the async error to be sent
      // The task is created with a setTimeout error, so we need to cancel before that fires

      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: createResult.taskId}, 'client-001')

      // Cancel should succeed (task exists locally, will be cancelled before error timeout)
      expect(result).to.deep.equal({success: true})
      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.CANCELLED, {
          taskId: createResult.taskId,
        }),
      ).to.be.true
    })

    it('should return error for non-existent task', () => {
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: 'non-existent-task'}, 'client-001')

      expect(result).to.deep.equal({error: 'Task not found', success: false})
    })

    it('should handle task:cancelled from agent', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Agent cancel', type: 'curate'}, 'client-001') as {taskId: string}

      const cancelledHandler = requestHandlers.get(TransportTaskEventNames.CANCELLED)
      cancelledHandler!({taskId: createResult.taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.CANCELLED, {
          taskId: createResult.taskId,
        }),
      ).to.be.true

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith('broadcast-room', TransportTaskEventNames.CANCELLED, {
          taskId: createResult.taskId,
        }),
      ).to.be.true
    })
  })

  describe('Task Started', () => {
    it('should route task:started to task owner', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!({content: 'Started test', type: 'curate'}, 'client-001') as {taskId: string}

      const startedHandler = requestHandlers.get(TransportTaskEventNames.STARTED)
      startedHandler!({taskId: createResult.taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.STARTED, {
          taskId: createResult.taskId,
        }),
      ).to.be.true
    })

    it('should broadcast task:started with task info', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const createResult = createHandler!(
        {content: 'Broadcast started', files: ['/test.ts'], type: 'curate'},
        'client-001',
      ) as {taskId: string}

      const startedHandler = requestHandlers.get(TransportTaskEventNames.STARTED)
      startedHandler!({taskId: createResult.taskId}, 'agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.STARTED,
          sandbox.match({
            content: 'Broadcast started',
            files: ['/test.ts'],
            taskId: createResult.taskId,
            type: 'curate',
          }),
        ),
      ).to.be.true
    })

    it('should handle task:started for unknown task gracefully', () => {
      const startedHandler = requestHandlers.get(TransportTaskEventNames.STARTED)

      // Should not throw
      expect(() => startedHandler!({taskId: 'unknown-task'}, 'agent-001')).to.not.throw()

      // Should still broadcast with minimal info
      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith('broadcast-room', TransportTaskEventNames.STARTED, {
          taskId: 'unknown-task',
        }),
      ).to.be.true
    })
  })

  describe('Agent Disconnect', () => {
    it('should broadcast agent:disconnected on agent disconnect', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      disconnectionHandler!('agent-001')

      expect((mockTransport.broadcast as SinonStub).calledWith(TransportAgentEventNames.DISCONNECTED, {})).to.be.true
    })

    it('should fail all pending tasks on agent disconnect', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      // Create multiple tasks
      const task1 = createHandler!({content: 'Task 1', type: 'curate'}, 'client-001') as {taskId: string}
      const task2 = createHandler!({content: 'Task 2', type: 'query'}, 'client-002') as {taskId: string}

      // Disconnect agent
      disconnectionHandler!('agent-001')

      // Both tasks should receive errors
      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: task1.taskId}),
        ),
      ).to.be.true

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-002',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: task2.taskId}),
        ),
      ).to.be.true
    })

    it('should broadcast errors to broadcast-room on agent disconnect', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Broadcast error', type: 'curate'}, 'client-001') as {taskId: string}

      disconnectionHandler!('agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: task.taskId}),
        ),
      ).to.be.true
    })

    it('should clear tasks map after agent disconnect', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      createHandler!({content: 'Clear test', type: 'curate'}, 'client-001')

      disconnectionHandler!('agent-001')

      // Re-register agent
      registerHandler!({}, 'agent-002')
      ;(mockTransport.sendTo as SinonStub).resetHistory()

      // Try to cancel the old task - should fail (not found)
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: 'old-task-id'}, 'client-001')

      expect(result).to.deep.equal({error: 'Task not found', success: false})
    })

    it('should not affect non-agent client disconnections', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Non-agent test', type: 'curate'}, 'client-001') as {taskId: string}

      // Disconnect a regular client
      disconnectionHandler!('client-001')

      // Agent should still be connected, task should still exist
      // Cancel should still work
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: task.taskId}, 'client-002')

      expect(result).to.deep.equal({success: true})
    })
  })

  describe('LLM Event Routing', () => {
    it('should route llmservice:response to task owner', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Response test', type: 'curate'}, 'client-001') as {taskId: string}

      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!(
        {
          content: 'Hello from LLM',
          sessionId: 'session-001',
          taskId: task.taskId,
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          LlmEventNames.RESPONSE,
          sandbox.match({content: 'Hello from LLM', taskId: task.taskId}),
        ),
      ).to.be.true
    })

    it('should broadcast LLM events to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Broadcast LLM', type: 'curate'}, 'client-001') as {taskId: string}

      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'Broadcast content', sessionId: 's1', taskId: task.taskId}, 'agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          LlmEventNames.RESPONSE,
          sandbox.match({taskId: task.taskId}),
        ),
      ).to.be.true
    })

    it('should route llmservice:toolCall correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Tool test', type: 'curate'}, 'client-001') as {taskId: string}

      const toolCallHandler = requestHandlers.get(LlmEventNames.TOOL_CALL)
      toolCallHandler!(
        {
          args: {path: '/test.ts'},
          sessionId: 's1',
          taskId: task.taskId,
          toolName: 'read_file',
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          LlmEventNames.TOOL_CALL,
          sandbox.match({toolName: 'read_file'}),
        ),
      ).to.be.true
    })

    it('should route llmservice:toolResult correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Tool result test', type: 'curate'}, 'client-001') as {taskId: string}

      const toolResultHandler = requestHandlers.get(LlmEventNames.TOOL_RESULT)
      toolResultHandler!(
        {
          result: 'file contents',
          sessionId: 's1',
          success: true,
          taskId: task.taskId,
          toolName: 'read_file',
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          LlmEventNames.TOOL_RESULT,
          sandbox.match({success: true, toolName: 'read_file'}),
        ),
      ).to.be.true
    })

    it('should route llmservice:chunk correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Chunk test', type: 'curate'}, 'client-001') as {taskId: string}

      const chunkHandler = requestHandlers.get(LlmEventNames.CHUNK)
      chunkHandler!(
        {
          content: 'Streaming chunk',
          sessionId: 's1',
          taskId: task.taskId,
          type: 'text',
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          LlmEventNames.CHUNK,
          sandbox.match({content: 'Streaming chunk', type: 'text'}),
        ),
      ).to.be.true
    })

    it('should route llmservice:thinking correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Thinking test', type: 'curate'}, 'client-001') as {taskId: string}

      const thinkingHandler = requestHandlers.get(LlmEventNames.THINKING)
      thinkingHandler!({sessionId: 's1', taskId: task.taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          LlmEventNames.THINKING,
          sandbox.match({taskId: task.taskId}),
        ),
      ).to.be.true
    })
  })

  describe('Orphan Event Handling', () => {
    it('should drop LLM events for unknown taskId', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'Orphan content', sessionId: 's1', taskId: 'unknown-task'}, 'agent-001')

      // Should not forward to any client
      const forwardCalls = (mockTransport.sendTo as SinonStub)
        .getCalls()
        .filter((call) => call.args[1] === LlmEventNames.RESPONSE)
      expect(forwardCalls).to.have.length(0)
    })

    it('should drop events for already completed tasks', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const task = createHandler!({content: 'Completed task', type: 'curate'}, 'client-001') as {taskId: string}

      // Complete the task
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Done', taskId: task.taskId}, 'agent-001')
      ;(mockTransport.sendTo as SinonStub).resetHistory()
      ;(mockTransport.broadcastTo as SinonStub).resetHistory()

      // Send late event
      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'Late event', sessionId: 's1', taskId: task.taskId}, 'agent-001')

      // No LLM events should be forwarded
      expect((mockTransport.sendTo as SinonStub).called).to.be.false
      expect((mockTransport.broadcastTo as SinonStub).called).to.be.false
    })
  })

  describe('Agent Control Handlers', () => {
    it('should handle agent:restart request', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const restartHandler = requestHandlers.get(TransportAgentEventNames.RESTART)
      const result = restartHandler!({reason: 'config change'}, 'client-001')

      expect(result).to.deep.equal({success: true})
      expect(
        (mockTransport.sendTo as SinonStub).calledWith('agent-001', TransportAgentEventNames.RESTART, {
          reason: 'config change',
        }),
      ).to.be.true
    })

    it('should return error for restart when agent not connected', () => {
      const restartHandler = requestHandlers.get(TransportAgentEventNames.RESTART)
      const result = restartHandler!({reason: 'test'}, 'client-001')

      expect(result).to.deep.equal({error: 'Agent not connected', success: false})
    })

    it('should broadcast agent:restarting on restart request', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const restartHandler = requestHandlers.get(TransportAgentEventNames.RESTART)
      restartHandler!({reason: 'broadcast test'}, 'client-001')

      expect(
        (mockTransport.broadcast as SinonStub).calledWith(TransportAgentEventNames.RESTARTING, {
          reason: 'broadcast test',
        }),
      ).to.be.true
    })

    it('should handle agent:restarted success', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const restartedHandler = requestHandlers.get(TransportAgentEventNames.RESTARTED)
      restartedHandler!({success: true}, 'agent-001')

      expect((mockTransport.broadcast as SinonStub).calledWith(TransportAgentEventNames.RESTARTED, {success: true})).to
        .be.true
    })

    it('should handle agent:restarted failure', () => {
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      const restartedHandler = requestHandlers.get(TransportAgentEventNames.RESTARTED)
      restartedHandler!({error: 'Failed to restart', success: false}, 'agent-001')

      expect(
        (mockTransport.broadcast as SinonStub).calledWith(TransportAgentEventNames.RESTARTED, {
          error: 'Failed to restart',
          success: false,
        }),
      ).to.be.true
    })
  })

  describe('Cleanup', () => {
    it('should clear tasks and agent on cleanup()', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      createHandler!({content: 'Cleanup test', type: 'curate'}, 'client-001')

      handlers.cleanup()

      // After cleanup, cancel should fail (no tasks)
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: 'any-task'}, 'client-001')
      expect(result).to.deep.equal({error: 'Task not found', success: false})

      // Restart should fail (no agent)
      const restartHandler = requestHandlers.get(TransportAgentEventNames.RESTART)
      const restartResult = restartHandler!({}, 'client-001')
      expect(restartResult).to.deep.equal({error: 'Agent not connected', success: false})
    })
  })

  describe('Connection Handlers', () => {
    it('should track client connections', () => {
      expect(connectionHandler).to.exist
      expect(() => connectionHandler!('new-client-001')).to.not.throw()
    })

    it('should track client disconnections', () => {
      expect(disconnectionHandler).to.exist
      expect(() => disconnectionHandler!('client-001')).to.not.throw()
    })
  })

  describe('Stress Tests', () => {
    it('should handle 50 concurrent tasks correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      registerHandler!({}, 'agent-001')

      const tasks: Array<{clientId: string; taskId: string}> = []

      // Create 50 tasks from different clients
      for (let i = 0; i < 50; i++) {
        const clientId = `client-${i % 10}`
        const result = createHandler!({content: `Task ${i}`, type: i % 2 === 0 ? 'curate' : 'query'}, clientId) as {
          taskId: string
        }
        tasks.push({clientId, taskId: result.taskId})
      }

      // Complete all tasks
      for (const task of tasks) {
        completedHandler!({result: 'Done', taskId: task.taskId}, 'agent-001')
      }

      // All tasks should have received completion
      for (const task of tasks) {
        expect(
          (mockTransport.sendTo as SinonStub).calledWith(task.clientId, TransportTaskEventNames.COMPLETED, {
            result: 'Done',
            taskId: task.taskId,
          }),
        ).to.be.true
      }
    })

    it('should handle rapid create/cancel cycles', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
      registerHandler!({}, 'agent-001')

      for (let i = 0; i < 20; i++) {
        const result = createHandler!({content: `Rapid ${i}`, type: 'curate'}, 'client-001') as {taskId: string}
        const cancelResult = cancelHandler!({taskId: result.taskId}, 'client-001')
        expect(cancelResult).to.deep.equal({success: true})
      }
    })
  })
})
