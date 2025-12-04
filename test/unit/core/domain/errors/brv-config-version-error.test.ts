import {expect} from 'chai'

import {BrvConfigVersionError} from '../../../../../src/core/domain/errors/brv-config-version-error.js'

describe('BrvConfigVersionError', () => {
  describe('constructor', () => {
    it('should create error with message for missing version', () => {
      const error = new BrvConfigVersionError({
        currentVersion: undefined,
        expectedVersion: '0.0.1',
      })

      expect(error.message).to.equal(`Config version missing. Please run 'brv init' to reinitialize.`)
      expect(error.currentVersion).to.be.undefined
      expect(error.expectedVersion).to.equal('0.0.1')
    })

    it('should create error with message for version mismatch', () => {
      const error = new BrvConfigVersionError({
        currentVersion: '0.0.0',
        expectedVersion: '0.0.1',
      })

      expect(error.message).to.equal(
        `Config version mismatch (found: 0.0.0, expected: 0.0.1). Please run 'brv init' to reinitialize.`,
      )
      expect(error.currentVersion).to.equal('0.0.0')
      expect(error.expectedVersion).to.equal('0.0.1')
    })

    it('should set error name to BrvConfigVersionError', () => {
      const error = new BrvConfigVersionError({
        currentVersion: undefined,
        expectedVersion: '0.0.1',
      })

      expect(error.name).to.equal('BrvConfigVersionError')
    })

    it('should be instanceof Error', () => {
      const error = new BrvConfigVersionError({
        currentVersion: undefined,
        expectedVersion: '0.0.1',
      })

      expect(error).to.be.instanceof(Error)
    })
  })
})
