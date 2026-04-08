import {expect} from 'chai'

import {formatConnectionError} from '../../../../src/oclif/lib/daemon-client.js'
import {TaskErrorCode} from '../../../../src/server/core/domain/errors/task-error.js'

describe('formatConnectionError — task error handling', () => {
  describe('task errors with error code (from task-client.ts)', () => {
    it('should return USER_FRIENDLY_MESSAGES for mapped task error codes', () => {
      const error = Object.assign(new Error('Provider requires authentication.'), {
        code: TaskErrorCode.PROVIDER_NOT_CONFIGURED,
      })

      const result = formatConnectionError(error)

      expect(result).to.include('No provider connected')
      expect(result).to.not.include('API key is missing or invalid')
    })

    it('should return raw backend message for unmapped task error codes (e.g. ERR_TASK_EXECUTION)', () => {
      const backendMessage =
        "You've reached your free tier daily request limit (0/0 in the last 24 hours). " +
        'Upgrade your plan at https://www.byterover.dev/pricing to continue, ' +
        'or switch to another provider with your own API key.'
      const error = Object.assign(new Error(backendMessage), {
        code: TaskErrorCode.TASK_EXECUTION,
      })

      const result = formatConnectionError(error)

      // Should show exact backend message, NOT the api-key error
      expect(result).to.equal(backendMessage)
      expect(result).to.not.include('API key is missing or invalid')
      expect(result).to.not.include('brv providers connect')
    })

    it('should return raw backend message for ERR_LLM_ERROR code', () => {
      const backendMessage = 'Generation failed: model overloaded, please retry.'
      const error = Object.assign(new Error(backendMessage), {
        code: TaskErrorCode.LLM_ERROR,
      })

      const result = formatConnectionError(error)

      expect(result).to.equal(backendMessage)
    })

    it('should return raw backend message for ERR_LLM_RATE_LIMIT code', () => {
      const backendMessage = 'Rate limit exceeded. Retry in 30 seconds.'
      const error = Object.assign(new Error(backendMessage), {
        code: TaskErrorCode.LLM_RATE_LIMIT,
      })

      const result = formatConnectionError(error)

      expect(result).to.equal(backendMessage)
    })
  })

  describe('plain errors without code (backward compat)', () => {
    it('should still text-match "api key" for plain errors without code', () => {
      const error = new Error('anthropic API key is missing from storage.')

      const result = formatConnectionError(error, {activeProvider: 'anthropic'})

      expect(result).to.include('API key is missing or invalid')
    })

    it('should still text-match "401" for plain errors without code', () => {
      const error = new Error('Request failed with status code 401')

      const result = formatConnectionError(error)

      expect(result).to.include('Authentication required')
    })
  })
})
