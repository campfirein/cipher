import {expect} from 'chai'

import {extractStreamErrorMessage} from '../../../../../src/agent/infra/llm/generators/ai-sdk-content-generator.js'

describe('extractStreamErrorMessage', () => {
  it('should extract message from OpenAI Responses API error shape', () => {
    const error = {
      error: {code: 'invalid_api_key', message: 'Invalid API key provided', type: 'invalid_request_error'},
      sequenceNumber: 1,
      type: 'error',
    }
    expect(extractStreamErrorMessage(error)).to.equal('Invalid API key provided')
  })

  it('should extract message from simple object with message property', () => {
    const error = {message: 'Something went wrong'}
    expect(extractStreamErrorMessage(error)).to.equal('Something went wrong')
  })

  it('should return string errors directly', () => {
    expect(extractStreamErrorMessage('plain string error')).to.equal('plain string error')
  })

  it('should JSON.stringify objects without message property', () => {
    const error = {code: 500, status: 'error'}
    expect(extractStreamErrorMessage(error)).to.equal('{"code":500,"status":"error"}')
  })

  it('should prefer nested error.message over top-level message', () => {
    const error = {
      error: {message: 'Nested error message'},
      message: 'Top-level message',
      type: 'error',
    }
    expect(extractStreamErrorMessage(error)).to.equal('Nested error message')
  })

  it('should handle null', () => {
    expect(extractStreamErrorMessage(null)).to.equal('null')
  })

  it('should handle undefined', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(extractStreamErrorMessage(undefined)).to.equal('undefined')
  })

  it('should handle number', () => {
    expect(extractStreamErrorMessage(42)).to.equal('42')
  })

  it('should handle nested error without message', () => {
    const error = {error: {code: 'some_code'}, type: 'error'}
    // Falls through to top-level message check (none), then JSON.stringify
    expect(extractStreamErrorMessage(error)).to.equal('{"error":{"code":"some_code"},"type":"error"}')
  })
})
