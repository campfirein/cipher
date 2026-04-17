import {expect} from 'chai'

import {retry, waitUntil} from './retry.js'

describe('retry utilities', () => {
  describe('retry', () => {
    it('should return the result when fn succeeds on first attempt', async () => {
      const result = await retry(() => Promise.resolve('ok'))
      expect(result).to.equal('ok')
    })

    it('should retry on failure then return result when fn succeeds within limit', async () => {
      let calls = 0
      const fn = () => {
        calls++
        if (calls < 3) throw new Error(`fail #${calls}`)
        return Promise.resolve('recovered')
      }

      const result = await retry(fn, {delay: 10, retries: 3})
      expect(result).to.equal('recovered')
      expect(calls).to.equal(3)
    })

    it('should throw the last error after all retries are exhausted', async () => {
      let calls = 0
      const fn = () => {
        calls++
        return Promise.reject(new Error(`fail #${calls}`))
      }

      try {
        await retry(fn, {delay: 10, retries: 2})
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('fail #3')
        expect(calls).to.equal(3) // 1 initial + 2 retries
      }
    })

    it('should respect custom retries count', async () => {
      let calls = 0
      const fn = () => {
        calls++
        return Promise.reject(new Error('always fails'))
      }

      try {
        await retry(fn, {delay: 10, retries: 1})
        expect.fail('should have thrown')
      } catch {
        expect(calls).to.equal(2) // 1 initial + 1 retry
      }
    })

    it('should respect custom delay between retries', async () => {
      let calls = 0
      const fn = () => {
        calls++
        if (calls < 3) return Promise.reject(new Error('fail'))
        return Promise.resolve('done')
      }

      const start = Date.now()
      await retry(fn, {delay: 50, retries: 3})
      const elapsed = Date.now() - start

      // 2 retries * 50ms delay = at least 100ms
      expect(elapsed).to.be.at.least(80) // small margin for timer imprecision
    })

    it('should not retry when retries is 0', async () => {
      let calls = 0
      const fn = () => {
        calls++
        return Promise.reject(new Error('immediate fail'))
      }

      try {
        await retry(fn, {delay: 10, retries: 0})
        expect.fail('should have thrown')
      } catch (error) {
        expect(calls).to.equal(1)
        expect((error as Error).message).to.equal('immediate fail')
      }
    })
  })

  describe('waitUntil', () => {
    it('should resolve when predicate returns true', async () => {
      let calls = 0

      await waitUntil(
        () => {
          calls++
          return Promise.resolve(calls >= 3)
        },
        {interval: 10, timeout: 1000},
      )
      expect(calls).to.be.at.least(3)
    })

    it('should throw when timeout is exceeded', async () => {
      try {
        await waitUntil(() => Promise.resolve(false), {interval: 20, timeout: 100})
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('timed out')
      }
    })

    it('should propagate errors thrown by the predicate', async () => {
      try {
        await waitUntil(() => Promise.reject(new Error('predicate exploded')), {interval: 10, timeout: 1000})
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('predicate exploded')
      }
    })
  })
})
