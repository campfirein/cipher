import type Database from 'better-sqlite3'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {AgentStorage} from '../../../../../src/infra/cipher/storage/agent-storage.js'

// Helper to get consumer_id from execution (not exposed in public type)
// NOTE: SQL NULL maps to JavaScript null (not undefined) - this is expected for DB interfaces
interface ExecutionRowWithConsumer {
  consumer_id: null | string
  id: string
  status: string
}

// Helper to sleep for specified milliseconds
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

describe('AgentStorage', () => {
  let storage: AgentStorage

  /**
   * Helper to query consumer_id directly from DB
   * NOTE: Returns null for SQL NULL (database interface, not domain code)
   */
  function getExecutionConsumerId(execId: string): null | string {
    const row = getTestDb(storage).prepare('SELECT consumer_id FROM executions WHERE id = ?').get(execId) as
      | ExecutionRowWithConsumer
      | undefined
    return row?.consumer_id ?? null
  }

  beforeEach(async () => {
    // Suppress console output during tests
    stub(console, 'log')
    stub(console, 'error')

    // Use in-memory mode for fast tests
    storage = new AgentStorage({inMemory: true})
    await storage.initialize()
  })

  afterEach(() => {
    restore()
    storage.close()
  })

  describe('Consumer Lock Management', () => {
    describe('acquireConsumerLock', () => {
      it('should acquire lock when no other consumer exists', () => {
        const consumerId = 'consumer-1'

        const acquired = storage.acquireConsumerLock(consumerId)

        expect(acquired).to.be.true
        expect(storage.hasConsumerLock(consumerId)).to.be.true
      })

      it('should reject lock when another active consumer exists', () => {
        const consumer1 = 'consumer-1'
        const consumer2 = 'consumer-2'

        storage.acquireConsumerLock(consumer1)
        const acquired = storage.acquireConsumerLock(consumer2)

        expect(acquired).to.be.false
        expect(storage.hasConsumerLock(consumer1)).to.be.true
        expect(storage.hasConsumerLock(consumer2)).to.be.false
      })

      it('should reject re-acquire when consumer already has lock (use hasConsumerLock to check)', () => {
        const consumerId = 'consumer-1'

        storage.acquireConsumerLock(consumerId)
        // Second acquire fails because an active consumer already exists
        const acquired = storage.acquireConsumerLock(consumerId)

        // This is expected - don't need to re-acquire a lock you already have
        expect(acquired).to.be.false
        // But the original lock is still valid
        expect(storage.hasConsumerLock(consumerId)).to.be.true
      })
    })

    describe('releaseConsumerLock', () => {
      it('should release an acquired lock', () => {
        const consumerId = 'consumer-1'

        storage.acquireConsumerLock(consumerId)
        storage.releaseConsumerLock(consumerId)

        expect(storage.hasConsumerLock(consumerId)).to.be.false
      })

      it('should allow another consumer to acquire after release', () => {
        const consumer1 = 'consumer-1'
        const consumer2 = 'consumer-2'

        storage.acquireConsumerLock(consumer1)
        storage.releaseConsumerLock(consumer1)
        const acquired = storage.acquireConsumerLock(consumer2)

        expect(acquired).to.be.true
        expect(storage.hasConsumerLock(consumer2)).to.be.true
      })

      it('should clear consumer_id from running executions when released', () => {
        const consumerId = 'consumer-1'

        // Setup: acquire lock and create execution
        storage.acquireConsumerLock(consumerId)
        const execId = storage.createExecution('curate', '{"content":"test"}')
        storage.dequeueBatch(1, consumerId) // This sets consumer_id on the execution

        // Verify execution has consumer_id
        expect(getExecutionConsumerId(execId)).to.equal(consumerId)

        // Release lock
        storage.releaseConsumerLock(consumerId)

        // Verify consumer_id is cleared (SQL NULL → JS null)
        expect(getExecutionConsumerId(execId)).to.be.null
      })
    })

    describe('hasConsumerLock', () => {
      it('should return true for active consumer', () => {
        const consumerId = 'consumer-1'

        storage.acquireConsumerLock(consumerId)

        expect(storage.hasConsumerLock(consumerId)).to.be.true
      })

      it('should return false for non-existent consumer', () => {
        expect(storage.hasConsumerLock('non-existent')).to.be.false
      })

      it('should return false for different consumer', () => {
        storage.acquireConsumerLock('consumer-1')

        expect(storage.hasConsumerLock('consumer-2')).to.be.false
      })
    })

    describe('updateConsumerHeartbeat', () => {
      it('should update heartbeat timestamp', async () => {
        const consumerId = 'consumer-1'

        storage.acquireConsumerLock(consumerId)

        // Wait a bit then update heartbeat
        await sleep(10)
        storage.updateConsumerHeartbeat(consumerId)

        // Consumer should still be active
        expect(storage.hasConsumerLock(consumerId)).to.be.true
      })
    })
  })

  describe('Orphan Detection (cleanupStaleConsumers)', () => {
    describe('Case 1: Stale heartbeat detection', () => {
      it('should mark executions as failed when consumer heartbeat is stale', async () => {
        const consumerId = 'stale-consumer'
        const timeoutMs = 2 // 50ms timeout for test

        // Acquire lock and create execution
        storage.acquireConsumerLock(consumerId)
        const execId = storage.createExecution('curate', '{"content":"test"}')
        storage.dequeueBatch(1, consumerId)

        // Wait for heartbeat to become stale
        await sleep(5)

        // Run cleanup
        const orphaned = storage.cleanupStaleConsumers(timeoutMs)

        expect(orphaned).to.equal(1)

        // Verify execution is failed
        const execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('failed')
        expect(execution?.error).to.equal('Consumer died unexpectedly')
        expect(getExecutionConsumerId(execId)).to.be.null
      })

      it('should delete stale consumer lock after cleanup', async () => {
        const consumerId = 'stale-consumer'
        const timeoutMs = 2

        storage.acquireConsumerLock(consumerId)

        await sleep(5)

        storage.cleanupStaleConsumers(timeoutMs)

        // Consumer lock should be removed
        expect(storage.hasConsumerLock(consumerId)).to.be.false
      })

      it('should NOT affect consumers with fresh heartbeat', async () => {
        const consumerId = 'healthy-consumer'
        const timeoutMs = 200 // 5 second timeout

        storage.acquireConsumerLock(consumerId)
        const execId = storage.createExecution('curate', '{"content":"test"}')
        storage.dequeueBatch(1, consumerId)

        // Update heartbeat to keep it fresh
        storage.updateConsumerHeartbeat(consumerId)

        // Run cleanup
        const orphaned = storage.cleanupStaleConsumers(timeoutMs)

        expect(orphaned).to.equal(0)

        // Execution should still be running
        const execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('running')
        expect(getExecutionConsumerId(execId)).to.equal(consumerId)
      })
    })

    describe('Case 2: Missing consumer detection', () => {
      it('should mark executions as failed when consumer_id does not exist in consumer_locks', () => {
        // Manually insert an execution with a consumer_id that doesn't exist
        const execId = storage.createExecution('curate', '{"content":"orphan test"}')

        // Directly update the execution to have a non-existent consumer_id and running status
        // This simulates a consumer that crashed without proper cleanup
        getTestDb(storage).prepare(`
          UPDATE executions
          SET status = 'running',
              consumer_id = 'ghost-consumer',
              started_at = ?
          WHERE id = ?
        `).run(Date.now(), execId)

        // Verify setup
        let execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('running')
        expect(getExecutionConsumerId(execId)).to.equal('ghost-consumer')

        // Run cleanup
        const orphaned = storage.cleanupStaleConsumers(5000)

        expect(orphaned).to.equal(1)

        // Verify execution is failed
        execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('failed')
        expect(execution?.error).to.equal('Consumer no longer exists')
      })

      it('should handle both stale and missing consumers in single cleanup', async () => {
        const staleConsumerId = 'stale-consumer'
        const timeoutMs = 2

        // Case 1: Stale consumer with execution
        storage.acquireConsumerLock(staleConsumerId)
        const execId1 = storage.createExecution('curate', '{"content":"stale test"}')
        storage.dequeueBatch(1, staleConsumerId)

        // Case 2: Ghost consumer (no lock entry)
        const execId2 = storage.createExecution('curate', '{"content":"ghost test"}')
        getTestDb(storage).prepare(`
          UPDATE executions
          SET status = 'running',
              consumer_id = 'ghost-consumer',
              started_at = ?
          WHERE id = ?
        `).run(Date.now(), execId2)

        // Wait for stale consumer's heartbeat to expire
        await sleep(5)

        // Run cleanup
        const orphaned = storage.cleanupStaleConsumers(timeoutMs)

        expect(orphaned).to.equal(2)

        // Both executions should be failed
        const exec1 = storage.getExecution(execId1)
        const exec2 = storage.getExecution(execId2)

        expect(exec1?.status).to.equal('failed')
        expect(exec2?.status).to.equal('failed')
      })
    })

    describe('Edge cases', () => {
      it('should return 0 when no orphaned executions exist', () => {
        const orphaned = storage.cleanupStaleConsumers(5000)

        expect(orphaned).to.equal(0)
      })

      it('should NOT affect completed executions', async () => {
        const consumerId = 'test-consumer'
        const timeoutMs = 2

        storage.acquireConsumerLock(consumerId)
        const execId = storage.createExecution('curate', '{"content":"test"}')
        storage.dequeueBatch(1, consumerId)

        // Complete the execution
        storage.updateExecutionStatus(execId, 'completed', 'success result')

        // Wait for heartbeat to become stale
        await sleep(5)

        // Run cleanup
        const orphaned = storage.cleanupStaleConsumers(timeoutMs)

        // Should only delete the lock, not affect completed execution
        const execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('completed')
        expect(orphaned).to.equal(0) // No running executions were orphaned
      })

      it('should NOT affect queued executions (only running)', () => {
        // Create queued execution
        const execId = storage.createExecution('curate', '{"content":"queued test"}')

        // Verify it's queued
        let execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('queued')

        // Run cleanup
        const orphaned = storage.cleanupStaleConsumers(5000)

        expect(orphaned).to.equal(0)

        // Execution should still be queued
        execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('queued')
      })
    })
  })

  describe('Execution Queue Operations', () => {
    describe('createExecution', () => {
      it('should create execution with queued status', () => {
        const execId = storage.createExecution('curate', '{"content":"test"}')

        const execution = storage.getExecution(execId)
        expect(execution).to.exist
        if (!execution) throw new Error('Execution should exist')
        expect(execution.status).to.equal('queued')
        expect(execution.type).to.equal('curate')
        expect(getExecutionConsumerId(execId)).to.be.null
      })
    })

    describe('dequeueBatch', () => {
      it('should dequeue and assign consumer_id to executions', () => {
        const consumerId = 'consumer-1'
        storage.acquireConsumerLock(consumerId)

        storage.createExecution('curate', '{"content":"test1"}')
        storage.createExecution('curate', '{"content":"test2"}')

        const dequeued = storage.dequeueBatch(2, consumerId)

        expect(dequeued).to.have.lengthOf(2)
        expect(dequeued[0].status).to.equal('running')
        expect(getExecutionConsumerId(dequeued[0].id)).to.equal(consumerId)
        expect(dequeued[1].status).to.equal('running')
        expect(getExecutionConsumerId(dequeued[1].id)).to.equal(consumerId)
      })

      it('should respect batch limit', () => {
        const consumerId = 'consumer-1'
        storage.acquireConsumerLock(consumerId)

        storage.createExecution('curate', '{"content":"test1"}')
        storage.createExecution('curate', '{"content":"test2"}')
        storage.createExecution('curate', '{"content":"test3"}')

        const dequeued = storage.dequeueBatch(2, consumerId)

        expect(dequeued).to.have.lengthOf(2)

        // One should still be queued
        const queued = storage.getQueuedExecutions()
        expect(queued).to.have.lengthOf(1)
      })

      it('should dequeue in FIFO order (oldest first)', async () => {
        const consumerId = 'consumer-1'
        storage.acquireConsumerLock(consumerId)

        const execId1 = storage.createExecution('curate', '{"content":"first"}')
        await sleep(10)
        storage.createExecution('curate', '{"content":"second"}') // Create second to test FIFO

        const dequeued = storage.dequeueBatch(1, consumerId)

        expect(dequeued).to.have.lengthOf(1)
        expect(dequeued[0].id).to.equal(execId1) // First created should be dequeued first
      })
    })

    describe('updateExecutionStatus', () => {
      it('should update execution to completed', () => {
        const execId = storage.createExecution('curate', '{"content":"test"}')

        storage.updateExecutionStatus(execId, 'completed', 'success result')

        const execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('completed')
        expect(execution?.result).to.equal('success result')
        expect(execution?.completedAt).to.be.a('number')
      })

      it('should update execution to failed with error', () => {
        const execId = storage.createExecution('curate', '{"content":"test"}')

        storage.updateExecutionStatus(execId, 'failed', undefined, 'Something went wrong')

        const execution = storage.getExecution(execId)
        expect(execution?.status).to.equal('failed')
        expect(execution?.error).to.equal('Something went wrong')
        expect(execution?.completedAt).to.be.a('number')
      })
    })

    describe('getQueuedExecutions', () => {
      it('should return only queued executions', () => {
        const consumerId = 'consumer-1'
        storage.acquireConsumerLock(consumerId)

        storage.createExecution('curate', '{"content":"test1"}')
        storage.createExecution('curate', '{"content":"test2"}')
        const execId3 = storage.createExecution('curate', '{"content":"test3"}')

        // Dequeue first two
        storage.dequeueBatch(2, consumerId)

        const queued = storage.getQueuedExecutions()

        expect(queued).to.have.lengthOf(1)
        expect(queued[0].id).to.equal(execId3)
      })
    })

    describe('getRunningExecutions', () => {
      it('should return only running executions', () => {
        const consumerId = 'consumer-1'
        storage.acquireConsumerLock(consumerId)

        const execId1 = storage.createExecution('curate', '{"content":"test1"}')
        storage.createExecution('curate', '{"content":"test2"}')

        // Dequeue first one
        storage.dequeueBatch(1, consumerId)

        const running = storage.getRunningExecutions()

        expect(running).to.have.lengthOf(1)
        expect(running[0].id).to.equal(execId1)
        expect(running[0].status).to.equal('running')
      })
    })
  })

  describe('cleanupOldExecutions', () => {
    it('should keep only the specified number of recent completed executions', () => {
      // Create and complete 5 executions
      for (let i = 0; i < 5; i++) {
        const execId = storage.createExecution('curate', `{"content":"test${i}"}`)
        storage.updateExecutionStatus(execId, 'completed', `result${i}`)
      }

      // Cleanup, keeping only 2
      const cleaned = storage.cleanupOldExecutions(2)

      expect(cleaned).to.equal(3) // 5 - 2 = 3 deleted

      // Verify only 2 remain
      const remaining = getTestDb(storage).prepare('SELECT COUNT(*) as count FROM executions').get() as {count: number}
      expect(remaining.count).to.equal(2)
    })

    it('should NOT delete running or queued executions', () => {
      const consumerId = 'consumer-1'
      storage.acquireConsumerLock(consumerId)

      // Create completed executions
      for (let i = 0; i < 3; i++) {
        const execId = storage.createExecution('curate', `{"content":"completed${i}"}`)
        storage.updateExecutionStatus(execId, 'completed', `result${i}`)
      }

      // Create running execution
      storage.createExecution('curate', '{"content":"running"}')
      storage.dequeueBatch(1, consumerId)

      // Create queued execution
      storage.createExecution('curate', '{"content":"queued"}')

      // Cleanup, keeping 0 completed
      storage.cleanupOldExecutions(0)

      // Running and queued should still exist
      const running = storage.getRunningExecutions()
      const queued = storage.getQueuedExecutions()

      expect(running).to.have.lengthOf(1)
      expect(queued).to.have.lengthOf(1)
    })
  })
})
