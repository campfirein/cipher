import {expect} from 'chai'

import {AsyncMutex} from '../../../../../../src/infra/cipher/llm/context/async-mutex.js'

// Helper functions for parallel execution tests
function createIncrementOperation(mutex: AsyncMutex, counterRef: {value: number}): Promise<void> {
  return mutex.withLock(async () => {
    const current = counterRef.value
    await delay(1) // Simulate async work
    counterRef.value = current + 1
  })
}

function createAppendOperation(mutex: AsyncMutex, values: number[]): Promise<void> {
  return mutex.withLock(async () => {
    const {length} = values
    await delay(Math.random() * 5) // Random delay
    values.push(length) // Push current length
  })
}

describe('AsyncMutex', () => {
  let mutex: AsyncMutex

  beforeEach(() => {
    mutex = new AsyncMutex()
  })

  describe('initial state', () => {
    it('should start unlocked', () => {
      expect(mutex.isLocked()).to.be.false
    })

    it('should have empty queue', () => {
      expect(mutex.getQueueLength()).to.equal(0)
    })
  })

  describe('acquire/release', () => {
    it('should acquire lock immediately when unlocked', async () => {
      await mutex.acquire()
      expect(mutex.isLocked()).to.be.true
    })

    it('should release lock correctly', async () => {
      await mutex.acquire()
      mutex.release()
      expect(mutex.isLocked()).to.be.false
    })

    it('should throw when releasing unlocked mutex', () => {
      expect(() => mutex.release()).to.throw('Cannot release a mutex that is not locked')
    })

    it('should queue waiters when locked', async () => {
      await mutex.acquire()

      // Start waiting (don't await yet)
      const waitPromise = mutex.acquire()
      expect(mutex.getQueueLength()).to.equal(1)

      // Release to let waiter through
      mutex.release()
      await waitPromise

      expect(mutex.isLocked()).to.be.true
      expect(mutex.getQueueLength()).to.equal(0)
    })

    it('should maintain FIFO order for waiters', async () => {
      const order: number[] = []

      await mutex.acquire()

      // Queue up 3 waiters
      const p1 = mutex.acquire().then(() => order.push(1))
      const p2 = mutex.acquire().then(() => order.push(2))
      const p3 = mutex.acquire().then(() => order.push(3))

      expect(mutex.getQueueLength()).to.equal(3)

      // Release and let each waiter through
      mutex.release() // Releases to waiter 1
      await p1
      expect(order).to.deep.equal([1])

      mutex.release() // Releases to waiter 2
      await p2
      expect(order).to.deep.equal([1, 2])

      mutex.release() // Releases to waiter 3
      await p3
      expect(order).to.deep.equal([1, 2, 3])

      mutex.release() // Final release
      expect(mutex.isLocked()).to.be.false
    })
  })

  describe('withLock', () => {
    it('should execute function with lock held', async () => {
      let lockHeldDuringExecution = false

      await mutex.withLock(async () => {
        lockHeldDuringExecution = mutex.isLocked()
      })

      expect(lockHeldDuringExecution).to.be.true
      expect(mutex.isLocked()).to.be.false
    })

    it('should return function result', async () => {
      const result = await mutex.withLock(async () => 'test-result')

      expect(result).to.equal('test-result')
    })

    it('should release lock on function error', async () => {
      const error = new Error('test error')

      try {
        await mutex.withLock(async () => {
          throw error
        })
        expect.fail('Should have thrown')
      } catch (error_) {
        expect(error_).to.equal(error)
      }

      expect(mutex.isLocked()).to.be.false
    })

    it('should serialize concurrent operations', async () => {
      const results: string[] = []

      // Simulate concurrent operations
      const op1 = mutex.withLock(async () => {
        results.push('op1-start')
        await delay(10)
        results.push('op1-end')
        return 'op1'
      })

      const op2 = mutex.withLock(async () => {
        results.push('op2-start')
        await delay(10)
        results.push('op2-end')
        return 'op2'
      })

      const op3 = mutex.withLock(async () => {
        results.push('op3-start')
        await delay(10)
        results.push('op3-end')
        return 'op3'
      })

      const [r1, r2, r3] = await Promise.all([op1, op2, op3])

      expect(r1).to.equal('op1')
      expect(r2).to.equal('op2')
      expect(r3).to.equal('op3')

      // Operations should be serialized (each completes before next starts)
      expect(results).to.deep.equal([
        'op1-start',
        'op1-end',
        'op2-start',
        'op2-end',
        'op3-start',
        'op3-end',
      ])
    })
  })

  describe('parallel execution protection', () => {
    it('should protect shared state from race conditions', async () => {
      const counterRef = {value: 0}
      const iterations = 100

      // Without mutex, this would have race conditions
      // With mutex, final count should be exact
      const operations = Array.from({length: iterations}, () => createIncrementOperation(mutex, counterRef))

      await Promise.all(operations)

      expect(counterRef.value).to.equal(iterations)
    })

    it('should ensure atomic read-modify-write', async () => {
      const values: number[] = []

      // Simulate concurrent append operations
      const operations = Array.from({length: 10}, () => createAppendOperation(mutex, values))

      await Promise.all(operations)

      // Each value should be unique and sequential
      expect(values.sort((a, b) => a - b)).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
  })

  describe('edge cases', () => {
    it('should handle immediate release after acquire', async () => {
      await mutex.acquire()
      mutex.release()

      // Should be able to acquire again immediately
      await mutex.acquire()
      expect(mutex.isLocked()).to.be.true
    })

    it('should handle synchronous withLock function', async () => {
      const result = await mutex.withLock(async () => 42)
      expect(result).to.equal(42)
    })

    it('should handle void return from withLock', async () => {
      let executed = false
      await mutex.withLock(async () => {
        executed = true
      })
      expect(executed).to.be.true
    })
  })
})

// Helper function
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
