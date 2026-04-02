import {expect} from 'chai'

import {getErrorMessage} from '../../../../src/server/utils/error-helpers.js'

describe('getErrorMessage', () => {
  it('should return message from Error instance', () => {
    expect(getErrorMessage(new Error('test error'))).to.equal('test error')
  })

  it('should return string errors directly', () => {
    expect(getErrorMessage('string error')).to.equal('string error')
  })

  it('should extract message from object with message property', () => {
    expect(getErrorMessage({message: 'object error'})).to.equal('object error')
  })

  it('should JSON.stringify object without message property instead of returning [object Object]', () => {
    const error = {code: 500, status: 'error'}
    const result = getErrorMessage(error)
    expect(result).to.equal('{"code":500,"status":"error"}')
    expect(result).to.not.equal('[object Object]')
  })

  it('should handle null', () => {
    expect(getErrorMessage(null)).to.equal('null')
  })

  it('should handle undefined', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(getErrorMessage(undefined)).to.equal('undefined')
  })

  it('should handle number', () => {
    expect(getErrorMessage(42)).to.equal('42')
  })

  it('should handle object with non-string message', () => {
    const error = {message: 123}
    const result = getErrorMessage(error)
    expect(result).to.equal('{"message":123}')
  })
})
