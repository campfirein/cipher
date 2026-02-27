import {expect} from 'chai'

import {LlmResponseParsingError} from '../../../../../src/agent/core/domain/errors/llm-error.js'
import {
  AGGRESSIVE_RETRY_POLICY,
  calculateRetryDelay,
  DEFAULT_RETRY_POLICY,
  extractRateLimitDelay,
  isRetryableError,
  RATE_LIMIT_FALLBACK_DELAY_MS,
} from '../../../../../src/agent/infra/llm/retry/retry-policy.js'

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

    it('should include both rate limit pattern variants', () => {
      expect(DEFAULT_RETRY_POLICY.retryableErrors).to.include('rate_limit')
      expect(DEFAULT_RETRY_POLICY.retryableErrors).to.include('rate limit')
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

      it('should return true for rate_limit errors (underscore variant)', () => {
        const error = new Error('rate_limit exceeded')

        const result = isRetryableError(error, DEFAULT_RETRY_POLICY)

        expect(result).to.be.true
      })

      it('should return true for "rate limit" errors (space variant — Anthropic message format)', () => {
        const error = new Error(
          "This request would exceed your organization's rate limit of 100,000 input tokens per minute",
        )

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

  describe('RATE_LIMIT_FALLBACK_DELAY_MS', () => {
    it('should be 65000ms (60s window + 5s safety buffer)', () => {
      expect(RATE_LIMIT_FALLBACK_DELAY_MS).to.equal(65_000)
    })
  })

  describe('extractRateLimitDelay', () => {
    describe('returns undefined when no retry hint available', () => {
      it('should return undefined for null', () => {
        expect(extractRateLimitDelay(null)).to.be.undefined
      })

      it('should return undefined for undefined', () => {
        expect(extractRateLimitDelay(undefined)).to.be.undefined
      })

      it('should return undefined for a plain Error with no response metadata', () => {
        expect(extractRateLimitDelay(new Error('rate limit'))).to.be.undefined
      })

      it('should return undefined for an error with empty responseHeaders', () => {
        expect(extractRateLimitDelay({responseHeaders: {}})).to.be.undefined
      })
    })

    describe('Path 1: retry-after header (Anthropic, OpenAI, Groq, xAI, Mistral)', () => {
      it('should parse integer seconds and add 2s buffer', () => {
        const error = {responseHeaders: {'retry-after': '30'}}
        expect(extractRateLimitDelay(error)).to.equal(32_000) // (30 + 2) * 1000
      })

      it('should return 2s buffer when retry-after is 0', () => {
        const error = {responseHeaders: {'retry-after': '0'}}
        expect(extractRateLimitDelay(error)).to.equal(2_000) // (0 + 2) * 1000
      })

      it('should normalize header name to lowercase (e.g. Retry-After)', () => {
        const error = {responseHeaders: {'Retry-After': '60'}}
        expect(extractRateLimitDelay(error)).to.equal(62_000)
      })

      it('should parse HTTP-date string from retry-after when integer parsing fails', () => {
        const futureDate = new Date(Date.now() + 10_000).toUTCString()
        const error = {responseHeaders: {'retry-after': futureDate}}
        const delay = extractRateLimitDelay(error)
        // 10s in the future + 2s buffer, with ±1s margin for test execution
        expect(delay).to.be.at.least(9_000).and.at.most(14_000)
      })
    })

    describe('Path 2: retry-after-ms header (Azure OpenAI)', () => {
      it('should parse milliseconds and add 2s buffer', () => {
        const error = {responseHeaders: {'retry-after-ms': '5000'}}
        expect(extractRateLimitDelay(error)).to.equal(7_000) // 5000 + 2000
      })

      it('retry-after takes priority over retry-after-ms', () => {
        const error = {responseHeaders: {'retry-after': '30', 'retry-after-ms': '5000'}}
        expect(extractRateLimitDelay(error)).to.equal(32_000) // retry-after wins
      })
    })

    describe('Path 3: Anthropic anthropic-ratelimit-*-reset (RFC 3339 backup)', () => {
      it('should parse anthropic-ratelimit-input-tokens-reset RFC 3339 timestamp', () => {
        const futureTime = new Date(Date.now() + 58_000).toISOString()
        const error = {responseHeaders: {'anthropic-ratelimit-input-tokens-reset': futureTime}}
        const delay = extractRateLimitDelay(error)
        expect(delay).to.be.at.least(57_000).and.at.most(63_000)
      })

      it('should fall back to anthropic-ratelimit-tokens-reset when input-tokens header absent', () => {
        const futureTime = new Date(Date.now() + 30_000).toISOString()
        const error = {responseHeaders: {'anthropic-ratelimit-tokens-reset': futureTime}}
        const delay = extractRateLimitDelay(error)
        expect(delay).to.be.at.least(29_000).and.at.most(35_000)
      })

      it('retry-after takes priority over anthropic-ratelimit-*-reset', () => {
        const futureTime = new Date(Date.now() + 58_000).toISOString()
        const error = {
          responseHeaders: {
            'retry-after': '10',
            'anthropic-ratelimit-input-tokens-reset': futureTime,
          },
        }
        expect(extractRateLimitDelay(error)).to.equal(12_000) // retry-after wins
      })
    })

    describe('Path 4: OpenRouter X-RateLimit-Reset (Unix ms timestamp)', () => {
      it('should parse capitalized X-RateLimit-Reset and compute delay to reset time', () => {
        const futureMs = Date.now() + 60_000
        const error = {responseHeaders: {'X-RateLimit-Reset': String(futureMs)}}
        const delay = extractRateLimitDelay(error)
        expect(delay).to.be.at.least(59_000).and.at.most(65_000)
      })

      it('should ignore past OpenRouter timestamp (delay would be negative)', () => {
        const pastMs = Date.now() - 10_000
        const error = {responseHeaders: {'X-RateLimit-Reset': String(pastMs)}}
        // Past timestamp → delay ≤ 0 → Path 4 skipped → no other headers → undefined
        expect(extractRateLimitDelay(error)).to.be.undefined
      })

      it('should NOT treat small values in x-ratelimit-reset as Unix ms timestamps', () => {
        // value "60" is NOT > 1e12, so Path 4 is skipped
        const error = {responseHeaders: {'x-ratelimit-reset': '60'}}
        expect(extractRateLimitDelay(error)).to.be.undefined
      })
    })

    describe('Path 5: OpenAI/Groq x-ratelimit-reset-tokens (Go duration fallback)', () => {
      it('should parse "6m0s"', () => {
        const error = {responseHeaders: {'x-ratelimit-reset-tokens': '6m0s'}}
        expect(extractRateLimitDelay(error)).to.equal(362_000) // 360000 + 2000
      })

      it('should parse "2m59.56s"', () => {
        const error = {responseHeaders: {'x-ratelimit-reset-tokens': '2m59.56s'}}
        // 2*60*1000 + ceil(59.56*1000) + 2000 = 120000 + 59560 + 2000
        expect(extractRateLimitDelay(error)).to.equal(181_560)
      })

      it('should parse "120ms" without treating "m" as minutes', () => {
        // Key regression: "120ms" must NOT parse 120 minutes
        const error = {responseHeaders: {'x-ratelimit-reset-tokens': '120ms'}}
        expect(extractRateLimitDelay(error)).to.equal(2_120) // 120ms + 2000ms buffer
      })

      it('should parse "17ms"', () => {
        const error = {responseHeaders: {'x-ratelimit-reset-tokens': '17ms'}}
        expect(extractRateLimitDelay(error)).to.equal(2_017) // 17 + 2000
      })

      it('should parse "1s"', () => {
        const error = {responseHeaders: {'x-ratelimit-reset-tokens': '1s'}}
        expect(extractRateLimitDelay(error)).to.equal(3_000) // 1000 + 2000
      })

      it('should parse fractional seconds "7.66s"', () => {
        const error = {responseHeaders: {'x-ratelimit-reset-tokens': '7.66s'}}
        expect(extractRateLimitDelay(error)).to.equal(9_660) // ceil(7660) + 2000
      })

      it('should fall back to x-ratelimit-reset-requests when tokens header absent', () => {
        const error = {responseHeaders: {'x-ratelimit-reset-requests': '30s'}}
        expect(extractRateLimitDelay(error)).to.equal(32_000) // 30000 + 2000
      })

      it('x-ratelimit-reset-tokens takes priority over x-ratelimit-reset-requests', () => {
        const error = {
          responseHeaders: {
            'x-ratelimit-reset-tokens': '1s',
            'x-ratelimit-reset-requests': '30s',
          },
        }
        expect(extractRateLimitDelay(error)).to.equal(3_000) // tokens header wins
      })
    })

    describe('Path 6: Gemini retryDelay in response body (google.rpc.RetryInfo)', () => {
      const geminiBody = {
        error: {
          code: 429,
          details: [
            {'@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '53s'},
            {'@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: []},
          ],
        },
      }

      it('should parse retryDelay from e.data (pre-parsed body)', () => {
        const error = {data: geminiBody}
        expect(extractRateLimitDelay(error)).to.equal(55_000) // 53000 + 2000
      })

      it('should parse retryDelay from e.responseBody (raw JSON string)', () => {
        const error = {responseBody: JSON.stringify(geminiBody)}
        expect(extractRateLimitDelay(error)).to.equal(55_000)
      })

      it('e.data takes priority over e.responseBody', () => {
        const bodyWithDifferentDelay = {
          error: {details: [{'@type': '...RetryInfo', retryDelay: '10s'}]},
        }
        const error = {data: geminiBody, responseBody: JSON.stringify(bodyWithDifferentDelay)}
        expect(extractRateLimitDelay(error)).to.equal(55_000) // data (53s) wins
      })

      it('should parse fractional retryDelay "1.5s"', () => {
        const error = {
          data: {error: {details: [{'@type': '...RetryInfo', retryDelay: '1.5s'}]}},
        }
        expect(extractRateLimitDelay(error)).to.equal(3_500) // ceil(1500) + 2000
      })

      it('should return undefined for invalid retryDelay format', () => {
        const error = {
          data: {error: {details: [{'@type': '...RetryInfo', retryDelay: 'invalid'}]}},
        }
        expect(extractRateLimitDelay(error)).to.be.undefined
      })

      it('should return undefined for non-JSON responseBody string', () => {
        expect(extractRateLimitDelay({responseBody: 'not json'})).to.be.undefined
      })
    })

    describe('priority: header-based paths beat body-based paths', () => {
      it('retry-after header takes priority over Gemini body retryDelay', () => {
        const error = {
          responseHeaders: {'retry-after': '30'},
          data: {error: {details: [{'@type': '...RetryInfo', retryDelay: '53s'}]}},
        }
        expect(extractRateLimitDelay(error)).to.equal(32_000) // header wins
      })

      it('retry-after header takes priority over Go-duration reset header', () => {
        const error = {
          responseHeaders: {'retry-after': '30', 'x-ratelimit-reset-tokens': '6m0s'},
        }
        expect(extractRateLimitDelay(error)).to.equal(32_000) // retry-after wins
      })
    })
  })
})
