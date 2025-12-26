import {expect} from 'chai'

import {toUnixPath} from '../../../../src/infra/context-tree/path-utils.js'

describe('path-utils', () => {
  describe('toUnixPath', () => {
    it('should normalize Windows backslashes to forward slashes on all platforms', () => {
      const input = String.raw`auth\jwt\context.md`
      const result = toUnixPath(input)

      // Always converts backslashes regardless of platform
      // This is important for handling API responses that may contain Windows-style paths
      expect(result).to.equal('auth/jwt/context.md')
    })

    it('should handle mixed separators', () => {
      const input = String.raw`auth/jwt\context.md`
      const result = toUnixPath(input)

      expect(result).to.equal('auth/jwt/context.md')
    })

    it('should handle nested paths with backslashes', () => {
      const input = String.raw`level1\level2\level3\context.md`
      const result = toUnixPath(input)

      expect(result).to.equal('level1/level2/level3/context.md')
    })

    it('should return Unix paths unchanged', () => {
      const input = 'auth/jwt/context.md'
      const result = toUnixPath(input)

      expect(result).to.equal('auth/jwt/context.md')
    })

    it('should handle single-level paths', () => {
      const input = 'context.md'
      const result = toUnixPath(input)

      expect(result).to.equal('context.md')
    })

    it('should handle hidden directories with backslashes', () => {
      const input = String.raw`.hidden\subfolder\context.md`
      const result = toUnixPath(input)

      expect(result).to.equal('.hidden/subfolder/context.md')
    })

    it('should handle deeply nested Windows-style paths', () => {
      const input = String.raw`a\b\c\d\e\f\context.md`
      const result = toUnixPath(input)

      expect(result).to.equal('a/b/c/d/e/f/context.md')
    })
  })
})
