/**
 * Integration tests for Queue Orphan Detection
 *
 * Tests the complete flow of detecting and handling orphaned executions
 * when consumers die unexpectedly.
 */
import type Database from 'better-sqlite3'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {AgentStorage} from '../../../../../src/infra/cipher/storage/agent-storage.js'

/**
 * Helper to sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Safely access the private db property for testing
 * Uses type guard to avoid non-null assertion
 */
function getTestDb(storage: AgentStorage): Database.Database {
  // eslint-disable-next-line dot-notation
  const db = storage['db'] as Database.Database | null
  if (!db) {
    throw new Error('Database not initialized')
  }

  return db
}

describe('Queue Orphan Detection (Integration)', () => {
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

  describe('Scenario: Consumer dies mid-execution', () => {
    it('should detect and fail orphaned executions when new consumer starts', async () => {
      const deadConsumerId = 'dead-consumer-123'
      const newConsumerId = 'new-consumer-456'
      const staleTimeoutMs = 2 // Short timeout for testing

      // Step 1: First consumer acquires lock and starts processing
      expect(storage.acquireConsumerLock(deadConsumerId)).to.be.true

      // Step 2: Create and dequeue an execution
      const execId = storage.createExecution('curate', '{"content":"important work"}')
      const dequeued = storage.dequeueBatch(1, deadConsumerId)
      expect(dequeued).to.have.lengthOf(1)
      expect(dequeued[0].status).to.equal('running')

      // Step 3: Simulate consumer death by letting heartbeat expire
      // (just wait without updating heartbeat)
      await sleep(5)

      // Step 4: New consumer starts and runs cleanup
      const orphaned = storage.cleanupStaleConsumers(staleTimeoutMs)

      // Step 5: Verify orphan was detected
      expect(orphaned).to.equal(1)

      // Step 6: Verify execution is marked as failed
      const execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('failed')
      expect(execution?.error).to.equal('Consumer died unexpectedly')

      // Step 7: Verify dead consumer's lock is removed
      expect(storage.hasConsumerLock(deadConsumerId)).to.be.false

      // Step 8: New consumer can now acquire the lock
      expect(storage.acquireConsumerLock(newConsumerId)).to.be.true
    })

    it('should handle multiple orphaned executions from same consumer', async () => {
      const deadConsumerId = 'dead-consumer'
      const staleTimeoutMs = 2

      // Acquire lock and create multiple executions
      storage.acquireConsumerLock(deadConsumerId)

      const execIds = [
        storage.createExecution('curate', '{"content":"work 1"}'),
        storage.createExecution('curate', '{"content":"work 2"}'),
        storage.createExecution('curate', '{"content":"work 3"}'),
      ]

      // Dequeue all
      storage.dequeueBatch(3, deadConsumerId)

      // Let heartbeat expire
      await sleep(5)

      // Run cleanup
      const orphaned = storage.cleanupStaleConsumers(staleTimeoutMs)

      expect(orphaned).to.equal(3)

      // All executions should be failed
      for (const execId of execIds) {
        const execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('failed')
      }
    })
  })

  describe('Scenario: Consumer crashes without proper cleanup', () => {
    it('should detect executions with non-existent consumer_id', () => {
      // Simulate scenario where consumer crashed so badly that even
      // its lock entry was lost (e.g., DB corruption recovery)

      // Create execution directly with a ghost consumer_id
      const execId = storage.createExecution('curate', '{"content":"ghost execution"}')

      // Manually set it to running with a non-existent consumer
      getTestDb(storage)
        .prepare(
          `
        UPDATE executions
        SET status = 'running',
            consumer_id = 'ghost-consumer-that-never-existed',
            started_at = ?
        WHERE id = ?
      `,
        )
        .run(Date.now(), execId)

      // Run cleanup
      const orphaned = storage.cleanupStaleConsumers(5000)

      expect(orphaned).to.equal(1)

      const execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('failed')
      expect(execution?.error).to.equal('Consumer no longer exists')
    })
  })

  describe('Scenario: Mixed state cleanup', () => {
    it('should handle mix of stale, ghost, and healthy consumers', async () => {
      const staleConsumerId = 'stale-consumer'
      const healthyConsumerId = 'healthy-consumer'
      const staleTimeoutMs = 2

      // Setup stale consumer with execution
      storage.acquireConsumerLock(staleConsumerId)
      const staleExecId = storage.createExecution('curate', '{"content":"stale work"}')
      storage.dequeueBatch(1, staleConsumerId)

      // Wait for stale consumer's heartbeat to expire
      await sleep(5)

      // Clean up stale consumer to make room for healthy one
      storage.cleanupStaleConsumers(staleTimeoutMs)

      // Setup healthy consumer
      storage.acquireConsumerLock(healthyConsumerId)
      const healthyExecId = storage.createExecution('curate', '{"content":"healthy work"}')
      storage.dequeueBatch(1, healthyConsumerId)

      // Keep healthy consumer alive
      storage.updateConsumerHeartbeat(healthyConsumerId)

      // Setup ghost execution (no lock entry)
      const ghostExecId = storage.createExecution('curate', '{"content":"ghost work"}')
      getTestDb(storage)
        .prepare(
          `
        UPDATE executions
        SET status = 'running',
            consumer_id = 'ghost-consumer',
            started_at = ?
        WHERE id = ?
      `,
        )
        .run(Date.now(), ghostExecId)

      // Run cleanup again
      const orphaned = storage.cleanupStaleConsumers(staleTimeoutMs)

      // Only ghost execution should be orphaned (stale was already cleaned)
      expect(orphaned).to.equal(1)

      // Verify states
      const staleExec = storage.getExecution(staleExecId)
      const healthyExec = storage.getExecution(healthyExecId)
      const ghostExec = storage.getExecution(ghostExecId)

      expect(staleExec?.status).to.equal('failed') // Already failed from first cleanup
      expect(healthyExec?.status).to.equal('running') // Still running
      expect(ghostExec?.status).to.equal('failed') // Failed in second cleanup
    })
  })

  describe('Scenario: Periodic cleanup simulation', () => {
    it('should correctly detect orphans over multiple cleanup cycles', async () => {
      const timeoutMs = 2

      // Cycle 1: Consumer A starts, processes, and dies
      storage.acquireConsumerLock('consumer-A')
      const execA = storage.createExecution('curate', '{"content":"A work"}')
      storage.dequeueBatch(1, 'consumer-A')
      await sleep(5)

      let orphaned = storage.cleanupStaleConsumers(timeoutMs)
      expect(orphaned).to.equal(1)

      // Cycle 2: Consumer B starts, processes, and dies
      storage.acquireConsumerLock('consumer-B')
      const execB = storage.createExecution('curate', '{"content":"B work"}')
      storage.dequeueBatch(1, 'consumer-B')
      await sleep(5)

      orphaned = storage.cleanupStaleConsumers(timeoutMs)
      expect(orphaned).to.equal(1)

      // Cycle 3: Consumer C starts, processes, and completes successfully
      storage.acquireConsumerLock('consumer-C')
      const execC = storage.createExecution('curate', '{"content":"C work"}')
      storage.dequeueBatch(1, 'consumer-C')
      storage.updateConsumerHeartbeat('consumer-C')

      // Complete the execution
      storage.updateExecutionStatus(execC, 'completed', 'success')

      orphaned = storage.cleanupStaleConsumers(timeoutMs)
      expect(orphaned).to.equal(0) // No orphans - C completed normally

      // Verify final states
      expect(storage.getExecution(execA)?.status).to.equal('failed')
      expect(storage.getExecution(execB)?.status).to.equal('failed')
      expect(storage.getExecution(execC)?.status).to.equal('completed')
    })
  })

  describe('Edge cases', () => {
    it('should not affect queued executions even if they have no consumer', () => {
      // Create queued executions (no consumer assigned yet)
      const execId1 = storage.createExecution('curate', '{"content":"queued 1"}')
      const execId2 = storage.createExecution('curate', '{"content":"queued 2"}')

      // Run cleanup
      const orphaned = storage.cleanupStaleConsumers(5000)

      expect(orphaned).to.equal(0)
      expect(storage.getExecution(execId1)?.status).to.equal('queued')
      expect(storage.getExecution(execId2)?.status).to.equal('queued')
    })

    it('should not affect already failed executions', () => {
      // Create and fail an execution
      const execId = storage.createExecution('curate', '{"content":"failed work"}')
      storage.updateExecutionStatus(execId, 'failed', undefined, 'Original error')

      // Run cleanup
      const orphaned = storage.cleanupStaleConsumers(5000)

      expect(orphaned).to.equal(0)

      const execution = storage.getExecution(execId)
      expect(execution?.status).to.equal('failed')
      expect(execution?.error).to.equal('Original error') // Error unchanged
    })

    it('should handle empty database gracefully', () => {
      const orphaned = storage.cleanupStaleConsumers(5000)

      expect(orphaned).to.equal(0)
    })

    it('should handle cleanup when only completed executions exist', () => {
      // Create and complete several executions
      for (let i = 0; i < 5; i++) {
        const execId = storage.createExecution('curate', `{"content":"work ${i}"}`)
        storage.updateExecutionStatus(execId, 'completed', `result ${i}`)
      }

      const orphaned = storage.cleanupStaleConsumers(5000)

      expect(orphaned).to.equal(0)
    })
  })
})
