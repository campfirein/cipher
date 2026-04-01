import {expect} from 'chai'

import {
  serializeTaskError,
  TaskError,
  TaskErrorCode,
} from '../../../../../../src/server/core/domain/errors/task-error.js'

describe('serializeTaskError', () => {
  it('should serialize TaskError with code', () => {
    const error = new TaskError('test message', TaskErrorCode.LLM_ERROR)
    const result = serializeTaskError(error)
    expect(result.message).to.equal('test message')
    expect(result.code).to.equal(TaskErrorCode.LLM_ERROR)
    expect(result.name).to.equal('TaskError')
  })

  it('should serialize standard Error', () => {
    const error = new Error('standard error')
    const result = serializeTaskError(error)
    expect(result.message).to.equal('standard error')
    expect(result.name).to.equal('Error')
  })

  it('should extract message from plain object with message property', () => {
    const error = {message: 'object with message'}
    const result = serializeTaskError(error)
    expect(result.message).to.equal('object with message')
    expect(result.name).to.equal('Error')
  })

  it('should JSON.stringify plain object without message instead of returning [object Object]', () => {
    const error = {code: 500, status: 'error'}
    const result = serializeTaskError(error)
    expect(result.message).to.equal('{"code":500,"status":"error"}')
    expect(result.message).to.not.equal('[object Object]')
  })

  it('should handle string error', () => {
    const result = serializeTaskError('string error')
    expect(result.message).to.equal('string error')
  })

  it('should handle null', () => {
    const result = serializeTaskError(null)
    expect(result.message).to.equal('null')
  })

  it('should handle undefined', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = serializeTaskError(undefined)
    expect(result.message).to.equal('undefined')
  })

  it('should map known error names to codes', () => {
    const error = new Error('rate limited')
    error.name = 'LlmRateLimitError'
    const result = serializeTaskError(error)
    expect(result.code).to.equal(TaskErrorCode.LLM_RATE_LIMIT)
  })
})
