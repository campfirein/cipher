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
      manager.markCompleted('task-1', 'curate')

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
      manager.markCompleted('task-1', 'curate')
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
    it('should cancel a queued curate task', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // Fill up active slot first (max 1)
      manager.enqueue(createTask('active-1', 'curate'))
      // This one goes to queue (2nd task, but only 1 can be active)
      manager.enqueue(createTask('queued-1', 'curate'))

      const result = manager.cancel('queued-1')

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.wasQueued).to.be.true
        expect(result.taskType).to.equal('curate')
      }

      expect(manager.isKnown('queued-1')).to.be.false
    })

    it('should cancel an active query task (unlimited concurrency)', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // With unlimited concurrency, all query tasks are immediately active
      manager.enqueue(createTask('active-1', 'query'))
      manager.enqueue(createTask('active-2', 'query'))
      manager.enqueue(createTask('active-3', 'query'))

      // All should be active (not queued)
      const stats = manager.getStats('query')
      expect(stats.active).to.equal(3)
      expect(stats.queued).to.equal(0)

      // Cancel an active task
      const result = manager.cancel('active-3')

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

      manager.enqueue(createTask('active-1', 'curate'))
      manager.enqueue(createTask('task-1', 'curate')) // Goes to queue (max 1 active)

      manager.cancel('task-1')
      const result = manager.enqueue(createTask('task-1', 'curate'))

      expect(result.success).to.be.true
    })
  })

  // ============================================================================
  // Concurrency Tests
  // ============================================================================

  describe('concurrency', () => {
    it('should respect maxConcurrent for curate tasks', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'curate'))

      const stats = manager.getStats('curate')

      expect(stats.active).to.equal(1) // Max concurrent = 1
      expect(stats.queued).to.equal(2) // 2 waiting
    })

    it('should allow unlimited query tasks (Infinity maxConcurrent)', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'query'))
      manager.enqueue(createTask('task-2', 'query'))
      manager.enqueue(createTask('task-3', 'query'))
      manager.enqueue(createTask('task-4', 'query'))

      const stats = manager.getStats('query')

      // Query tasks have unlimited concurrency - all should be active
      expect(stats.active).to.equal(4)
      expect(stats.queued).to.equal(0)
    })

    it('should allow custom concurrency config', () => {
      const customManager = new TaskQueueManager({
        curate: {maxConcurrent: 5},
        query: {maxConcurrent: 3},
      })
      const {executor} = createBlockingExecutor()
      customManager.setExecutor(executor)

      for (let i = 0; i < 10; i++) {
        customManager.enqueue(createTask(`curate-${i}`, 'curate'))
      }

      const stats = customManager.getStats('curate')
      expect(stats.active).to.equal(5)
      expect(stats.queued).to.equal(5)
    })

    it('should process next task when slot becomes available', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'curate'))

      let stats = manager.getStats('curate')
      expect(stats.active).to.equal(1)
      expect(stats.queued).to.equal(2)

      // Complete one task
      manager.markCompleted('task-1', 'curate')

      stats = manager.getStats('curate')
      expect(stats.active).to.equal(1) // task-2 should now be active
      expect(stats.queued).to.equal(1)
    })

    it('should maintain separate concurrency for each task type', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      // Enqueue 3 curate and 3 query
      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('curate-2', 'curate'))
      manager.enqueue(createTask('curate-3', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))
      manager.enqueue(createTask('query-2', 'query'))
      manager.enqueue(createTask('query-3', 'query'))

      const curateStats = manager.getStats('curate')
      const queryStats = manager.getStats('query')

      // Curate: maxConcurrent=1, so 2 queued
      expect(curateStats.active).to.equal(1)
      expect(curateStats.queued).to.equal(2)
      // Query: unlimited concurrency, all active
      expect(queryStats.active).to.equal(3)
      expect(queryStats.queued).to.equal(0)
    })

    it('should keep tasks in queue without executor', () => {
      // No executor set
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))

      const stats = manager.getStats('curate')
      expect(stats.active).to.equal(0) // Nothing active
      expect(stats.queued).to.equal(2) // Both in queue
    })

    it('should start processing when executor is set', () => {
      // Enqueue first
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))

      let stats = manager.getStats('curate')
      expect(stats.queued).to.equal(2)
      expect(stats.active).to.equal(0)

      // Set executor
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      stats = manager.getStats('curate')
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

    it('should process queued tasks after active task completes', async () => {
      let resolveFirst: () => void
      const firstTaskPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })

      const executor = sinon.stub()
      executor.onFirstCall().returns(firstTaskPromise)
      executor.onSecondCall().resolves()
      executor.onThirdCall().resolves()

      manager.setExecutor(executor)

      // Enqueue 3 tasks (2 will be active, 1 queued)
      manager.enqueue(createTask('task-1', 'curate'))
      manager.enqueue(createTask('task-2', 'curate'))
      manager.enqueue(createTask('task-3', 'curate'))

      // Initially only 1 should be called (maxConcurrent=1)
      expect(executor.callCount).to.equal(1)

      // Complete first task
      resolveFirst!()
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // Now third should be called
      expect(executor.callCount).to.equal(3)
    })
  })

  // ============================================================================
  // Stats Tests
  // ============================================================================

  describe('getStats', () => {
    it('should return correct stats for empty curate queue', () => {
      const stats = manager.getStats('curate')

      expect(stats.active).to.equal(0)
      expect(stats.queued).to.equal(0)
      expect(stats.maxConcurrent).to.equal(1)
    })

    it('should return Infinity maxConcurrent for query', () => {
      const stats = manager.getStats('query')

      expect(stats.active).to.equal(0)
      expect(stats.queued).to.equal(0)
      expect(stats.maxConcurrent).to.equal(Infinity)
    })

    it('should return all stats with executor', () => {
      const {executor} = createBlockingExecutor()
      manager.setExecutor(executor)

      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))

      const allStats = manager.getAllStats()

      expect(allStats.curate.active).to.equal(1)
      expect(allStats.query.active).to.equal(1)
    })

    it('should return all stats without executor (queued only)', () => {
      manager.enqueue(createTask('curate-1', 'curate'))
      manager.enqueue(createTask('query-1', 'query'))

      const allStats = manager.getAllStats()

      expect(allStats.curate.queued).to.equal(1)
      expect(allStats.curate.active).to.equal(0)
      expect(allStats.query.queued).to.equal(1)
      expect(allStats.query.active).to.equal(0)
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

      const curateStats = manager.getStats('curate')
      const queryStats = manager.getStats('query')

      expect(curateStats.active).to.equal(0)
      expect(curateStats.queued).to.equal(0)
      expect(queryStats.active).to.equal(0)
      expect(queryStats.queued).to.equal(0)
      expect(manager.isKnown('task-1')).to.be.false
    })
  })

  // ============================================================================
  // FIFO Order Tests
  // ============================================================================

  describe('FIFO order', () => {
    it('should process tasks in FIFO order', async () => {
      const processedOrder: string[] = []

      const executor = sinon.stub().callsFake(async (task: TaskExecute) => {
        processedOrder.push(task.taskId)
      })

      // Use manager with maxConcurrent=1 to ensure strict ordering
      const fifoManager = new TaskQueueManager({
        curate: {maxConcurrent: 1},
        query: {maxConcurrent: 1},
      })
      fifoManager.setExecutor(executor)

      fifoManager.enqueue(createTask('first', 'curate'))
      fifoManager.enqueue(createTask('second', 'curate'))
      fifoManager.enqueue(createTask('third', 'curate'))

      // Wait for all to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(processedOrder).to.deep.equal(['first', 'second', 'third'])
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
      const curateStats = manager.getStats('curate')
      const queryStats = manager.getStats('query')

      // All tasks are in queue (no executor), minus cancelled ones
      expect(curateStats.queued).to.be.lessThanOrEqual(50)
      expect(queryStats.queued).to.be.lessThanOrEqual(50)
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
