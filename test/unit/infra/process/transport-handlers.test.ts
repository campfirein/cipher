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

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {createSandbox, match, type SinonFakeTimers, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITransportServer, RequestHandler} from '../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {
  AgentStatusEventNames,
  LlmEventNames,
  TransportAgentEventNames,
  TransportTaskEventNames,
} from '../../../../src/server/core/domain/transport/schemas.js'
import {TransportHandlers} from '../../../../src/server/infra/process/transport-handlers.js'

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

  /**
   * Helper: Register agent AND set up status (required for tasks to work).
   * After Fix 5.1, tasks require cachedAgentStatus to be set.
   */
  function registerAgentWithStatus(agentClientId: string): void {
    const registerHandler = requestHandlers.get(TransportAgentEventNames.REGISTER)
    registerHandler!({}, agentClientId)

    // Simulate agent status broadcast (required for pre-task check)
    const statusHandler = requestHandlers.get(AgentStatusEventNames.STATUS_CHANGED)
    statusHandler!(
      {
        activeTasks: 0,
        hasAuth: true,
        hasConfig: true,
        isInitialized: true,
        queuedTasks: 0,
      },
      agentClientId,
    )
  }

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
    it('should accept task with client-generated taskId and send ack', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      expect(createHandler).to.exist

      // Register agent with status (required for pre-task check)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      const result = createHandler!({content: 'Test task', taskId, type: 'curate'}, 'client-001')

      // Should return the same taskId that was sent
      expect(result).to.deep.equal({taskId})

      // Verify ack was sent to client with the same taskId
      expect((mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.ACK, {taskId})).to.be
        .true
    })

    it('should reject duplicate taskId with error', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()

      // First creation succeeds
      const result1 = createHandler!({content: 'Task 1', taskId, type: 'curate'}, 'client-001')
      expect(result1).to.deep.equal({taskId})

      // Second creation with same taskId should throw
      expect(() => createHandler!({content: 'Task 2', taskId, type: 'curate'}, 'client-002')).to.throw(
        `Task ${taskId} already exists`,
      )
    })

    it('should broadcast task:created to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Broadcast test', taskId, type: 'query'}, 'client-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.CREATED,
          sandbox.match({content: 'Broadcast test', taskId, type: 'query'}),
        ),
      ).to.be.true
    })

    it('should forward task:execute to agent with client-provided taskId', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Execute test', taskId, type: 'curate'}, 'client-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'agent-001',
          TransportTaskEventNames.EXECUTE,
          sandbox.match({
            clientId: 'client-001',
            content: 'Execute test',
            taskId,
            type: 'curate',
          }),
        ),
      ).to.be.true
    })

    it('should include files in execute message when provided', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Files test', files: ['/file1.ts', '/file2.ts'], taskId, type: 'curate'}, 'client-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'agent-001',
          TransportTaskEventNames.EXECUTE,
          sandbox.match({files: ['/file1.ts', '/file2.ts'], taskId}),
        ),
      ).to.be.true
    })
  })

  describe('Agent Not Available', () => {
    it('should send error when no agent registered', async () => {
      // Use fake timers to avoid real delays
      const clock: SinonFakeTimers = sandbox.useFakeTimers()

      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)

      // Don't register any agent
      const taskId = randomUUID()
      const result = createHandler!({content: 'No agent test', taskId, type: 'curate'}, 'client-001') as {
        taskId: string
      }

      expect(result.taskId).to.equal(taskId)

      // Advance time to trigger the setTimeout (100ms in implementation + buffer)
      await clock.tickAsync(150)

      // Error should be sent to client
      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId}),
        ),
      ).to.be.true

      // Error should also be broadcast
      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId}),
        ),
      ).to.be.true

      clock.restore()
    })
  })

  describe('Task Completion', () => {
    it('should route task:completed to task owner', () => {
      // Create a task first
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Complete test', taskId, type: 'curate'}, 'client-001')

      // Simulate task completed from agent
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Task done!', taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.COMPLETED, {
          result: 'Task done!',
          taskId,
        }),
      ).to.be.true
    })

    it('should broadcast task:completed to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Broadcast complete', taskId, type: 'query'}, 'client-001')

      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Done', taskId}, 'agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith('broadcast-room', TransportTaskEventNames.COMPLETED, {
          result: 'Done',
          taskId,
        }),
      ).to.be.true
    })

    it('should clean up task from internal tracking after completion', async () => {
      // Use fake timers to control grace period
      const clock: SinonFakeTimers = sandbox.useFakeTimers()

      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Cleanup test', taskId, type: 'curate'}, 'client-001')

      // Complete the task
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Done', taskId}, 'agent-001')

      // Advance past the 5-second grace period
      await clock.tickAsync(5100)

      // Reset call history to only capture new calls
      ;(mockTransport.sendTo as SinonStub).resetHistory()

      // Try to send an LLM event for the completed task - should be dropped after grace period
      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!(
        {
          content: 'Late response',
          sessionId: 'session-001',
          taskId,
        },
        'agent-001',
      )

      // The LLM event should NOT be forwarded (task was cleaned up after grace period)
      const sendToCalls = (mockTransport.sendTo as SinonStub).getCalls()
      const lateResponseCall = sendToCalls.find(
        (call) =>
          call.args[1] === LlmEventNames.RESPONSE &&
          call.args[2]?.taskId === taskId &&
          call.args[2]?.content === 'Late response',
      )
      expect(lateResponseCall).to.be.undefined

      clock.restore()
    })
  })

  describe('Task Error', () => {
    it('should route task:error to task owner', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Error test', taskId, type: 'curate'}, 'client-001')

      const errorHandler = requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!(
        {
          error: {code: 'TEST_ERROR', message: 'Test error', name: 'TestError'},
          taskId,
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId}),
        ),
      ).to.be.true
    })

    it('should broadcast task:error to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Broadcast error', taskId, type: 'query'}, 'client-001')

      const errorHandler = requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!(
        {
          error: {code: 'BROADCAST_ERROR', message: 'Test', name: 'Error'},
          taskId,
        },
        'agent-001',
      )

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId}),
        ),
      ).to.be.true
    })

    it('should clean up task after error', async () => {
      // Use fake timers to control grace period
      const clock: SinonFakeTimers = sandbox.useFakeTimers()

      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Error cleanup', taskId, type: 'curate'}, 'client-001')

      const errorHandler = requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!({error: {message: 'Test', name: 'Error'}, taskId}, 'agent-001')

      // Advance past the 5-second grace period
      await clock.tickAsync(5100)

      // Reset call history to only capture new calls
      ;(mockTransport.sendTo as SinonStub).resetHistory()

      // Subsequent events should be dropped after grace period
      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'After error', sessionId: 's1', taskId}, 'agent-001')

      // Should not forward after error cleanup (grace period expired)
      const postErrorCalls = (mockTransport.sendTo as SinonStub)
        .getCalls()
        .filter((call) => call.args[2]?.content === 'After error')
      expect(postErrorCalls).to.have.length(0)

      clock.restore()
    })
  })

  describe('Task Cancellation', () => {
    it('should forward cancel to agent when connected', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Cancel test', taskId, type: 'curate'}, 'client-001')

      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId}, 'client-001')

      expect(result).to.deep.equal({success: true})
      expect(
        (mockTransport.sendTo as SinonStub).calledWith('agent-001', TransportTaskEventNames.CANCEL, {
          taskId,
        }),
      ).to.be.true
    })

    it('should return "not found" when cancelling task created without agent (already errored)', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)

      // Create task WITHOUT registering agent first (no agent scenario)
      // Without an agent, the task immediately errors and is cleaned up
      const taskId = randomUUID()
      createHandler!({content: 'No agent task', taskId, type: 'curate'}, 'client-001')

      // Task was immediately cleaned up after error, so cancel should fail
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId}, 'client-001')

      // Cancel should fail because task was already cleaned up after immediate error
      expect(result).to.deep.equal({error: 'Task not found', success: false})

      // Verify the error was sent immediately (not task:cancelled)
      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.ERROR, match({taskId})),
      ).to.be.true
    })

    it('should return error for non-existent task', () => {
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: 'non-existent-task'}, 'client-001')

      expect(result).to.deep.equal({error: 'Task not found', success: false})
    })

    it('should handle task:cancelled from agent', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Agent cancel', taskId, type: 'curate'}, 'client-001')

      const cancelledHandler = requestHandlers.get(TransportTaskEventNames.CANCELLED)
      cancelledHandler!({taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.CANCELLED, {
          taskId,
        }),
      ).to.be.true

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith('broadcast-room', TransportTaskEventNames.CANCELLED, {
          taskId,
        }),
      ).to.be.true
    })
  })

  describe('Task Started', () => {
    it('should route task:started to task owner', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Started test', taskId, type: 'curate'}, 'client-001')

      const startedHandler = requestHandlers.get(TransportTaskEventNames.STARTED)
      startedHandler!({taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', TransportTaskEventNames.STARTED, {
          taskId,
        }),
      ).to.be.true
    })

    it('should broadcast task:started with task info', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Broadcast started', files: ['/test.ts'], taskId, type: 'curate'}, 'client-001')

      const startedHandler = requestHandlers.get(TransportTaskEventNames.STARTED)
      startedHandler!({taskId}, 'agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.STARTED,
          sandbox.match({
            content: 'Broadcast started',
            files: ['/test.ts'],
            taskId,
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
      registerAgentWithStatus('agent-001')

      // Create multiple tasks
      const taskId1 = randomUUID()
      const taskId2 = randomUUID()
      createHandler!({content: 'Task 1', taskId: taskId1, type: 'curate'}, 'client-001')
      createHandler!({content: 'Task 2', taskId: taskId2, type: 'query'}, 'client-002')

      // Disconnect agent
      disconnectionHandler!('agent-001')

      // Both tasks should receive errors
      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: taskId1}),
        ),
      ).to.be.true

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-002',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId: taskId2}),
        ),
      ).to.be.true
    })

    it('should broadcast errors to broadcast-room on agent disconnect', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Broadcast error', taskId, type: 'curate'}, 'client-001')

      disconnectionHandler!('agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          TransportTaskEventNames.ERROR,
          sandbox.match({taskId}),
        ),
      ).to.be.true
    })

    it('should clear tasks map after agent disconnect', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Clear test', taskId, type: 'curate'}, 'client-001')

      disconnectionHandler!('agent-001')

      // Re-register agent with status
      registerAgentWithStatus('agent-002')
      ;(mockTransport.sendTo as SinonStub).resetHistory()

      // Try to cancel the old task - should fail (not found)
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId: 'old-task-id'}, 'client-001')

      expect(result).to.deep.equal({error: 'Task not found', success: false})
    })

    it('should not affect non-agent client disconnections', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Non-agent test', taskId, type: 'curate'}, 'client-001')

      // Disconnect a regular client
      disconnectionHandler!('client-001')

      // Agent should still be connected, task should still exist
      // Cancel should still work
      const cancelHandler = requestHandlers.get(TransportTaskEventNames.CANCEL)
      const result = cancelHandler!({taskId}, 'client-002')

      expect(result).to.deep.equal({success: true})
    })
  })

  describe('LLM Event Routing', () => {
    it('should route llmservice:response to task owner', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Response test', taskId, type: 'curate'}, 'client-001')

      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!(
        {
          content: 'Hello from LLM',
          sessionId: 'session-001',
          taskId,
        },
        'agent-001',
      )

      expect(
        (mockTransport.sendTo as SinonStub).calledWith(
          'client-001',
          LlmEventNames.RESPONSE,
          sandbox.match({content: 'Hello from LLM', taskId}),
        ),
      ).to.be.true
    })

    it('should broadcast LLM events to broadcast-room', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Broadcast LLM', taskId, type: 'curate'}, 'client-001')

      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'Broadcast content', sessionId: 's1', taskId}, 'agent-001')

      expect(
        (mockTransport.broadcastTo as SinonStub).calledWith(
          'broadcast-room',
          LlmEventNames.RESPONSE,
          sandbox.match({taskId}),
        ),
      ).to.be.true
    })

    it('should route llmservice:toolCall correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Tool test', taskId, type: 'curate'}, 'client-001')

      const toolCallHandler = requestHandlers.get(LlmEventNames.TOOL_CALL)
      toolCallHandler!(
        {
          args: {path: '/test.ts'},
          sessionId: 's1',
          taskId,
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

    it('should preserve toolName field (not name) in llmservice:toolCall routing', () => {
      // Regression test: Ensure toolName is preserved and 'name' field is NOT added
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      createHandler!({content: 'test', taskId, type: 'query'}, 'client-001')

      // Simulate toolCall with ONLY toolName (no name field)
      const toolCallHandler = requestHandlers.get(LlmEventNames.TOOL_CALL)
      toolCallHandler!(
        {
          args: {pattern: 'test'},
          callId: 'call-123',
          sessionId: 'session-1',
          taskId,
          toolName: 'grep_content',
        },
        'agent-001',
      )

      // Verify: sendTo should have toolName, NOT name
      const sendToCalls = (mockTransport.sendTo as SinonStub).getCalls()
      const sendToCall = sendToCalls.find((c) => c.args[1] === LlmEventNames.TOOL_CALL)
      expect(sendToCall).to.exist
      expect(sendToCall!.args[2].toolName).to.equal('grep_content')
      expect(sendToCall!.args[2]).to.not.have.property('name')

      // Verify: broadcastTo should also have toolName, NOT name
      const broadcastCalls = (mockTransport.broadcastTo as SinonStub).getCalls()
      const broadcastCall = broadcastCalls.find((c) => c.args[1] === LlmEventNames.TOOL_CALL)
      expect(broadcastCall).to.exist
      expect(broadcastCall!.args[2].toolName).to.equal('grep_content')
      expect(broadcastCall!.args[2]).to.not.have.property('name')
    })

    it('should route llmservice:toolResult correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Tool result test', taskId, type: 'curate'}, 'client-001')

      const toolResultHandler = requestHandlers.get(LlmEventNames.TOOL_RESULT)
      toolResultHandler!(
        {
          result: 'file contents',
          sessionId: 's1',
          success: true,
          taskId,
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
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Chunk test', taskId, type: 'curate'}, 'client-001')

      const chunkHandler = requestHandlers.get(LlmEventNames.CHUNK)
      chunkHandler!(
        {
          content: 'Streaming chunk',
          sessionId: 's1',
          taskId,
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
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Thinking test', taskId, type: 'curate'}, 'client-001')

      const thinkingHandler = requestHandlers.get(LlmEventNames.THINKING)
      thinkingHandler!({sessionId: 's1', taskId}, 'agent-001')

      expect(
        (mockTransport.sendTo as SinonStub).calledWith('client-001', LlmEventNames.THINKING, sandbox.match({taskId})),
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

    it('should drop events for already completed tasks', async () => {
      // Use fake timers to control grace period
      const clock: SinonFakeTimers = sandbox.useFakeTimers()

      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Completed task', taskId, type: 'curate'}, 'client-001')

      // Complete the task
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'Done', taskId}, 'agent-001')

      // Advance past the 5-second grace period
      await clock.tickAsync(5100)

      ;(mockTransport.sendTo as SinonStub).resetHistory()
      ;(mockTransport.broadcastTo as SinonStub).resetHistory()

      // Send late event after grace period
      const responseHandler = requestHandlers.get(LlmEventNames.RESPONSE)
      responseHandler!({content: 'Late event', sessionId: 's1', taskId}, 'agent-001')

      // No LLM events should be forwarded (grace period expired)
      expect((mockTransport.sendTo as SinonStub).called).to.be.false
      expect((mockTransport.broadcastTo as SinonStub).called).to.be.false

      clock.restore()
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
      registerAgentWithStatus('agent-001')

      const taskId = randomUUID()
      createHandler!({content: 'Cleanup test', taskId, type: 'curate'}, 'client-001')

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

  describe('ProjectRouter Integration', () => {
    it('should accept optional ProjectRouter parameter', () => {
      const mockProjectRouter = {
        addToProjectRoom: sandbox.stub(),
        broadcastToProject: sandbox.stub(),
        getProjectMembers: sandbox.stub().returns([]),
        removeFromProjectRoom: sandbox.stub(),
      }

      const handlersWithRouter = new TransportHandlers(mockTransport, mockProjectRouter)
      expect(() => handlersWithRouter.setup()).to.not.throw()
    })

    it('should work without ProjectRouter (backward compatible)', () => {
      const handlersWithoutRouter = new TransportHandlers(mockTransport)
      expect(() => handlersWithoutRouter.setup()).to.not.throw()
    })
  })

  describe('Stress Tests', () => {
    it('should handle 50 concurrent tasks correctly', () => {
      const createHandler = requestHandlers.get(TransportTaskEventNames.CREATE)
      const completedHandler = requestHandlers.get(TransportTaskEventNames.COMPLETED)
      registerAgentWithStatus('agent-001')

      const tasks: Array<{clientId: string; taskId: string}> = []

      // Create 50 tasks from different clients with unique taskIds
      for (let i = 0; i < 50; i++) {
        const clientId = `client-${i % 10}`
        const taskId = randomUUID()
        createHandler!({content: `Task ${i}`, taskId, type: i % 2 === 0 ? 'curate' : 'query'}, clientId)
        tasks.push({clientId, taskId})
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
      registerAgentWithStatus('agent-001')

      for (let i = 0; i < 20; i++) {
        const taskId = randomUUID()
        createHandler!({content: `Rapid ${i}`, taskId, type: 'curate'}, 'client-001')
        const cancelResult = cancelHandler!({taskId}, 'client-001')
        expect(cancelResult).to.deep.equal({success: true})
      }
    })
  })
})
