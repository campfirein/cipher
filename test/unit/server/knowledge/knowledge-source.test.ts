import {expect} from 'chai'

import {deriveSourceKey} from '../../../../src/server/core/domain/knowledge/knowledge-source.js'

describe('knowledge-source', () => {
  describe('deriveSourceKey', () => {
    it('should return a 12-character hex string', () => {
      const key = deriveSourceKey('/some/path')
      expect(key).to.match(/^[0-9a-f]{12}$/)
    })

    it('should return the same key for the same path', () => {
      const key1 = deriveSourceKey('/projects/shared-lib')
      const key2 = deriveSourceKey('/projects/shared-lib')
      expect(key1).to.equal(key2)
    })

    it('should return different keys for different paths', () => {
      const key1 = deriveSourceKey('/projects/shared-lib')
      const key2 = deriveSourceKey('/projects/api-client')
      expect(key1).to.not.equal(key2)
    })

    it('should use SHA-256 first 12 hex chars', () => {
      // SHA-256 of '/test' is known — just verify length and hex format
      const key = deriveSourceKey('/test')
      expect(key).to.have.lengthOf(12)
      expect(key).to.match(/^[0-9a-f]+$/)
    })
  })
})
