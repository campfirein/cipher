/**
 * Tests for the [object Object] error fix.
 *
 * Verifies that non-Error objects thrown during AI SDK streaming are
 * properly serialized with meaningful messages instead of "[object Object]".
 *
 * Also verifies that existing error handling (Error instances, strings,
 * primitives, TaskError) is not broken by the fix.
 */
import {expect} from 'chai'

import {extractStreamErrorMessage} from '../../../src/agent/infra/llm/generators/ai-sdk-content-generator.js'
import {serializeTaskError, TaskError, TaskErrorCode} from '../../../src/server/core/domain/errors/task-error.js'
import {getErrorMessage} from '../../../src/server/utils/error-helpers.js'

describe('[object Object] error fix', () => {
  describe('serializeTaskError', () => {
    // ── Existing Error handling (must not regress) ──

    it('serializes TaskError with code', () => {
      const error = new TaskError('Agent not available', TaskErrorCode.AGENT_NOT_AVAILABLE)
      const result = serializeTaskError(error)
      expect(result.message).to.equal('Agent not available')
      expect(result.code).to.equal(TaskErrorCode.AGENT_NOT_AVAILABLE)
      expect(result.name).to.equal('TaskError')
    })

    it('serializes standard Error with known name → maps code', () => {
      const error = new Error('Generation failed')
      error.name = 'LlmGenerationError'
      const result = serializeTaskError(error)
      expect(result.message).to.equal('Generation failed')
      expect(result.code).to.equal(TaskErrorCode.LLM_ERROR)
      expect(result.name).to.equal('LlmGenerationError')
    })

    it('serializes standard Error with unknown name → no code', () => {
      const error = new Error('Something broke')
      const result = serializeTaskError(error)
      expect(result.message).to.equal('Something broke')
      expect(result.code).to.not.exist
      expect(result.name).to.equal('Error')
    })

    it('serializes string error', () => {
      const result = serializeTaskError('plain string error')
      expect(result.message).to.equal('plain string error')
    })

    it('serializes number error', () => {
      const result = serializeTaskError(42)
      expect(result.message).to.equal('42')
    })

    it('serializes null', () => {
      const result = serializeTaskError(null)
      expect(result.message).to.equal('null')
    })

    // ── Fix: non-Error objects must NOT produce "[object Object]" ──

    it('extracts .message from plain object with message property', () => {
      const error = {message: 'Something went wrong', status: 401}
      const result = serializeTaskError(error)
      expect(result.message).to.equal('Something went wrong')
      expect(result.message).to.not.equal('[object Object]')
    })

    it('JSON.stringifies plain object without message property', () => {
      const error = {code: 500, status: 'error'}
      const result = serializeTaskError(error)
      expect(result.message).to.equal('{"code":500,"status":"error"}')
      expect(result.message).to.not.equal('[object Object]')
    })

    it('handles OpenAI Responses API SSE error shape', () => {
      const error = {
        error: {code: 'invalid_api_key', message: 'Invalid API key provided', type: 'invalid_request_error'},
        type: 'error',
      }
      const result = serializeTaskError(error)
      expect(result.message).to.not.equal('[object Object]')
      expect(result.message).to.include('invalid_api_key')
    })

    it('handles axios-like error response object', () => {
      const error = {
        response: {data: {message: 'Unauthorized'}, status: 401},
        status: 401,
      }
      const result = serializeTaskError(error)
      expect(result.message).to.not.equal('[object Object]')
      expect(result.message).to.include('Unauthorized')
    })
  })

  describe('getErrorMessage', () => {
    it('returns message from Error instance', () => {
      expect(getErrorMessage(new Error('test error'))).to.equal('test error')
    })

    it('returns string error directly', () => {
      expect(getErrorMessage('string error')).to.equal('string error')
    })

    it('returns message from object with message property', () => {
      expect(getErrorMessage({message: 'obj message'})).to.equal('obj message')
    })

    it('JSON.stringifies plain object without message property', () => {
      const result = getErrorMessage({code: 500, status: 'error'})
      expect(result).to.equal('{"code":500,"status":"error"}')
      expect(result).to.not.equal('[object Object]')
    })

    it('handles nested error objects', () => {
      const error = {error: {message: 'nested error'}, type: 'error'}
      const result = getErrorMessage(error)
      expect(result).to.not.equal('[object Object]')
      expect(result).to.include('nested error')
    })

    it('handles null', () => {
      expect(getErrorMessage(null)).to.equal('null')
    })

    it('handles number', () => {
      expect(getErrorMessage(42)).to.equal('42')
    })
  })

  describe('full error chain (SSE error → serializeTaskError)', () => {
    it('extractStreamErrorMessage + serializeTaskError produces readable message', () => {
      const eventError = {
        error: {message: 'The usage limit has been reached'},
        type: 'error',
      }

      const msg = extractStreamErrorMessage(eventError)
      expect(msg).to.equal('The usage limit has been reached')

      const thrownError = new Error(msg)
      const errorData = serializeTaskError(thrownError)
      expect(errorData.message).to.equal('The usage limit has been reached')

      const logLine = `task:error taskId=test error=${errorData.message}`
      expect(logLine).to.include('usage limit')
      expect(logLine).to.not.include('[object Object]')
    })

    it('handles GCloud VM rejection scenario', () => {
      const sseError = {
        error: {
          code: 'server_error',
          message: 'Request rejected: access from cloud provider IP ranges is not permitted for this account.',
          type: 'server_error',
        },
        type: 'error',
      }

      const msg = extractStreamErrorMessage(sseError)
      expect(msg).to.equal('Request rejected: access from cloud provider IP ranges is not permitted for this account.')

      const errorData = serializeTaskError(new Error(msg))
      expect(errorData.message).to.not.include('[object Object]')
      expect(errorData.message).to.include('cloud provider IP')
    })
  })
})
