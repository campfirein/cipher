import {expect} from 'chai'

import {formatError} from '../../../../src/webui/lib/error-messages.js'

describe('formatError', () => {
  it('returns the override when the error carries a known code', () => {
    // ERR_PROVIDER_NOT_CONFIGURED is a known override in the map
    const error = {code: 'ERR_PROVIDER_NOT_CONFIGURED', message: 'original server message'}

    expect(formatError(error)).to.not.equal('original server message')
    expect(formatError(error)).to.be.a('string').with.length.greaterThan(0)
  })

  it('falls through to error.message when the code is not mapped', () => {
    const error = {code: 'ERR_UNKNOWN_XYZ', message: 'server copy should pass through'}

    expect(formatError(error)).to.equal('server copy should pass through')
  })

  it('returns the message for a standard Error instance (no code)', () => {
    const error = new Error('plain error message')

    expect(formatError(error)).to.equal('plain error message')
  })

  it('uses the override on an Error instance that carries a code property', () => {
    const error = Object.assign(new Error('raw text'), {code: 'ERR_PROVIDER_NOT_CONFIGURED'})

    expect(formatError(error)).to.not.equal('raw text')
  })

  it('returns the fallback when the error is null, undefined, or a plain string', () => {
    expect(formatError(undefined, 'fallback copy')).to.equal('fallback copy')
    expect(formatError(null, 'fallback copy')).to.equal('fallback copy')
    expect(formatError('plain string', 'fallback copy')).to.equal('fallback copy')
  })

  it('returns the default fallback when none is provided and the error has no message', () => {
    expect(formatError({})).to.equal('Something went wrong')
  })

  describe('context-aware overrides', () => {
    it('includes the project path in the USER_NOT_CONFIGURED override when context is provided', () => {
      const error = {code: 'ERR_VC_USER_NOT_CONFIGURED', message: 'raw server message'}
      const result = formatError(error, 'fallback copy', {projectPath: '/Users/thien/my-proj'})

      expect(result).to.include('/Users/thien/my-proj')
      expect(result).to.include('brv vc config')
    })

    it('falls back to a generic USER_NOT_CONFIGURED override when no project path is supplied', () => {
      const error = {code: 'ERR_VC_USER_NOT_CONFIGURED', message: 'raw server message'}
      const result = formatError(error)

      expect(result).to.include('brv vc config')
      expect(result).to.not.include('undefined')
    })

    it('ignores context for non-function overrides', () => {
      const error = {code: 'ERR_PROVIDER_NOT_CONFIGURED', message: 'raw'}
      const withCtx = formatError(error, 'fallback copy', {projectPath: '/Users/thien/proj'})
      const withoutCtx = formatError(error)

      expect(withCtx).to.equal(withoutCtx)
    })
  })
})
