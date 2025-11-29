import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {clearDirectory, sanitizeFolderName} from '../../../src/utils/file-helpers.js'

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

  describe('santizeFolderName()', () => {
    it('should sanitize folder name with spaces', () => {
      expect(sanitizeFolderName('Use Case Analysis')).to.equal('Use-Case-Analysis')
      expect(sanitizeFolderName('Use Case Analysis_txt')).to.equal('Use-Case-Analysis_txt')
    })

    it('should preserve allowed characters (letters, numbers, underscore, hyphen, dot, slash)', () => {
      expect(sanitizeFolderName('folder_name-123')).to.equal('folder_name-123')
      expect(sanitizeFolderName('test.folder')).to.equal('test.folder')
      expect(sanitizeFolderName('path/to/folder')).to.equal('path/to/folder')
      expect(sanitizeFolderName('my-folder_123.txt')).to.equal('my-folder_123.txt')
    })

    it('should replace special characters with hyphen', () => {
      expect(sanitizeFolderName('folder@name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder#name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder$name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder%name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder&name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder*name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder+name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder=name')).to.equal('folder-name')
    })

    it('should handle multiple consecutive special characters', () => {
      expect(sanitizeFolderName('folder@@@name')).to.equal('folder---name')
      expect(sanitizeFolderName('folder   name')).to.equal('folder---name')
      expect(sanitizeFolderName('folder!!!name')).to.equal('folder---name')
    })

    it('should handle leading and trailing special characters', () => {
      expect(sanitizeFolderName('@folder')).to.equal('-folder')
      expect(sanitizeFolderName('folder@')).to.equal('folder-')
      expect(sanitizeFolderName('@folder@')).to.equal('-folder-')
      expect(sanitizeFolderName('  folder  ')).to.equal('--folder--')
    })

    it('should preserve forward slashes in paths', () => {
      expect(sanitizeFolderName('path/to/folder')).to.equal('path/to/folder')
      expect(sanitizeFolderName('path/to/my folder')).to.equal('path/to/my-folder')
      expect(sanitizeFolderName('path/to/folder@name')).to.equal('path/to/folder-name')
    })

    it('should preserve dots in filenames', () => {
      expect(sanitizeFolderName('folder.name')).to.equal('folder.name')
      expect(sanitizeFolderName('my.folder.name')).to.equal('my.folder.name')
      expect(sanitizeFolderName('folder.name@test')).to.equal('folder.name-test')
    })

    it('should handle empty string', () => {
      expect(sanitizeFolderName('')).to.equal('')
    })

    it('should handle string with only special characters', () => {
      expect(sanitizeFolderName('@@@')).to.equal('---')
      expect(sanitizeFolderName('   ')).to.equal('---')
      expect(sanitizeFolderName('!!!')).to.equal('---')
    })

    it('should handle unicode and emoji characters', () => {
      expect(sanitizeFolderName('folder🚀name')).to.equal('folder--name')
      expect(sanitizeFolderName('folder中文name')).to.equal('folder--name')
      expect(sanitizeFolderName('café-folder')).to.equal('caf--folder')
    })

    it('should handle brackets and parentheses', () => {
      expect(sanitizeFolderName('folder(name)')).to.equal('folder-name-')
      expect(sanitizeFolderName('folder[name]')).to.equal('folder-name-')
      expect(sanitizeFolderName('folder{name}')).to.equal('folder-name-')
    })

    it('should handle complex mixed scenarios', () => {
      expect(sanitizeFolderName('My Project (v1.0) - Final!')).to.equal('My-Project--v1.0----Final-')
      expect(sanitizeFolderName('path/to/my project@2024')).to.equal('path/to/my-project-2024')
      expect(sanitizeFolderName('test.folder_name-123')).to.equal('test.folder_name-123')
    })

    it('should not modify already sanitized names', () => {
      expect(sanitizeFolderName('valid-folder_name')).to.equal('valid-folder_name')
      expect(sanitizeFolderName('path/to/valid.folder')).to.equal('path/to/valid.folder')
      expect(sanitizeFolderName('123_folder-456')).to.equal('123_folder-456')
    })
  })
})
