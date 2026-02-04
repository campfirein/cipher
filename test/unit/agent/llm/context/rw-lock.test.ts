import {expect} from 'chai'

import {lockKeyFromStorageKey, RWLock} from '../../../../../src/agent/infra/llm/context/rw-lock.js'

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('RWLock', () => {
  describe('read locks', () => {
    it('should acquire read lock immediately when unlocked', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using _lock = await RWLock.read('test-target-1')
      expect(RWLock.getStats().activeLocks).to.be.greaterThan(0)
    })

    it('should allow multiple concurrent readers', async () => {
      const results: string[] = []

      const reader1 = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.read('concurrent-read-target')
        results.push('r1-start')
        await delay(10)
        results.push('r1-end')
      })()

      const reader2 = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.read('concurrent-read-target')
        results.push('r2-start')
        await delay(10)
        results.push('r2-end')
      })()

      await Promise.all([reader1, reader2])

      // Both readers should start before either ends (concurrent)
      const r1StartIdx = results.indexOf('r1-start')
      const r2StartIdx = results.indexOf('r2-start')
      const r1EndIdx = results.indexOf('r1-end')
      const r2EndIdx = results.indexOf('r2-end')

      expect(r1StartIdx).to.be.lessThan(r1EndIdx)
      expect(r2StartIdx).to.be.lessThan(r2EndIdx)
      // Both should start before both end (concurrent execution)
      expect(Math.max(r1StartIdx, r2StartIdx)).to.be.lessThan(Math.min(r1EndIdx, r2EndIdx))
    })

    it('should release read lock via Symbol.dispose', async () => {
      const target = 'dispose-read-target'

      {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.read(target)
        expect(RWLock.getStats().targets).to.include(target)
      }

      // After block exits, lock should be released and cleaned up
      await delay(1)
      expect(RWLock.getStats().targets).to.not.include(target)
    })
  })

  describe('write locks', () => {
    it('should acquire write lock immediately when unlocked', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using _lock = await RWLock.write('test-write-target')
      expect(RWLock.getStats().activeLocks).to.be.greaterThan(0)
    })

    it('should block readers when writer is active', async () => {
      const results: string[] = []
      const target = 'writer-blocks-reader'

      const writer = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write(target)
        results.push('w-start')
        await delay(20)
        results.push('w-end')
      })()

      // Give writer time to acquire lock
      await delay(2)

      const reader = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.read(target)
        results.push('r-start', 'r-end')
      })()

      await Promise.all([writer, reader])

      // Writer should complete before reader starts
      expect(results.indexOf('w-end')).to.be.lessThan(results.indexOf('r-start'))
    })

    it('should serialize concurrent writes', async () => {
      const results: string[] = []
      const target = 'serialize-writes'

      const writer1 = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write(target)
        results.push('w1-start')
        await delay(10)
        results.push('w1-end')
      })()

      const writer2 = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write(target)
        results.push('w2-start')
        await delay(10)
        results.push('w2-end')
      })()

      await Promise.all([writer1, writer2])

      // Writes should be serialized
      expect(results).to.deep.equal(['w1-start', 'w1-end', 'w2-start', 'w2-end'])
    })

    it('should release write lock via Symbol.dispose', async () => {
      const target = 'dispose-write-target'

      {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write(target)
        expect(RWLock.getStats().targets).to.include(target)
      }

      await delay(1)
      expect(RWLock.getStats().targets).to.not.include(target)
    })
  })

  describe('writer priority', () => {
    it('should give writers priority over waiting readers', async () => {
      const target = 'writer-priority'
      const results: string[] = []

      // Acquire initial write lock
      const initialLock = await RWLock.write(target)

      // Queue up a reader - it will wait for initial lock
      const readerPromise = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.read(target)
        results.push('reader')
      })()

      await delay(2) // Let reader get queued

      // Queue up a writer - it will also wait, but should have priority
      const writerPromise = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write(target)
        results.push('writer')
      })()

      await delay(2) // Let writer get queued

      // Release initial lock - writer should go before reader due to priority
      initialLock[Symbol.dispose]()

      // Wait for both to complete
      await Promise.all([readerPromise, writerPromise])

      // Writer should have executed before reader
      expect(results).to.deep.equal(['writer', 'reader'])
    })
  })

  describe('per-target locking', () => {
    it('should allow concurrent access to different targets', async () => {
      const results: string[] = []

      const op1 = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write('target-a')
        results.push('a-start')
        await delay(10)
        results.push('a-end')
      })()

      const op2 = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.write('target-b')
        results.push('b-start')
        await delay(10)
        results.push('b-end')
      })()

      await Promise.all([op1, op2])

      // Both should start before both end (concurrent on different targets)
      const aStart = results.indexOf('a-start')
      const bStart = results.indexOf('b-start')
      const aEnd = results.indexOf('a-end')
      const bEnd = results.indexOf('b-end')

      expect(Math.max(aStart, bStart)).to.be.lessThan(Math.min(aEnd, bEnd))
    })

    it('should clean up lock state when empty', async () => {
      const target = 'cleanup-target'

      {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        using _lock = await RWLock.read(target)
      }

      await delay(1)
      expect(RWLock.getStats().targets).to.not.include(target)
    })
  })

  describe('getStats', () => {
    it('should report active lock count', async () => {
      const initialStats = RWLock.getStats()
      const initialCount = initialStats.activeLocks

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using _lock1 = await RWLock.read('stats-target-1')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using _lock2 = await RWLock.write('stats-target-2')

      const stats = RWLock.getStats()
      expect(stats.activeLocks).to.equal(initialCount + 2)
    })

    it('should report locked targets', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using _lock = await RWLock.read('report-target')

      const stats = RWLock.getStats()
      expect(stats.targets).to.include('report-target')
    })
  })

  describe('lockKeyFromStorageKey', () => {
    it('should convert storage key array to lock key string', () => {
      const result = lockKeyFromStorageKey(['message', 'session123', 'msg456'])
      expect(result).to.equal('message:session123:msg456')
    })

    it('should handle single-segment keys', () => {
      const result = lockKeyFromStorageKey(['session'])
      expect(result).to.equal('session')
    })

    it('should handle two-segment keys', () => {
      const result = lockKeyFromStorageKey(['part', 'partId'])
      expect(result).to.equal('part:partId')
    })
  })
})
