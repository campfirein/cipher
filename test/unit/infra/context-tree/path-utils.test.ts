import {expect} from 'chai'

import {toUnixPath} from '../../../../src/infra/context-tree/path-utils.js'

describe('path-utils', () => {
  describe('toUnixPath', () => {
    it('should normalize Windows backslashes to forward slashes', () => {
      // On Windows, this will convert; on Unix, it returns unchanged (no backslashes in input anyway)
      const input = String.raw`auth\jwt\context.md`
      const result = toUnixPath(input)

      if (process.platform === 'win32') {
        expect(result).to.equal('auth/jwt/context.md')
      } else {
        // On Unix, backslashes are valid filename characters, so they stay
        expect(result).to.equal(input)
      }
    })

    it('should handle mixed separators', () => {
      const input = String.raw`auth/jwt\context.md`
      const result = toUnixPath(input)

      if (process.platform === 'win32') {
        expect(result).to.equal('auth/jwt/context.md')
      } else {
        expect(result).to.equal(input)
      }
    })

    it('should handle nested paths with backslashes', () => {
      const input = String.raw`level1\level2\level3\context.md`
      const result = toUnixPath(input)

      if (process.platform === 'win32') {
        expect(result).to.equal('level1/level2/level3/context.md')
      } else {
        expect(result).to.equal(input)
      }
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

      if (process.platform === 'win32') {
        expect(result).to.equal('.hidden/subfolder/context.md')
      } else {
        expect(result).to.equal(input)
      }
    })
  })
})
