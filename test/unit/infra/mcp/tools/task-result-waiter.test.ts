import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {waitForTaskResult} from '../../../../../src/server/infra/mcp/tools/task-result-waiter.js'

/**
 * Creates a mock transport client for testing.
 * Allows simulation of events and connection state changes.
 */
function createMockClient(): {
  client: ITransportClient
  simulateEvent: <T>(event: string, payload: T) => void
  simulateStateChange: (state: ConnectionState) => void
} {
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>()
  const stateHandlers = new Set<ConnectionStateHandler>()

  const client: ITransportClient = {
    connect: stub().resolves(),
    disconnect: stub().resolves(),
    getClientId: stub().returns('mock-client-id'),
    getDaemonVersion: stub(),
    getState: stub().returns('connected'),
    isConnected: stub().resolves(true),
    joinRoom: stub().resolves(),
    leaveRoom: stub().resolves(),
    on<T>(event: string, handler: (data: T) => void) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set())
      }

      eventHandlers.get(event)!.add(handler as (data: unknown) => void)
      return () => {
        eventHandlers.get(event)?.delete(handler as (data: unknown) => void)
      }
    },
    once: stub(),
    onStateChange(handler: ConnectionStateHandler) {
      stateHandlers.add(handler)
      return () => {
        stateHandlers.delete(handler)
      }
    },
    request: stub() as unknown as ITransportClient['request'],
    requestWithAck: stub().resolves(),
  }

  return {
    client,
    simulateEvent<T>(event: string, payload: T) {
      const handlers = eventHandlers.get(event)
      if (handlers) {
        for (const handler of handlers) {
          handler(payload)
        }
      }
    },
    simulateStateChange(state: ConnectionState) {
      for (const handler of stateHandlers) {
        handler(state)
      }
    },
  }
}

describe('waitForTaskResult', () => {
  afterEach(() => {
    restore()
  })

  describe('successful completion', () => {
    it('should resolve with result when task completes', async () => {
      const {client, simulateEvent} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId)

      // Simulate task completion
      simulateEvent('task:completed', {result: 'Task result content', taskId})

      const result = await resultPromise
      expect(result).to.equal('Task result content')
    })

    it('should use llmservice:response content if task:completed has no result', async () => {
      const {client, simulateEvent} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId)

      // Simulate LLM response followed by completion without result
      simulateEvent('llmservice:response', {content: 'LLM response content', taskId})
      simulateEvent('task:completed', {result: '', taskId})

      const result = await resultPromise
      expect(result).to.equal('LLM response content')
    })

    it('should prefer task:completed result over llmservice:response', async () => {
      const {client, simulateEvent} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId)

      // Simulate LLM response followed by completion with result
      simulateEvent('llmservice:response', {content: 'LLM response', taskId})
      simulateEvent('task:completed', {result: 'Final result', taskId})

      const result = await resultPromise
      expect(result).to.equal('Final result')
    })
  })

  describe('error handling', () => {
    it('should reject with error message when task fails', async () => {
      const {client, simulateEvent} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId).catch((error: Error) => error)

      // Simulate task error
      simulateEvent('task:error', {
        error: {message: 'Something went wrong', name: 'TaskError'},
        taskId,
      })

      const error = await resultPromise
      expect(error).to.be.an('error')
      expect((error as Error).message).to.equal('Something went wrong')
    })

    it('should reject on timeout', async () => {
      const {client} = createMockClient()
      const taskId = 'test-task-id'

      // Use very short timeout for testing
      try {
        await waitForTaskResult(client, taskId, 50)
        expect.fail('Should have thrown timeout error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Task timeout after 50ms')
      }
    })
  })

  describe('disconnect handling', () => {
    it('should reject immediately when connection is lost', async () => {
      const {client, simulateStateChange} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId).catch((error: Error) => error)

      // Simulate disconnect
      simulateStateChange('disconnected')

      const error = await resultPromise
      expect(error).to.be.an('error')
      expect((error as Error).message).to.equal('Connection lost to the daemon')
    })

    it('should not reject on reconnecting state', async () => {
      const {client, simulateEvent, simulateStateChange} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId)

      // Simulate reconnecting (should NOT reject)
      simulateStateChange('reconnecting')

      // Then simulate task completion
      simulateEvent('task:completed', {result: 'Success', taskId})

      const result = await resultPromise
      expect(result).to.equal('Success')
    })

    it('should prefer first resolution (not double-reject)', async () => {
      const {client, simulateEvent, simulateStateChange} = createMockClient()
      const taskId = 'test-task-id'

      const resultPromise = waitForTaskResult(client, taskId)

      // Simulate task completion first
      simulateEvent('task:completed', {result: 'Completed', taskId})

      // Then simulate disconnect (should be ignored)
      simulateStateChange('disconnected')

      const result = await resultPromise
      expect(result).to.equal('Completed')
    })
  })

  describe('event filtering', () => {
    it('should ignore events for other taskIds', async () => {
      const {client, simulateEvent} = createMockClient()
      const taskId = 'my-task-id'

      const resultPromise = waitForTaskResult(client, taskId)

      // Simulate events for different task
      simulateEvent('task:completed', {result: 'Wrong task', taskId: 'other-task-id'})
      simulateEvent('llmservice:response', {content: 'Wrong content', taskId: 'other-task-id'})

      // Simulate correct task completion
      simulateEvent('task:completed', {result: 'Correct result', taskId})

      const result = await resultPromise
      expect(result).to.equal('Correct result')
    })
  })

  describe('cleanup', () => {
    it('should unsubscribe from events after completion', async () => {
      const {client, simulateEvent} = createMockClient()
      const taskId = 'test-task-id'

      // Spy on on() to track unsubscribe calls
      const onSpy = stub(client, 'on').callThrough()

      const resultPromise = waitForTaskResult(client, taskId)

      // Complete the task
      simulateEvent('task:completed', {result: 'Done', taskId})
      await resultPromise

      // Verify on() was called for event subscriptions
      expect(onSpy.called).to.be.true
    })
  })
})
