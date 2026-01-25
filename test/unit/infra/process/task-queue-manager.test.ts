import {expect} from 'chai'
import * as sinon from 'sinon'

import type {TaskExecute} from '../../../../src/core/domain/transport/schemas.js'

import {TaskQueueManager} from '../../../../src/infra/process/task-queue-manager.js'

// ============================================================================
// Helper Functions
// ============================================================================

function createTask(taskId: string, type: 'curate' | 'query', content = 'test'): TaskExecute {
  return {clientId: 'test-client', content, taskId, type}
}

/**
 * Create a blocking executor that never completes (for testing active state).
 * Returns stub and a function to resolve all pending tasks.
 */
function createBlockingExecutor(): {executor: sinon.SinonStub; resolveAll: () => void} {
  const resolvers: Array<() => void> = []
  const executor = sinon.stub().callsFake(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve)
      }),
  )
  return {
    executor,
    resolveAll() {
      for (const resolve of resolvers) resolve()
    },
  }
}

describe('TaskQueueManager', () => {
  let manager: TaskQueueManager

  beforeEach(() => {
    manager = new TaskQueueManager()
  })

  afterEach(() => {
    manager.clear()
    sinon.restore()
  })

  // ============================================================================
  // Enqueue Tests
  // ============================================================================

  describe('enqueue', () => {
    it('should enqueue a curate task successfully', () => {
      const task = createTask('task-1', 'curate')
      const result = manager.enqueue(task)

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.position).to.equal(1) // First in queue
      }
    })

    it('should enqueue a query task successfully', () => {
      const task = createTask('task-1', 'query')
      const result = manager.enqueue(task)

      expect(result.success).to.be.true
    })

    it('should reject duplicate taskId', () => {
      const task1 = createTask('task-1', 'curate')
      const task2 = createTask('task-1', 'query') // Same taskId, different type

      manager.enqueue(task1)
      const result = manager.enqueue(task2)

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('duplicate')
      }
    })

    it('should reject unknown task type', () => {
      const task = {clientId: 'test', content: 'test', taskId: 'task-1', type: 'unknown' as 'curate'}
      const result = manager.enqueue(task)

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('unknown_type')
      }
    })

    it('should allow same taskId after previous task completes', () => {
      // Need executor to process tasks
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      const task1 = createTask('task-1', 'curate')
      manager.enqueue(task1)
      manager.markCompleted('task-1')

      const task2 = createTask('task-1', 'curate')
      const result = manager.enqueue(task2)

      expect(result.success).to.be.true
    })
  })

  // ============================================================================
  // Deduplication Tests
  // ============================================================================

  describe('deduplication', () => {
    it('should track known taskIds', () => {
      const task = createTask('task-1', 'curate')

      expect(manager.isKnown('task-1')).to.be.false
      manager.enqueue(task)
      expect(manager.isKnown('task-1')).to.be.true
    })

    it('should remove taskId from known set after completion', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      const task = createTask('task-1', 'curate')
      manager.enqueue(task)

      expect(manager.isKnown('task-1')).to.be.true
      manager.markCompleted('task-1')
      expect(manager.isKnown('task-1')).to.be.false
    })

    it('should prevent duplicate across different task types', () => {
      const curateTask = createTask('same-id', 'curate')
      const queryTask = createTask('same-id', 'query')

      manager.enqueue(curateTask)
      const result = manager.enqueue(queryTask)

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('duplicate')
      }
    })
  })

  // ============================================================================
  // Cancel Tests
  // ============================================================================

  describe('cancel', () => {
    it('should cancel a queued task', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // First task becomes active (maxConcurrent = 1)
      manager.enqueue(createTask('active-1', 'curate'))
      // Second task goes to queue
      manager.enqueue(createTask('queued-1', 'curate'))

      const result = manager.cancel('queued-1')

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.wasQueued).to.be.true
        expect(result.taskType).to.equal('curate')
      }

      expect(manager.isKnown('queued-1')).to.be.false
    })

    it('should cancel an active task (returns wasQueued=false)', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // With maxConcurrent=1, first task is immediately active
      manager.enqueue(createTask('active-1', 'query'))

      const stats = manager.getStats()
      expect(stats.active).to.equal(1)
      expect(stats.queued).to.equal(0)

      // Cancel an active task
      const result = manager.cancel('active-1')

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.wasQueued).to.be.false // Not queued, was active
        expect(result.taskType).to.equal('query')
      }
    })

    it('should return wasQueued=false for processing task', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      const task = createTask('processing-1', 'curate')
      manager.enqueue(task)

      // Task is now processing (active), not in queue
      const result = manager.cancel('processing-1')

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.wasQueued).to.be.false
      }
    })

    it('should return not_found for unknown taskId', () => {
      const result = manager.cancel('unknown-task')

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('not_found')
      }
    })

    it('should allow re-enqueue after cancel from queue', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('active-1', 'curate')) // Active
      manager.enqueue(createTask('task-1', 'curate')) // Queued (maxConcurrent = 1)

      manager.cancel('task-1')
      const result = manager.enqueue(createTask('task-1', 'curate'))

      expect(result.success).to.be.true
    })
  })

  // ============================================================================
  // Concurrency Tests
  // ============================================================================

  describe('concurrency', () => {
    it('should respect default maxConcurrent of 1 (sequential)', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'query'))
      manager.enqueue(createTask('task-4', 'query'))
      manager.enqueue(createTask('task-5', 'curate'))

      const stats = manager.getStats()

      expect(stats.active).to.equal(1) // Max concurrent = 1 (default)
      expect(stats.queued).to.equal(4) // 4 waiting
      expect(stats.maxConcurrent).to.equal(1)
    })

    it('should allow custom maxConcurrent config', () => {
      const customManager = new TaskQueueManager({
        maxConcurrent: 3,
      })
      const {executor} = createBlockingExecutor()
      customManager.setExecutor(executor)

      for (let i = 0; i < 5; i++) {
        customManager.enqueue(createTask(`task-${i}`, 'curate'))
      }

      const stats = customManager.getStats()
      expect(stats.active).to.equal(3)
      expect(stats.queued).to.equal(2)
      expect(stats.maxConcurrent).to.equal(3)
    })

    it('should process next task when slot becomes available', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'curate'))

      let stats = manager.getStats()
      expect(stats.active).to.equal(1)
      expect(stats.queued).to.equal(2)

      // Complete one task
      manager.markCompleted('task-1')

      stats = manager.getStats()
      expect(stats.active).to.equal(1) // task-2 should now be active
      expect(stats.queued).to.equal(1)
    })

    it('should process tasks from unified queue regardless of type', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // Enqueue mixed types
      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))
      manager.enqueue(createTask('curate-2', 'curate'))

      const stats = manager.getStats()

      // Only 1 task active (sequential), 2 queued
      expect(stats.active).to.equal(1)
      expect(stats.queued).to.equal(2)
    })

    it('should keep tasks in queue without executor', () => {
      // No executor set
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))

      const stats = manager.getStats()
      expect(stats.active).to.equal(0) // Nothing active
      expect(stats.queued).to.equal(2) // Both in queue
    })

    it('should start processing when executor is set', () => {
      // Enqueue first
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))

      let stats = manager.getStats()
      expect(stats.queued).to.equal(2)
      expect(stats.active).to.equal(0)

      // Set executor
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      stats = manager.getStats()
      expect(stats.active).to.equal(1) // Now processing (max 1)
      expect(stats.queued).to.equal(1)
    })
  })

  // ============================================================================
  // Executor Tests
  // ============================================================================

  describe('executor', () => {
    it('should call executor when task is processed', async () => {
      const executor = sinon.stub().resolves()
      manager.setExecutor(executor)

      const task = createTask('task-1', 'curate')
      manager.enqueue(task)

      // Wait for async execution
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(executor.calledOnce).to.be.true
      expect(executor.firstCall.args[0]).to.deep.equal(task)
    })

    it('should mark task completed after executor finishes', async () => {
      const executor = sinon.stub().resolves()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))

      expect(manager.isKnown('task-1')).to.be.true

      // Wait for async execution
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(manager.isKnown('task-1')).to.be.false
    })

    it('should mark task completed even if executor throws', async () => {
      const executor = sinon.stub().rejects(new Error('Test error'))
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))

      // Wait for async execution
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(manager.isKnown('task-1')).to.be.false
    })

    it('should call onExecutorError when executor throws', async () => {
      const onExecutorError = sinon.stub()
      const customManager = new TaskQueueManager({
        onExecutorError,
      })

      const executor = sinon.stub().rejects(new Error('Test executor error'))
      customManager.setExecutor(executor)

      const task = createTask('task-1', 'curate')
      customManager.enqueue(task)

      // Wait for async execution
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(onExecutorError.calledOnce).to.be.true
      expect(onExecutorError.firstCall.args[0]).to.equal('task-1')
      expect(onExecutorError.firstCall.args[1]).to.be.an('error')
      expect((onExecutorError.firstCall.args[1] as Error).message).to.equal('Test executor error')
    })

    it('should process queued tasks after active task completes', async () => {
      let resolveFirst: () => void
      let resolveSecond: () => void
      const firstTaskPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      const secondTaskPromise = new Promise<void>((resolve) => {
        resolveSecond = resolve
      })

      const executor = sinon.stub()
      executor.onFirstCall().returns(firstTaskPromise)
      executor.onSecondCall().returns(secondTaskPromise)
      executor.onThirdCall().resolves()

      manager.setExecutor(executor)

      // Enqueue 3 tasks (1 will be active, 2 queued with maxConcurrent=1)
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'curate'))

      // Initially 1 should be called (maxConcurrent=1)
      expect(executor.callCount).to.equal(1)

      // Complete first task
      resolveFirst!()
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // Now 2 should be called (second task started but waiting)
      expect(executor.callCount).to.equal(2)

      // Complete second task
      resolveSecond!()
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // All 3 should be called
      expect(executor.callCount).to.equal(3)
    })
  })

  // ============================================================================
  // Stats Tests
  // ============================================================================

  describe('getStats', () => {
    it('should return correct stats for empty queue', () => {
      const stats = manager.getStats()

      expect(stats.active).to.equal(0)
      expect(stats.queued).to.equal(0)
      expect(stats.maxConcurrent).to.equal(1)
    })

    it('should return custom maxConcurrent in stats', () => {
      const customManager = new TaskQueueManager({maxConcurrent: 5})
      const stats = customManager.getStats()

      expect(stats.active).to.equal(0)
      expect(stats.queued).to.equal(0)
      expect(stats.maxConcurrent).to.equal(5)
    })

    it('should return stats with executor', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))

      const stats = manager.getStats()

      expect(stats.active).to.equal(1)
      expect(stats.queued).to.equal(1)
    })

    it('should return stats without executor (queued only)', () => {
      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))

      const stats = manager.getStats()

      expect(stats.queued).to.equal(2)
      expect(stats.active).to.equal(0)
    })

    it('should report queued tasks correctly for reinit deferral', () => {
      // This test verifies the fix for the race condition in agent-worker.ts:
      // Credentials polling must check BOTH hasActiveTasks() AND getQueuedCount()
      // to prevent reinit while tasks are queued but not yet running.

      // Enqueue without executor (tasks stay queued, not active)
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'query'))

      // Tasks are queued but NOT active (no executor set)
      expect(manager.hasActiveTasks()).to.be.false
      expect(manager.getQueuedCount()).to.equal(2)

      // The combined check used in pollCredentialsAndSync() should prevent reinit
      const shouldDeferReinit = manager.hasActiveTasks() || manager.getQueuedCount() > 0
      expect(shouldDeferReinit).to.be.true
    })

    it('should return zero queued count when task is active', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // With maxConcurrent=1, task becomes active immediately
      manager.enqueue(createTask('query-1', 'query'))

      expect(manager.hasActiveTasks()).to.be.true
      expect(manager.getQueuedCount()).to.equal(0)
      expect(manager.getActiveCount()).to.equal(1)
    })

    it('should track both active and queued tasks', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // With maxConcurrent=1, first becomes active, rest queued
      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('curate-2', 'curate'))
      manager.enqueue(createTask('curate-3', 'curate'))

      expect(manager.hasActiveTasks()).to.be.true
      expect(manager.getActiveCount()).to.equal(1)
      expect(manager.getQueuedCount()).to.equal(2)

      // Combined check should still defer reinit
      const shouldDeferReinit = manager.hasActiveTasks() || manager.getQueuedCount() > 0
      expect(shouldDeferReinit).to.be.true
    })
  })

  // ============================================================================
  // Clear Tests
  // ============================================================================

  describe('clear', () => {
    it('should reset all state', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))

      manager.clear()

      const stats = manager.getStats()

      expect(stats.active).to.equal(0)
      expect(stats.queued).to.equal(0)
      expect(manager.isKnown('task-1')).to.be.false
    })
  })

  // ============================================================================
  // getQueuedTasks Tests
  // ============================================================================

  describe('getQueuedTasks', () => {
    it('should return empty array when queue is empty', () => {
      const tasks = manager.getQueuedTasks()
      expect(tasks).to.deep.equal([])
    })

    it('should return all queued tasks without executor', () => {
      // No executor = tasks stay in queue
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'query'))

      const tasks = manager.getQueuedTasks()

      expect(tasks).to.have.length(2)
      expect(tasks[0].taskId).to.equal('task-1')
      expect(tasks[1].taskId).to.equal('task-2')
    })

    it('should return only queued tasks, not active tasks', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // With maxConcurrent=1, first task becomes active
      manager.enqueue(createTask('active-1', 'curate'))
      manager.enqueue(createTask('queued-1', 'curate'))
      manager.enqueue(createTask('queued-2', 'query'))

      const tasks = manager.getQueuedTasks()

      // Should NOT include active-1
      expect(tasks).to.have.length(2)
      expect(tasks.map((t) => t.taskId)).to.deep.equal(['queued-1', 'queued-2'])
    })
  })

  // ============================================================================
  // FIFO Order Tests
  // ============================================================================

  describe('FIFO order', () => {
    it('should process tasks in FIFO order within same type', async () => {
      const processedOrder: string[] = []

      const executor = sinon.stub().callsFake(async (task: TaskExecute) => {
        processedOrder.push(task.taskId)
      })

      manager.setExecutor(executor)

      manager.enqueue(createTask('first', 'curate'))
      manager.enqueue(createTask('second', 'curate'))
      manager.enqueue(createTask('third', 'curate'))

      // Wait for all to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(processedOrder).to.deep.equal(['first', 'second', 'third'])
    })

    it('should process tasks in FIFO order across different types', async () => {
      const processedOrder: string[] = []

      const executor = sinon.stub().callsFake(async (task: TaskExecute) => {
        processedOrder.push(task.taskId)
      })

      manager.setExecutor(executor)

      // Interleave curate and query tasks
      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))
      manager.enqueue(createTask('query-2', 'query'))
      manager.enqueue(createTask('curate-2', 'curate'))

      // Wait for all to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      // Should be processed in exact arrival order, regardless of type
      expect(processedOrder).to.deep.equal(['curate-1', 'query-1', 'query-2', 'curate-2'])
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle rapid enqueue/cancel cycles', () => {
      // Without executor, tasks stay in queue
      for (let i = 0; i < 100; i++) {
        manager.enqueue(createTask(`task-${i}`, i % 2 === 0 ? 'curate' : 'query'))
        if (i % 3 === 0) {
          manager.cancel(`task-${i}`)
        }
      }

      // Should not throw and should have consistent state
      const stats = manager.getStats()

      // All tasks are in queue (no executor), minus cancelled ones
      expect(stats.queued).to.be.lessThanOrEqual(100)
    })

    it('should handle empty content', () => {
      const task = createTask('task-1', 'curate', '')
      const result = manager.enqueue(task)

      expect(result.success).to.be.true
    })

    it('should handle very long taskId', () => {
      const longId = 'a'.repeat(1000)
      const task = createTask(longId, 'curate')
      const result = manager.enqueue(task)

      expect(result.success).to.be.true
      expect(manager.isKnown(longId)).to.be.true
    })
  })
})
