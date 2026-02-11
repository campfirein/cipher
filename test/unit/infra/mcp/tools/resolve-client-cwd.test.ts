import {expect} from 'chai'

import {resolveClientCwd} from '../../../../../src/server/infra/mcp/tools/resolve-client-cwd.js'

const noWorkingDir = (): undefined => undefined

describe('resolveClientCwd', () => {
  describe('cwd resolution priority', () => {
    it('should use explicit cwd when provided', () => {
      const result = resolveClientCwd('/explicit/path', () => '/default/path')
      expect(result).to.deep.equal({clientCwd: '/explicit/path', success: true})
    })

    it('should fall back to working directory when cwd is undefined', () => {
      const result = resolveClientCwd(noWorkingDir(), () => '/default/path')
      expect(result).to.deep.equal({clientCwd: '/default/path', success: true})
    })

    it('should prefer explicit cwd over working directory', () => {
      const result = resolveClientCwd('/explicit', () => '/default')
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.clientCwd).to.equal('/explicit')
      }
    })
  })

  describe('global mode (no working directory)', () => {
    it('should return error when both cwd and working directory are undefined', () => {
      const result = resolveClientCwd(noWorkingDir(), noWorkingDir)
      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.error).to.include('cwd parameter is required')
        expect(result.error).to.include('global mode')
      }
    })

    it('should succeed in global mode when cwd is provided', () => {
      const result = resolveClientCwd('/project/path', noWorkingDir)
      expect(result).to.deep.equal({clientCwd: '/project/path', success: true})
    })
  })

  describe('path validation', () => {
    it('should reject relative paths', () => {
      const result = resolveClientCwd('relative/path', noWorkingDir)
      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.error).to.include('absolute path')
      }
    })

    it('should accept absolute paths', () => {
      const result = resolveClientCwd('/absolute/path', noWorkingDir)
      expect(result).to.deep.equal({clientCwd: '/absolute/path', success: true})
    })

    it('should not validate working directory path format (trusted source)', () => {
      // Working directory comes from process.cwd() which is always absolute
      // No validation needed for it
      const result = resolveClientCwd(noWorkingDir(), () => '/trusted/path')
      expect(result.success).to.be.true
    })
  })
})
