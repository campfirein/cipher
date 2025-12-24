/**
 * TaskProcessor Unit Tests
 *
 * Tests the core task processing logic including:
 * - Basic task execution (curate and query)
 * - Agent configuration requirements
 * - Task cancellation behavior
 * - Error propagation from use cases
 * - Running task tracking
 * - Files parameter handling
 *
 * Architecture: TaskProcessor receives tasks and delegates to use cases
 * with an injected CipherAgent reference.
 */

/* eslint-disable no-await-in-loop */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ICipherAgent} from '../../../../src/core/interfaces/cipher/i-cipher-agent.js'
import type {ICurateUseCaseV2} from '../../../../src/core/interfaces/usecase/i-curate-use-case-v2.js'
import type {IQueryUseCaseV2} from '../../../../src/core/interfaces/usecase/i-query-use-case-v2.js'

import {createTaskProcessor, type TaskInput, TaskProcessor} from '../../../../src/infra/core/task-processor.js'

describe('TaskProcessor', () => {
  let sandbox: SinonSandbox
  let mockCurateUseCase: ICurateUseCaseV2
  let mockQueryUseCase: IQueryUseCaseV2
  let mockAgent: ICipherAgent
  let processor: TaskProcessor

  beforeEach(() => {
    sandbox = createSandbox()

    // Create mock use cases
    mockCurateUseCase = {
      executeWithAgent: sandbox.stub().resolves('curate result'),
    }

    mockQueryUseCase = {
      executeWithAgent: sandbox.stub().resolves('query result'),
    }

    // Create minimal mock agent
    mockAgent = {
      cancel: sandbox.stub().resolves(true),
      deleteSession: sandbox.stub().resolves(true),
      execute: sandbox.stub().resolves('executed'),
      generate: sandbox.stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
      getSessionMetadata: sandbox.stub().resolves(),
      getState: sandbox.stub().returns({
        currentIteration: 0,
        executionHistory: [],
        executionState: 'idle',
        toolCallsExecuted: 0,
      }),
      listPersistedSessions: sandbox.stub().resolves([]),
      reset: sandbox.stub(),
      start: sandbox.stub().resolves(),
      stream: sandbox.stub().resolves({
        [Symbol.asyncIterator]: () => ({next: async () => ({done: true, value: undefined})}),
      }),
    } as unknown as ICipherAgent

    // Create processor
    processor = createTaskProcessor({
      curateUseCase: mockCurateUseCase,
      queryUseCase: mockQueryUseCase,
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('createTaskProcessor factory', () => {
    it('should create a TaskProcessor instance', () => {
      const proc = createTaskProcessor({
        curateUseCase: mockCurateUseCase,
        queryUseCase: mockQueryUseCase,
      })
      expect(proc).to.be.instanceOf(TaskProcessor)
    })
  })

  describe('setAgent()', () => {
    it('should accept an agent reference', () => {
      // Should not throw
      expect(() => processor.setAgent(mockAgent)).to.not.throw()
    })

    it('should allow agent to be set multiple times (reinit scenario)', () => {
      const secondAgent = {...mockAgent} as ICipherAgent

      processor.setAgent(mockAgent)
      processor.setAgent(secondAgent)

      // Should use the latest agent
      // This is validated indirectly through process() calls
      expect(() => processor.setAgent(secondAgent)).to.not.throw()
    })
  })

  describe('process() - Basic Execution', () => {
    it('should process curate task with mock agent', async () => {
      processor.setAgent(mockAgent)

      const input: TaskInput = {
        content: 'Test curate content',
        taskId: 'task-001',
        type: 'curate',
      }

      const result = await processor.process(input)

      expect(result).to.equal('curate result')
      expect((mockCurateUseCase.executeWithAgent as SinonStub).calledOnce).to.be.true
      expect((mockCurateUseCase.executeWithAgent as SinonStub).firstCall.args[0]).to.equal(mockAgent)
      expect((mockCurateUseCase.executeWithAgent as SinonStub).firstCall.args[1]).to.deep.include({
        content: 'Test curate content',
        taskId: 'task-001',
      })
    })

    it('should process query task with mock agent', async () => {
      processor.setAgent(mockAgent)

      const input: TaskInput = {
        content: 'Test query content',
        taskId: 'task-002',
        type: 'query',
      }

      const result = await processor.process(input)

      expect(result).to.equal('query result')
      expect((mockQueryUseCase.executeWithAgent as SinonStub).calledOnce).to.be.true
      expect((mockQueryUseCase.executeWithAgent as SinonStub).firstCall.args[0]).to.equal(mockAgent)
      expect((mockQueryUseCase.executeWithAgent as SinonStub).firstCall.args[1]).to.deep.equal({
        query: 'Test query content',
        taskId: 'task-002',
      })
    })

    it('should pass files parameter for curate task', async () => {
      processor.setAgent(mockAgent)

      const input: TaskInput = {
        content: 'Curate with files',
        files: ['/path/to/file1.ts', '/path/to/file2.ts'],
        taskId: 'task-003',
        type: 'curate',
      }

      await processor.process(input)

      expect((mockCurateUseCase.executeWithAgent as SinonStub).firstCall.args[1]).to.deep.include({
        content: 'Curate with files',
        files: ['/path/to/file1.ts', '/path/to/file2.ts'],
        taskId: 'task-003',
      })
    })

    it('should handle undefined files parameter', async () => {
      processor.setAgent(mockAgent)

      const input: TaskInput = {
        content: 'Curate without files',
        taskId: 'task-004',
        type: 'curate',
      }

      await processor.process(input)

      const callArgs = (mockCurateUseCase.executeWithAgent as SinonStub).firstCall.args[1]
      expect(callArgs.files).to.be.undefined
    })
  })

  describe('process() - Agent Not Configured', () => {
    it('should throw error when setAgent() not called', async () => {
      const input: TaskInput = {
        content: 'Test content',
        taskId: 'task-005',
        type: 'curate',
      }

      try {
        await processor.process(input)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).to.equal('Agent not configured. Call setAgent() first.')
      }
    })

    it('should work after setAgent() is called', async () => {
      const input: TaskInput = {
        content: 'Test content',
        taskId: 'task-006',
        type: 'curate',
      }

      // First attempt should fail
      try {
        await processor.process(input)
        expect.fail('Should have thrown')
      } catch {
        // Expected
      }

      // Set agent and retry
      processor.setAgent(mockAgent)
      const result = await processor.process(input)
      expect(result).to.equal('curate result')
    })
  })

  describe('process() - Error Propagation', () => {
    it('should propagate error from curate use case', async () => {
      processor.setAgent(mockAgent)
      ;(mockCurateUseCase.executeWithAgent as SinonStub).rejects(new Error('Curate failed'))

      const input: TaskInput = {
        content: 'Error content',
        taskId: 'task-007',
        type: 'curate',
      }

      try {
        await processor.process(input)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Curate failed')
      }
    })

    it('should propagate error from query use case', async () => {
      processor.setAgent(mockAgent)
      ;(mockQueryUseCase.executeWithAgent as SinonStub).rejects(new Error('Query failed'))

      const input: TaskInput = {
        content: 'Error content',
        taskId: 'task-008',
        type: 'query',
      }

      try {
        await processor.process(input)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Query failed')
      }
    })

    it('should clean up runningTasks map after error', async () => {
      processor.setAgent(mockAgent)
      ;(mockCurateUseCase.executeWithAgent as SinonStub).rejects(new Error('Cleanup test'))

      const input: TaskInput = {
        content: 'Error content',
        taskId: 'task-009',
        type: 'curate',
      }

      try {
        await processor.process(input)
      } catch {
        // Expected
      }

      // Task should be removed from running tasks
      expect(processor.isRunning('task-009')).to.be.false
    })
  })

  describe('cancel()', () => {
    it('should return true for running task', async () => {
      processor.setAgent(mockAgent)

      // Create a task that takes time
      let resolveTask: (value: string) => void
      ;(mockCurateUseCase.executeWithAgent as SinonStub).returns(
        new Promise((resolve) => {
          resolveTask = resolve
        }),
      )

      const input: TaskInput = {
        content: 'Long running',
        taskId: 'task-010',
        type: 'curate',
      }

      // Start processing (don't await)
      const processPromise = processor.process(input)

      // Give it a tick to register
      await new Promise((resolve) => {
        setImmediate(resolve)
      })

      // Now cancel
      const cancelled = processor.cancel('task-010')
      expect(cancelled).to.be.true

      // Resolve the underlying task
      resolveTask!('done')

      // The process should throw "Task cancelled"
      try {
        await processPromise
        expect.fail('Should have thrown Task cancelled')
      } catch (error) {
        expect((error as Error).message).to.equal('Task cancelled')
      }
    })

    it('should return false for non-existent task', () => {
      const cancelled = processor.cancel('non-existent-task')
      expect(cancelled).to.be.false
    })

    it('should be idempotent - multiple cancel calls return false after first', async () => {
      processor.setAgent(mockAgent)

      let resolveTask: (value: string) => void
      ;(mockCurateUseCase.executeWithAgent as SinonStub).returns(
        new Promise((resolve) => {
          resolveTask = resolve
        }),
      )

      const input: TaskInput = {
        content: 'Multi cancel test',
        taskId: 'task-011',
        type: 'curate',
      }

      const processPromise = processor.process(input)

      await new Promise((resolve) => {
        setImmediate(resolve)
      })

      // First cancel should succeed
      const firstCancel = processor.cancel('task-011')
      expect(firstCancel).to.be.true

      // Second cancel should return false (already cancelled and removed)
      const secondCancel = processor.cancel('task-011')
      expect(secondCancel).to.be.false

      // Third cancel should also return false
      const thirdCancel = processor.cancel('task-011')
      expect(thirdCancel).to.be.false

      resolveTask!('done')
      try {
        await processPromise
      } catch {
        // Expected - task was cancelled
      }
    })
  })

  describe('isRunning()', () => {
    it('should return false for unknown task', () => {
      expect(processor.isRunning('unknown-task')).to.be.false
    })

    it('should return true while task is processing', async () => {
      processor.setAgent(mockAgent)

      let resolveTask: (value: string) => void
      ;(mockCurateUseCase.executeWithAgent as SinonStub).returns(
        new Promise((resolve) => {
          resolveTask = resolve
        }),
      )

      const input: TaskInput = {
        content: 'Running check',
        taskId: 'task-012',
        type: 'curate',
      }

      const processPromise = processor.process(input)

      await new Promise((resolve) => {
        setImmediate(resolve)
      })

      expect(processor.isRunning('task-012')).to.be.true

      resolveTask!('done')
      await processPromise

      expect(processor.isRunning('task-012')).to.be.false
    })

    it('should return false after task completes', async () => {
      processor.setAgent(mockAgent)

      const input: TaskInput = {
        content: 'Complete check',
        taskId: 'task-013',
        type: 'curate',
      }

      await processor.process(input)

      expect(processor.isRunning('task-013')).to.be.false
    })

    it('should return false after task errors', async () => {
      processor.setAgent(mockAgent)
      ;(mockCurateUseCase.executeWithAgent as SinonStub).rejects(new Error('Test error'))

      const input: TaskInput = {
        content: 'Error check',
        taskId: 'task-014',
        type: 'curate',
      }

      try {
        await processor.process(input)
      } catch {
        // Expected
      }

      expect(processor.isRunning('task-014')).to.be.false
    })
  })

  describe('runningTasks tracking', () => {
    it('should track multiple concurrent tasks', async () => {
      processor.setAgent(mockAgent)

      const resolvers: Array<(value: string) => void> = []
      ;(mockCurateUseCase.executeWithAgent as SinonStub).callsFake(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve)
          }),
      )
      ;(mockQueryUseCase.executeWithAgent as SinonStub).callsFake(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve)
          }),
      )

      // Start multiple tasks
      const promise1 = processor.process({content: 'Task 1', taskId: 'concurrent-1', type: 'curate'})
      const promise2 = processor.process({content: 'Task 2', taskId: 'concurrent-2', type: 'query'})
      const promise3 = processor.process({content: 'Task 3', taskId: 'concurrent-3', type: 'curate'})

      await new Promise((resolve) => {
        setImmediate(resolve)
      })

      // All should be running
      expect(processor.isRunning('concurrent-1')).to.be.true
      expect(processor.isRunning('concurrent-2')).to.be.true
      expect(processor.isRunning('concurrent-3')).to.be.true

      // Complete first task
      resolvers[0]('result-1')
      await promise1

      expect(processor.isRunning('concurrent-1')).to.be.false
      expect(processor.isRunning('concurrent-2')).to.be.true
      expect(processor.isRunning('concurrent-3')).to.be.true

      // Complete remaining
      resolvers[1]('result-2')
      resolvers[2]('result-3')
      await Promise.all([promise2, promise3])

      expect(processor.isRunning('concurrent-1')).to.be.false
      expect(processor.isRunning('concurrent-2')).to.be.false
      expect(processor.isRunning('concurrent-3')).to.be.false
    })

    it('should properly clean up after rapid task sequences', async () => {
      processor.setAgent(mockAgent)

      // Process 20 tasks rapidly
      const promises = []
      for (let i = 0; i < 20; i++) {
        promises.push(
          processor.process({
            content: `Rapid task ${i}`,
            taskId: `rapid-${i}`,
            type: i % 2 === 0 ? 'curate' : 'query',
          }),
        )
      }

      await Promise.all(promises)

      // All tasks should be cleaned up
      for (let i = 0; i < 20; i++) {
        expect(processor.isRunning(`rapid-${i}`)).to.be.false
      }
    })
  })

  describe('Stress Tests', () => {
    it('should handle 100 task cycles without issues', async () => {
      processor.setAgent(mockAgent)

      for (let i = 0; i < 100; i++) {
        const result = await processor.process({
          content: `Stress task ${i}`,
          taskId: `stress-${i}`,
          type: i % 2 === 0 ? 'curate' : 'query',
        })

        expect(result).to.be.oneOf(['curate result', 'query result'])
        expect(processor.isRunning(`stress-${i}`)).to.be.false
      }

      // Verify use case calls
      const curateCallCount = (mockCurateUseCase.executeWithAgent as SinonStub).callCount
      const queryCallCount = (mockQueryUseCase.executeWithAgent as SinonStub).callCount

      expect(curateCallCount).to.equal(50) // Even indices
      expect(queryCallCount).to.equal(50) // Odd indices
    })

    it('should handle interleaved process and cancel operations', async () => {
      processor.setAgent(mockAgent)

      const resolvers: Map<string, (value: string) => void> = new Map()
      ;(mockCurateUseCase.executeWithAgent as SinonStub).callsFake(
        (_agent: ICipherAgent, options: {taskId: string}) =>
          new Promise((resolve) => {
            resolvers.set(options.taskId, resolve)
          }),
      )

      // Start 10 tasks
      const promises: Array<Promise<string>> = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          processor.process({
            content: `Interleaved ${i}`,
            taskId: `interleaved-${i}`,
            type: 'curate',
          }),
        )
      }

      await new Promise((resolve) => {
        setImmediate(resolve)
      })

      // Cancel odd-numbered tasks
      for (let i = 1; i < 10; i += 2) {
        processor.cancel(`interleaved-${i}`)
      }

      // Resolve all tasks
      for (let i = 0; i < 10; i++) {
        const resolver = resolvers.get(`interleaved-${i}`)
        if (resolver) {
          resolver(`result-${i}`)
        }
      }

      // Verify outcomes
      const results = await Promise.allSettled(promises)

      // Even tasks should succeed
      for (let i = 0; i < 10; i += 2) {
        expect(results[i].status).to.equal('fulfilled')
      }

      // Odd tasks should fail with "Task cancelled"
      for (let i = 1; i < 10; i += 2) {
        expect(results[i].status).to.equal('rejected')
        if (results[i].status === 'rejected') {
          expect((results[i] as PromiseRejectedResult).reason.message).to.equal('Task cancelled')
        }
      }

      // All tasks should be cleaned up
      for (let i = 0; i < 10; i++) {
        expect(processor.isRunning(`interleaved-${i}`)).to.be.false
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      processor.setAgent(mockAgent)

      const result = await processor.process({
        content: '',
        taskId: 'empty-content',
        type: 'curate',
      })

      expect(result).to.equal('curate result')
    })

    it('should handle very long content', async () => {
      processor.setAgent(mockAgent)

      const longContent = 'x'.repeat(100_000)

      const result = await processor.process({
        content: longContent,
        taskId: 'long-content',
        type: 'curate',
      })

      expect(result).to.equal('curate result')
      expect((mockCurateUseCase.executeWithAgent as SinonStub).firstCall.args[1].content).to.have.length(100_000)
    })

    it('should handle special characters in taskId', async () => {
      processor.setAgent(mockAgent)

      const specialIds = ['task-with-dash', 'task_with_underscore', 'task.with.dot', 'task:with:colon', 'task/with/slash']

      for (const taskId of specialIds) {
        const result = await processor.process({
          content: 'Special ID test',
          taskId,
          type: 'query',
        })
        expect(result).to.equal('query result')
      }
    })

    it('should handle unicode content', async () => {
      processor.setAgent(mockAgent)

      const unicodeContent = 'Unicode test: 你好世界 🌍 مرحبا Привет'

      await processor.process({
        content: unicodeContent,
        taskId: 'unicode-test',
        type: 'curate',
      })

      expect((mockCurateUseCase.executeWithAgent as SinonStub).firstCall.args[1].content).to.equal(unicodeContent)
    })
  })
})
