import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {clearDirectory, sanitizeFilePath} from '../../../src/utils/file-helpers.js'

describe('file-helpers', () => {
  describe('clearDirectory()', () => {
    let testDir: string

    beforeEach(async () => {
      // Create a unique temporary directory for each test
      testDir = join(tmpdir(), `test-clear-dir-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
      await mkdir(testDir, {recursive: true})
    })

    afterEach(async () => {
      // Clean up test directory
      if (existsSync(testDir)) {
        await rm(testDir, {force: true, recursive: true})
      }
    })

    it('should remove all files from directory and return count', async () => {
      // Create test files
      await writeFile(join(testDir, 'file1.json'), '{}', 'utf8')
      await writeFile(join(testDir, 'file2.json'), '{}', 'utf8')
      await writeFile(join(testDir, 'file3.txt'), 'test', 'utf8')

      // Clear the directory
      const count = await clearDirectory(testDir)

      // Verify all files were removed
      expect(count).to.equal(3)
      expect(existsSync(join(testDir, 'file1.json'))).to.be.false
      expect(existsSync(join(testDir, 'file2.json'))).to.be.false
      expect(existsSync(join(testDir, 'file3.txt'))).to.be.false
    })

    it('should preserve the directory itself', async () => {
      // Create test files
      await writeFile(join(testDir, 'file1.json'), '{}', 'utf8')

      // Verify directory exists
      expect(existsSync(testDir)).to.be.true

      // Clear the directory
      await clearDirectory(testDir)

      // Directory should still exist
      expect(existsSync(testDir)).to.be.true
    })

    it('should return 0 for empty directory', async () => {
      // Clear empty directory
      const count = await clearDirectory(testDir)

      // Should return 0
      expect(count).to.equal(0)
      expect(existsSync(testDir)).to.be.true
    })

    it('should return 0 for non-existent directory', async () => {
      const nonExistentDir = join(testDir, 'does-not-exist')

      // Clear non-existent directory
      const count = await clearDirectory(nonExistentDir)

      // Should return 0 and not throw
      expect(count).to.equal(0)
    })

    it('should not remove subdirectories (only files)', async () => {
      // Create files and subdirectory
      await writeFile(join(testDir, 'file1.json'), '{}', 'utf8')
      await mkdir(join(testDir, 'subdir'))
      await writeFile(join(testDir, 'subdir', 'nested.json'), '{}', 'utf8')

      // Clear the directory
      const count = await clearDirectory(testDir)

      // Should only remove the file, not the subdirectory
      expect(count).to.equal(1)
      expect(existsSync(join(testDir, 'file1.json'))).to.be.false
      expect(existsSync(join(testDir, 'subdir'))).to.be.true
      expect(existsSync(join(testDir, 'subdir', 'nested.json'))).to.be.true
    })

    it('should handle multiple file types', async () => {
      // Create various file types
      await writeFile(join(testDir, 'data.json'), '{}', 'utf8')
      await writeFile(join(testDir, 'script.js'), 'console.log("test")', 'utf8')
      await writeFile(join(testDir, 'README.md'), '# Test', 'utf8')
      await writeFile(join(testDir, 'config.yaml'), 'key: value', 'utf8')

      // Clear the directory
      const count = await clearDirectory(testDir)

      // All files should be removed
      expect(count).to.equal(4)
      expect(existsSync(join(testDir, 'data.json'))).to.be.false
      expect(existsSync(join(testDir, 'script.js'))).to.be.false
      expect(existsSync(join(testDir, 'README.md'))).to.be.false
      expect(existsSync(join(testDir, 'config.yaml'))).to.be.false
    })

    it('should handle hidden files', async () => {
      // Create hidden and normal files
      await writeFile(join(testDir, '.hidden'), 'hidden content', 'utf8')
      await writeFile(join(testDir, 'visible.txt'), 'visible content', 'utf8')

      // Clear the directory
      const count = await clearDirectory(testDir)

      // Both files should be removed
      expect(count).to.equal(2)
      expect(existsSync(join(testDir, '.hidden'))).to.be.false
      expect(existsSync(join(testDir, 'visible.txt'))).to.be.false
    })
  })

  describe('sanitizeFilePath()', () => {
    it('should sanitize file path with spaces', () => {
      expect(sanitizeFilePath('Use Case Analysis')).to.equal('Use-Case-Analysis')
      expect(sanitizeFilePath('Use Case Analysis_txt')).to.equal('Use-Case-Analysis_txt')
    })
  })
})
