import {expect} from 'chai'

import {LlmResponseParsingError} from '../../../../../../src/core/domain/cipher/errors/llm-error.js'
import {
  AGGRESSIVE_RETRY_POLICY,
  calculateRetryDelay,
  DEFAULT_RETRY_POLICY,
  isRetryableError,
} from '../../../../../../src/infra/cipher/llm/retry/retry-policy.js'

describe('retry-policy', () => {
  describe('DEFAULT_RETRY_POLICY', () => {
    it('should have empty response patterns in retryableErrors', () => {
      expect(DEFAULT_RETRY_POLICY.retryableErrors).to.include('neither content nor tool calls')
      expect(DEFAULT_RETRY_POLICY.retryableErrors).to.include('no content')
      expect(DEFAULT_RETRY_POLICY.retryableErrors).to.include('empty response')
      expect(DEFAULT_RETRY_POLICY.retryableErrors).to.include('no messages')
    })

    it('should have 3 max retries', () => {
      expect(DEFAULT_RETRY_POLICY.maxRetries).to.equal(3)
    })
  })

  describe('AGGRESSIVE_RETRY_POLICY', () => {
    it('should have empty response patterns in retryableErrors', () => {
      expect(AGGRESSIVE_RETRY_POLICY.retryableErrors).to.include('neither content nor tool calls')
      expect(AGGRESSIVE_RETRY_POLICY.retryableErrors).to.include('no content')
      expect(AGGRESSIVE_RETRY_POLICY.retryableErrors).to.include('empty response')
      expect(AGGRESSIVE_RETRY_POLICY.retryableErrors).to.include('no messages')
    })

    it('should have 5 max retries', () => {
      expect(AGGRESSIVE_RETRY_POLICY.maxRetries).to.equal(5)
    })
  })

  describe('isRetryableError', () => {
    describe('empty response errors (ENG-767)', () => {
      it('should return true for LlmResponseParsingError with "neither content nor tool calls"', () => {
        const error = new LlmResponseParsingError(
          'Response has neither content nor tool calls',
          'byterover',
          'gemini-2.5-flash',
        )

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for error message containing "no content"', () => {
        const error = new Error('Response has no content')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for error message containing "empty response"', () => {
        const error = new Error('Received empty response from LLM')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for error message containing "no messages"', () => {
        const error = new Error('Response contains no messages')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })
    })

    describe('network errors', () => {
      it('should return true for ECONNRESET', () => {
        const error = new Error('ECONNRESET')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for timeout errors', () => {
        const error = new Error('Request timeout')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for rate_limit errors', () => {
        const error = new Error('rate_limit exceeded')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })
    })

    describe('HTTP status codes', () => {
      it('should return true for 429 Too Many Requests', () => {
        const error = {message: 'Too Many Requests', status: 429}

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for 503 Service Unavailable', () => {
        const error = {message: 'Service Unavailable', status: 503}

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return false for 400 Bad Request', () => {
        const error = {message: 'Bad Request', status: 400}

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.false
      })
    })

    describe('non-retryable errors', () => {
      it('should return false for generic errors', () => {
        const error = new Error('Something went wrong')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.false
      })

      it('should return false when maxRetries is 0', () => {
        const policy = {...DEFAULT_RETRY_POLICY, maxRetries: 0}
        const error = new Error('ECONNRESET')

        const result = isRetryableError(error, policy)

        expect(result).to.be.false
      })
    })
  })

  describe('calculateRetryDelay', () => {
    it('should return base delay for first attempt', () => {
      const delay = calculateRetryDelay(1, DEFAULT_RETRY_POLICY)

      // With jitter, delay should be within ±25% of base
      expect(delay).to.be.at.least(750) // 1000 - 25%
      expect(delay).to.be.at.most(1250) // 1000 + 25%
    })

    it('should apply exponential backoff', () => {
      const delay1 = calculateRetryDelay(1, {...DEFAULT_RETRY_POLICY, jitterFactor: 0})
      const delay2 = calculateRetryDelay(2, {...DEFAULT_RETRY_POLICY, jitterFactor: 0})
      const delay3 = calculateRetryDelay(3, {...DEFAULT_RETRY_POLICY, jitterFactor: 0})

      expect(delay2).to.equal(delay1 * 2)
      expect(delay3).to.equal(delay2 * 2)
    })

    it('should cap at maxDelayMs', () => {
      const policy = {...DEFAULT_RETRY_POLICY, jitterFactor: 0}
      const delay = calculateRetryDelay(10, policy) // Would be 1000 * 2^9 = 512000

      expect(delay).to.equal(policy.maxDelayMs)
    })
  })
})
