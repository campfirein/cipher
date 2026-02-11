import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {getProjectDataDir, resolvePath, sanitizeProjectPath} from '../../../src/server/utils/path-utils.js'

describe('path-utils', () => {
  describe('resolvePath()', () => {
    let tempDir: string

    beforeEach(() => {
      // Use realpathSync to get canonical path (e.g., /var → /private/var on macOS)
      tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-path-test-')))
    })

    it('should resolve a real directory path', () => {
      const result = resolvePath(tempDir)

      expect(result).to.equal(tempDir)
    })

    it('should resolve symlinks to their target', () => {
      const targetDir = join(tempDir, 'target')
      mkdirSync(targetDir)
      const linkPath = join(tempDir, 'link')
      symlinkSync(targetDir, linkPath)

      const result = resolvePath(linkPath)

      expect(result).to.equal(targetDir)
    })

    it('should throw for non-existent path', () => {
      expect(() => resolvePath('/nonexistent/path/xyz')).to.throw()
    })
  })

  describe('sanitizeProjectPath()', () => {
    it('should strip leading slash and replace separators', () => {
      const result = sanitizeProjectPath('/users/foo/my-project')

      expect(result).to.equal('users--foo--my-project')
    })

    it('should strip trailing slash', () => {
      const result = sanitizeProjectPath('/users/foo/project/')

      expect(result).to.equal('users--foo--project')
    })

    it('should handle multiple consecutive separators', () => {
      const result = sanitizeProjectPath('/users///foo//bar')

      expect(result).to.equal('users--foo--bar')
    })

    it('should handle Windows-style drive letter', () => {
      const result = sanitizeProjectPath(String.raw`C:\users\foo\project`)

      expect(result).to.equal('C--users--foo--project')
    })

    it('should produce different names for different paths', () => {
      const a = sanitizeProjectPath('/users/foo/project-a')
      const b = sanitizeProjectPath('/users/foo/project-b')

      expect(a).to.not.equal(b)
    })

    it('should return empty string for root path', () => {
      const result = sanitizeProjectPath('/')

      expect(result).to.equal('')
    })

    it('should not collide when component contains double dash', () => {
      const a = sanitizeProjectPath('/users/foo--bar')
      const b = sanitizeProjectPath('/users/foo/bar')

      expect(a).to.not.equal(b)
      expect(a).to.equal('users--foo%2D%2Dbar')
      expect(b).to.equal('users--foo--bar')
    })

    it('should encode percent signs to prevent double-encoding', () => {
      const result = sanitizeProjectPath('/users/foo%25bar')

      expect(result).to.equal('users--foo%2525bar')
    })

    it('should encode angle brackets illegal on Windows', () => {
      const result = sanitizeProjectPath('/home/user/my<project>')

      expect(result).to.equal('home--user--my%3Cproject%3E')
    })

    it('should encode colon in path components', () => {
      const result = sanitizeProjectPath('/home/user/file:2024')

      expect(result).to.equal('home--user--file%3A2024')
    })

    it('should encode all Windows-illegal characters', () => {
      const result = sanitizeProjectPath('/a/<>|"?*:')

      expect(result).to.equal('a--%3C%3E%7C%22%3F%2A%3A')
    })

    it('should truncate excessively long paths with hash suffix', () => {
      const longPath = '/' + Array.from({length: 50}, (_, i) => `component${i}`).join('/')
      const result = sanitizeProjectPath(longPath)

      expect(result.length).to.be.at.most(200)
      expect(result).to.match(/---[a-f\d]{12}$/)
    })

    it('should produce different truncated names for different long paths', () => {
      const base = '/' + Array.from({length: 50}, (_, i) => `component${i}`).join('/')
      const variant = base + '/extra'

      const a = sanitizeProjectPath(base)
      const b = sanitizeProjectPath(variant)

      expect(a).to.not.equal(b)
    })

    it('should not truncate paths within the length limit', () => {
      const result = sanitizeProjectPath('/home/user/project')

      expect(result).to.not.match(/---[a-f\d]{12}$/)
    })

    it('should preserve Unicode characters in path components', () => {
      const result = sanitizeProjectPath('/Users/名前/project')

      expect(result).to.equal('Users--名前--project')
    })

    it('should handle Windows UNC paths', () => {
      const result = sanitizeProjectPath(String.raw`\\server\share\path`)

      expect(result).to.equal('server--share--path')
    })
  })

  describe('getProjectDataDir()', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-projdir-test-')))
    })

    it('should return a path containing the projects directory', () => {
      const result = getProjectDataDir(tempDir)

      expect(result).to.include('projects')
    })

    it('should return a path containing the sanitized project name', () => {
      const result = getProjectDataDir(tempDir)
      const resolved = resolvePath(tempDir)
      const sanitized = sanitizeProjectPath(resolved)

      expect(result).to.include(sanitized)
    })

    it('should return different directories for different cwds', () => {
      const dirA = join(tempDir, 'a')
      const dirB = join(tempDir, 'b')
      mkdirSync(dirA)
      mkdirSync(dirB)

      const resultA = getProjectDataDir(dirA)
      const resultB = getProjectDataDir(dirB)

      expect(resultA).to.not.equal(resultB)
    })
  })
})
