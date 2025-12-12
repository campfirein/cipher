/**
 * Integration tests for Queue + Consumer Flow
 *
 * Tests the complete flow from enqueueing jobs to processing them.
 * Uses in-memory storage for fast, isolated tests.
 */
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {AgentStorage} from '../../../../../src/infra/cipher/storage/agent-storage.js'

// Helper to sleep for specified milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('Queue + Consumer Flow (Integration)', () => {
  let storage: AgentStorage

  beforeEach(async () => {
    stub(console, 'log')
    stub(console, 'error')

    storage = new AgentStorage({inMemory: true})
    await storage.initialize()
  })

  afterEach(() => {
    restore()
    storage.close()
  })

  describe('Basic Queue Operations', () => {
    it('should enqueue multiple jobs atomically', () => {
      // Enqueue 100 jobs
      const count = 100
      const execIds: string[] = []

      for (let i = 0; i < count; i++) {
        const execId = storage.createExecution('curate', JSON.stringify({content: `test ${i}`}))
        execIds.push(execId)
      }

      // Verify all are queued
      const queued = storage.getQueuedExecutions()
      expect(queued).to.have.lengthOf(count)
    })

    it('should maintain FIFO order in queue', async () => {
      const consumerId = 'test-consumer'
      storage.acquireConsumerLock(consumerId)

      // Create executions with slight delays to ensure ordering
      const execId1 = storage.createExecution('curate', JSON.stringify({content: 'first'}))
      await sleep(5)
      const execId2 = storage.createExecution('curate', JSON.stringify({content: 'second'}))
      await sleep(5)
      const execId3 = storage.createExecution('curate', JSON.stringify({content: 'third'}))

      // Dequeue one at a time and verify order
      let batch = storage.dequeueBatch(1, consumerId)
      expect(batch[0].id).to.equal(execId1)

      storage.updateExecutionStatus(execId1, 'completed', 'done')

      batch = storage.dequeueBatch(1, consumerId)
      expect(batch[0].id).to.equal(execId2)

      storage.updateExecutionStatus(execId2, 'completed', 'done')

      batch = storage.dequeueBatch(1, consumerId)
      expect(batch[0].id).to.equal(execId3)
    })
  })

  describe('Concurrent Consumer Simulation', () => {
    it('should handle batch dequeue correctly', () => {
      const consumerId = 'consumer-1'
      storage.acquireConsumerLock(consumerId)

      // Enqueue 50 jobs
      for (let i = 0; i < 50; i++) {
        storage.createExecution('curate', JSON.stringify({content: `job ${i}`}))
      }

      // Dequeue in batches of 10
      const batch1 = storage.dequeueBatch(10, consumerId)
      expect(batch1).to.have.lengthOf(10)
      expect(batch1.every((e) => e.status === 'running')).to.be.true

      const batch2 = storage.dequeueBatch(10, consumerId)
      expect(batch2).to.have.lengthOf(10)

      // No overlap between batches
      const batch1Ids = new Set(batch1.map((e) => e.id))
      const batch2Ids = new Set(batch2.map((e) => e.id))
      for (const id of batch2Ids) {
        expect(batch1Ids.has(id)).to.be.false
      }

      // 30 should still be queued
      const queued = storage.getQueuedExecutions()
      expect(queued).to.have.lengthOf(30)
    })

    it('should prevent multiple consumers from running', () => {
      const consumer1 = 'consumer-1'
      const consumer2 = 'consumer-2'

      expect(storage.acquireConsumerLock(consumer1)).to.be.true
      expect(storage.acquireConsumerLock(consumer2)).to.be.false

      // After release, consumer2 can acquire
      storage.releaseConsumerLock(consumer1)
      expect(storage.acquireConsumerLock(consumer2)).to.be.true
    })
  })

  describe('Consumer Heartbeat', () => {
    it('should keep consumer alive with heartbeat updates', async () => {
      const consumerId = 'heartbeat-test'
      const timeoutMs = 20

      storage.acquireConsumerLock(consumerId)
      storage.createExecution('curate', JSON.stringify({content: 'test'}))
      storage.dequeueBatch(1, consumerId)

      // Simulate heartbeat updates - short delays to keep consumer alive
      await sleep(3)
      storage.updateConsumerHeartbeat(consumerId)
      await sleep(3)
      storage.updateConsumerHeartbeat(consumerId)
      await sleep(3)
      storage.updateConsumerHeartbeat(consumerId)

      // Consumer should still be considered alive (total time ~9ms < 20ms timeout)
      const orphaned = storage.cleanupStaleConsumers(timeoutMs)
      expect(orphaned).to.equal(0)
      expect(storage.hasConsumerLock(consumerId)).to.be.true
    })

    it('should detect dead consumer without heartbeat', async () => {
      const consumerId = 'dead-consumer'
      const timeoutMs = 10

      storage.acquireConsumerLock(consumerId)
      const execId = storage.createExecution('curate', JSON.stringify({content: 'test'}))
      storage.dequeueBatch(1, consumerId)

      // Don't update heartbeat - let it expire
      await sleep(20)

      // Consumer should be detected as dead
      const orphaned = storage.cleanupStaleConsumers(timeoutMs)
      expect(orphaned).to.equal(1)
      expect(storage.hasConsumerLock(consumerId)).to.be.false

      // Execution should be failed
      const execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('failed')
    })
  })

  describe('Execution Lifecycle', () => {
    it('should track complete execution lifecycle', () => {
      const consumerId = 'lifecycle-test'
      storage.acquireConsumerLock(consumerId)

      // 1. Create (queued)
      const execId = storage.createExecution('curate', JSON.stringify({content: 'lifecycle test'}))
      let execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('queued')
      expect(execution?.startedAt).to.be.undefined

      // 2. Dequeue (running)
      storage.dequeueBatch(1, consumerId)
      execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('running')
      expect(execution?.startedAt).to.be.a('number')

      // 3. Complete
      storage.updateExecutionStatus(execId, 'completed', 'success result')
      execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('completed')
      expect(execution?.result).to.equal('success result')
      expect(execution?.completedAt).to.be.a('number')
    })

    it('should handle failed executions', () => {
      const consumerId = 'failure-test'
      storage.acquireConsumerLock(consumerId)

      const execId = storage.createExecution('curate', JSON.stringify({content: 'will fail'}))
      storage.dequeueBatch(1, consumerId)

      storage.updateExecutionStatus(execId, 'failed', undefined, 'Something went wrong')

      const execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('failed')
      expect(execution?.error).to.equal('Something went wrong')
      expect(execution?.result).to.be.undefined
    })
  })

  describe('Tool Call Tracking', () => {
    it('should add and update tool calls for execution', () => {
      const consumerId = 'toolcall-test'
      storage.acquireConsumerLock(consumerId)

      const execId = storage.createExecution('curate', JSON.stringify({content: 'toolcall test'}))
      storage.dequeueBatch(1, consumerId)

      // Add tool call
      /* eslint-disable camelcase */
      const toolCallId = storage.addToolCall(execId, {
        args: {file_path: '/test/file.ts'},
        filePath: '/test/file.ts',
        name: 'Read',
      })
      /* eslint-enable camelcase */

      expect(toolCallId).to.be.a('string')

      // Get tool calls
      const toolCalls = storage.getToolCalls(execId)
      expect(toolCalls).to.have.lengthOf(1)
      expect(toolCalls[0].name).to.equal('Read')
      expect(toolCalls[0].status).to.equal('running')

      // Update tool call
      storage.updateToolCall(toolCallId, 'completed', {
        charsCount: 2000,
        linesCount: 100,
        result: 'file content here',
        resultSummary: '100 lines',
      })

      const updatedToolCalls = storage.getToolCalls(execId)
      expect(updatedToolCalls[0].status).to.equal('completed')
      expect(updatedToolCalls[0].result).to.equal('file content here')
    })

    it('should track multiple tool calls per execution', () => {
      const consumerId = 'multi-toolcall-test'
      storage.acquireConsumerLock(consumerId)

      const execId = storage.createExecution('curate', JSON.stringify({content: 'multi toolcall'}))
      storage.dequeueBatch(1, consumerId)

      // Add multiple tool calls
      /* eslint-disable camelcase */
      storage.addToolCall(execId, {args: {file_path: '/file1.ts'}, name: 'Read'})
      storage.addToolCall(execId, {args: {pattern: '**/*.ts'}, name: 'Glob'})
      storage.addToolCall(execId, {args: {file_path: '/file2.ts'}, name: 'Edit'})
      /* eslint-enable camelcase */

      const toolCalls = storage.getToolCalls(execId)
      expect(toolCalls).to.have.lengthOf(3)
    })
  })

  describe('Cleanup Operations', () => {
    it('should clean up old completed executions', () => {
      const consumerId = 'cleanup-test'
      storage.acquireConsumerLock(consumerId)

      // Create and complete many executions
      for (let i = 0; i < 20; i++) {
        const execId = storage.createExecution('curate', JSON.stringify({content: `cleanup ${i}`}))
        storage.updateExecutionStatus(execId, 'completed', `result ${i}`)
      }

      // Clean up, keeping only 5
      const cleaned = storage.cleanupOldExecutions(5)

      expect(cleaned).to.equal(15)
    })

    it('should preserve running and queued executions during cleanup', () => {
      const consumerId = 'preserve-test'
      storage.acquireConsumerLock(consumerId)

      // Create completed executions
      for (let i = 0; i < 10; i++) {
        const execId = storage.createExecution('curate', JSON.stringify({content: `completed ${i}`}))
        storage.updateExecutionStatus(execId, 'completed', `result ${i}`)
      }

      // Create and start running execution FIRST
      const runningId = storage.createExecution('curate', JSON.stringify({content: 'running'}))
      storage.dequeueBatch(1, consumerId) // This dequeues runningId

      // Then create queued execution
      const queuedId = storage.createExecution('curate', JSON.stringify({content: 'queued'}))

      // Clean up all completed
      storage.cleanupOldExecutions(0)

      // Running and queued should still exist
      expect(storage.getExecution(runningId)?.status).to.equal('running')
      expect(storage.getExecution(queuedId)?.status).to.equal('queued')
    })
  })

  describe('High Volume Stress Test', () => {
    it('should handle 1000 enqueue operations', () => {
      const count = 1000
      const startTime = Date.now()

      for (let i = 0; i < count; i++) {
        storage.createExecution('curate', JSON.stringify({content: `stress test ${i}`}))
      }

      const elapsed = Date.now() - startTime
      // Note: getQueuedExecutions() has LIMIT 100, so we verify:
      // 1. At least 100 items queued (max returned by method)
      // 2. All 1000 inserts completed without error
      // 3. Completed in reasonable time
      const queued = storage.getQueuedExecutions()

      expect(queued).to.have.lengthOf(100) // LIMIT 100 in SQL
      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).to.be.lessThan(5000)
    })

    it('should handle rapid dequeue/complete cycles', () => {
      const consumerId = 'rapid-test'
      storage.acquireConsumerLock(consumerId)

      // Enqueue 100 jobs
      for (let i = 0; i < 100; i++) {
        storage.createExecution('curate', JSON.stringify({content: `rapid ${i}`}))
      }

      const startTime = Date.now()

      // Rapidly dequeue and complete
      for (let i = 0; i < 10; i++) {
        const batch = storage.dequeueBatch(10, consumerId)
        for (const exec of batch) {
          storage.updateExecutionStatus(exec.id, 'completed', 'done')
        }
      }

      const elapsed = Date.now() - startTime

      // All should be completed
      const queued = storage.getQueuedExecutions()
      const running = storage.getRunningExecutions()

      expect(queued).to.have.lengthOf(0)
      expect(running).to.have.lengthOf(0)
      expect(elapsed).to.be.lessThan(2000)
    })
  })

  describe('Error Recovery', () => {
    it('should recover queue state after consumer failure', async () => {
      const consumerId1 = 'failed-consumer'
      const consumerId2 = 'recovery-consumer'
      const timeoutMs = 10

      // Consumer 1 starts processing
      storage.acquireConsumerLock(consumerId1)

      const execIds = [
        storage.createExecution('curate', JSON.stringify({content: 'job 1'})),
        storage.createExecution('curate', JSON.stringify({content: 'job 2'})),
        storage.createExecution('curate', JSON.stringify({content: 'job 3'})),
      ]

      storage.dequeueBatch(3, consumerId1)

      // Consumer 1 dies (heartbeat expires)
      await sleep(20)

      // Consumer 2 starts and cleans up
      const orphaned = storage.cleanupStaleConsumers(timeoutMs)
      expect(orphaned).to.equal(3)

      // Consumer 2 can now acquire lock
      expect(storage.acquireConsumerLock(consumerId2)).to.be.true

      // All executions should be failed
      for (const execId of execIds) {
        expect(storage.getExecution(execId)?.status).to.equal('failed')
      }

      // New jobs can be processed
      const newExecId = storage.createExecution('curate', JSON.stringify({content: 'new job'}))
      const batch = storage.dequeueBatch(1, consumerId2)

      expect(batch).to.have.lengthOf(1)
      expect(batch[0].id).to.equal(newExecId)
    })
  })
})
