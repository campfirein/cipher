import {expect} from 'chai'
import {restore, useFakeTimers} from 'sinon'

import {
  LlmRequestTimeoutError,
  withRequestTimeout,
} from '../../../../../src/agent/infra/llm/generators/ai-sdk-abort-helper.js'
import {DEFAULT_RETRY_POLICY, isRetryableError} from '../../../../../src/agent/infra/llm/retry/retry-policy.js'

describe('ai-sdk-abort-helper', () => {
  describe('withRequestTimeout', () => {
    afterEach(() => {
      restore()
    })

    it('returns the body result without a signal when timeoutMs is undefined', async () => {
      let receivedSignal: AbortSignal | undefined
      const result = await withRequestTimeout(undefined, async (signal) => {
        receivedSignal = signal
        return 'ok'
      })

      expect(result).to.equal('ok')
      expect(receivedSignal).to.be.undefined
    })

    it('passes an AbortSignal to the body when timeoutMs is set', async () => {
      let receivedSignal: AbortSignal | undefined
      const result = await withRequestTimeout(10_000, async (signal) => {
        receivedSignal = signal
        return 42
      })

      expect(result).to.equal(42)
      expect(receivedSignal).to.be.instanceOf(AbortSignal)
      expect(receivedSignal?.aborted).to.equal(false)
    })

    it('throws LlmRequestTimeoutError when the body never resolves and the timer fires', async () => {
      const clock = useFakeTimers()
      const promise = withRequestTimeout(50, async (signal) =>
        new Promise<never>((_, reject) => {
          if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      )
      await clock.tickAsync(50)

      try {
        await promise
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(LlmRequestTimeoutError)
        if (error instanceof LlmRequestTimeoutError) {
          expect(error.timeoutMs).to.equal(50)
          expect(error.message).to.match(/timeout/i)
        }
      }
    })

    it('rethrows non-timeout errors unchanged', async () => {
      const originalError = new Error('different failure')
      try {
        await withRequestTimeout(10_000, async () => {
          throw originalError
        })
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.equal(originalError)
      }
    })

    it('clears the underlying timer on success so the timeout does not leak', async () => {
      const clock = useFakeTimers()
      const result = await withRequestTimeout(100, async () => 'done')
      expect(result).to.equal('done')

      // If the timer were still active, ticking past the timeout would fire abort,
      // surfacing an unhandled rejection. The clean termination of this test
      // verifies the timer was cleared.
      await clock.tickAsync(200)
    })
  })

  describe('LlmRequestTimeoutError', () => {
    it('embeds the timeout in the message so the retry layer classifies it as retryable', () => {
      const error = new LlmRequestTimeoutError(60_000)
      expect(error.message).to.match(/timeout/i)
      expect(isRetryableError(error, DEFAULT_RETRY_POLICY)).to.equal(true)
    })
  })
})
