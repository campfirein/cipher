import {expect} from 'chai'

import {_resetCaches, isHeadlessLinux, isWsl, shouldUseFileTokenStore} from '../../../src/server/utils/environment-detector.js'

describe('environment-detector', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = {...process.env}
    _resetCaches()
  })

  afterEach(() => {
    process.env = originalEnv
    _resetCaches()
  })

  describe('isWsl()', () => {
    it('should return false on non-Linux platforms', function () {
      if (process.platform === 'linux') {
        this.skip()
      }

      expect(isWsl()).to.be.false
    })

    it('should cache the result', () => {
      const first = isWsl()
      const second = isWsl()
      expect(first).to.equal(second)
    })
  })

  describe('isHeadlessLinux()', () => {
    it('should return false on non-Linux platforms', function () {
      if (process.platform === 'linux') {
        this.skip()
      }

      expect(isHeadlessLinux()).to.be.false
    })

    it('should cache the result', () => {
      const first = isHeadlessLinux()
      const second = isHeadlessLinux()
      expect(first).to.equal(second)
    })
  })

  describe('shouldUseFileTokenStore()', () => {
    it('should return boolean', () => {
      const result = shouldUseFileTokenStore()
      expect(typeof result).to.equal('boolean')
    })
  })

  describe('_resetCaches()', () => {
    it('should allow re-evaluation of environment after reset', () => {
      const first = isWsl()
      _resetCaches()
      const second = isWsl()
      expect(first).to.equal(second)
    })
  })
})
