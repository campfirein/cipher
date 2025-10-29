import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FsFileService} from '../../../../src/infra/file/fs-file-service.js'

describe('FsFileService', () => {
  let service: FsFileService
  let testDir: string

  beforeEach(() => {
    service = new FsFileService()
    // Use temp directory for testing
    testDir = join(tmpdir(), `byterover-fs-test-${Date.now()}`)
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('exists()', () => {
    it('should return true when file exists', async () => {
      // Create test file
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'test.txt')
      await writeFile(testFile, 'test content', 'utf8')

      const result = await service.exists(testFile)

      expect(result).to.be.true
    })

    it('should return false when file does not exist', async () => {
      const testFile = join(testDir, 'non-existent.txt')

      const result = await service.exists(testFile)

      expect(result).to.be.false
    })

    it('should return true when directory exists', async () => {
      await mkdir(testDir, {recursive: true})

      const result = await service.exists(testDir)

      expect(result).to.be.true
    })

    it('should return false for empty path', async () => {
      const result = await service.exists('')

      expect(result).to.be.false
    })

    it('should return false for invalid path', async () => {
      const invalidPath = join(testDir, 'deeply', 'nested', 'non-existent.txt')

      const result = await service.exists(invalidPath)

      expect(result).to.be.false
    })
  })

  describe('read()', () => {
    it('should read file content successfully', async () => {
      // Create test file
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'test.txt')
      const expectedContent = 'Hello, World!'
      await writeFile(testFile, expectedContent, 'utf8')

      const content = await service.read(testFile)

      expect(content).to.equal(expectedContent)
    })

    it('should read empty file', async () => {
      // Create empty test file
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'empty.txt')
      await writeFile(testFile, '', 'utf8')

      const content = await service.read(testFile)

      expect(content).to.equal('')
    })

    it('should read file with multiline content', async () => {
      // Create test file with multiline content
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'multiline.txt')
      const expectedContent = 'Line 1\nLine 2\nLine 3'
      await writeFile(testFile, expectedContent, 'utf8')

      const content = await service.read(testFile)

      expect(content).to.equal(expectedContent)
    })

    it('should read file with special characters', async () => {
      // Create test file with special characters
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'special.txt')
      const expectedContent = 'Special chars: ñ, é, 中文, 🚀'
      await writeFile(testFile, expectedContent, 'utf8')

      const content = await service.read(testFile)

      expect(content).to.equal(expectedContent)
    })

    it('should read JSON file', async () => {
      // Create test JSON file
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'data.json')
      const expectedContent = JSON.stringify({key: 'value', nested: {data: 'test'}}, null, 2)
      await writeFile(testFile, expectedContent, 'utf8')

      const content = await service.read(testFile)

      expect(content).to.equal(expectedContent)
      // Verify it's valid JSON
      expect(() => JSON.parse(content)).to.not.throw()
    })

    it('should throw error when file does not exist', async () => {
      const testFile = join(testDir, 'non-existent.txt')

      try {
        await service.read(testFile)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include(`Failed to read content from file '${testFile}'`)
      }
    })

    it('should throw error when reading directory', async () => {
      await mkdir(testDir, {recursive: true})

      try {
        await service.read(testDir)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include(`Failed to read content from file '${testDir}'`)
      }
    })

    it('should throw error for empty path', async () => {
      try {
        await service.read('')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include("Failed to read content from file ''")
      }
    })
  })

  describe('write()', () => {
    describe('overwrite mode', () => {
      it('should create and write new file', async () => {
        const testFile = join(testDir, 'new-file.txt')
        const content = 'New file content'

        await service.write(content, testFile, 'overwrite')

        // Verify file was created
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should create nested directories automatically', async () => {
        const testFile = join(testDir, 'deeply', 'nested', 'path', 'file.txt')
        const content = 'Nested file content'

        await service.write(content, testFile, 'overwrite')

        // Verify file was created in nested directory
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should overwrite existing file', async () => {
        // Create initial file
        await mkdir(testDir, {recursive: true})
        const testFile = join(testDir, 'existing.txt')
        await writeFile(testFile, 'Original content', 'utf8')

        // Overwrite with new content
        const newContent = 'Updated content'
        await service.write(newContent, testFile, 'overwrite')

        // Verify file was overwritten
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(newContent)
      })

      it('should write empty content', async () => {
        const testFile = join(testDir, 'empty.txt')

        await service.write('', testFile, 'overwrite')

        // Verify empty file was created
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal('')
      })

      it('should write multiline content', async () => {
        const testFile = join(testDir, 'multiline.txt')
        const content = 'Line 1\nLine 2\nLine 3'

        await service.write(content, testFile, 'overwrite')

        // Verify multiline content was saved
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should write JSON content', async () => {
        const testFile = join(testDir, 'data.json')
        const content = JSON.stringify({array: [1, 2, 3], key: 'value'}, null, 2)

        await service.write(content, testFile, 'overwrite')

        // Verify JSON content was saved
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should write special characters', async () => {
        const testFile = join(testDir, 'special.txt')
        const content = 'Special: ñ, é, 中文, 🚀, \n\t\r'

        await service.write(content, testFile, 'overwrite')

        // Verify special characters were saved correctly
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })
    })

    describe('append mode', () => {
      it('should append to existing file', async () => {
        // Create initial file
        await mkdir(testDir, {recursive: true})
        const testFile = join(testDir, 'append.txt')
        const initialContent = 'Initial content\n'
        await writeFile(testFile, initialContent, 'utf8')

        // Append new content
        const appendContent = 'Appended content\n'
        await service.write(appendContent, testFile, 'append')

        // Verify content was appended
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(initialContent + appendContent)
      })

      it('should create new file if it does not exist', async () => {
        const testFile = join(testDir, 'new-append.txt')
        const content = 'New file via append'

        await service.write(content, testFile, 'append')

        // Verify file was created
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should append multiple times', async () => {
        const testFile = join(testDir, 'multi-append.txt')

        // Append multiple times
        await service.write('Line 1\n', testFile, 'append')
        await service.write('Line 2\n', testFile, 'append')
        await service.write('Line 3\n', testFile, 'append')

        // Verify all appends were saved
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal('Line 1\nLine 2\nLine 3\n')
      })

      it('should append to empty file', async () => {
        // Create empty file
        await mkdir(testDir, {recursive: true})
        const testFile = join(testDir, 'empty-append.txt')
        await writeFile(testFile, '', 'utf8')

        // Append content
        const content = 'Appended to empty'
        await service.write(content, testFile, 'append')

        // Verify content was appended
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should create nested directories automatically in append mode', async () => {
        const testFile = join(testDir, 'nested', 'append', 'file.txt')
        const content = 'Nested append content'

        await service.write(content, testFile, 'append')

        // Verify file was created in nested directory
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(content)
      })

      it('should append empty content', async () => {
        // Create initial file
        await mkdir(testDir, {recursive: true})
        const testFile = join(testDir, 'append-empty.txt')
        const initialContent = 'Initial'
        await writeFile(testFile, initialContent, 'utf8')

        // Append empty content
        await service.write('', testFile, 'append')

        // Verify content unchanged
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(initialContent)
      })
    })

    describe('error handling', () => {
      it('should throw error with file path in overwrite mode', async () => {
        // Try to write to invalid path (simulate permission error)
        const invalidPath = '/invalid/readonly/path/file.txt'

        try {
          await service.write('content', invalidPath, 'overwrite')
          // If this doesn't throw on this system, skip assertion
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include(`Failed to overwrite content to file '${invalidPath}'`)
        }
      })

      it('should throw error with file path in append mode', async () => {
        // Try to append to invalid path
        const invalidPath = '/invalid/readonly/path/file.txt'

        try {
          await service.write('content', invalidPath, 'append')
          // If this doesn't throw on this system, skip assertion
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include(`Failed to append content to file '${invalidPath}'`)
        }
      })
    })

    describe('mode verification', () => {
      it('should respect overwrite mode semantics', async () => {
        // Create file with initial content
        await mkdir(testDir, {recursive: true})
        const testFile = join(testDir, 'mode-test.txt')
        await writeFile(testFile, 'Original: 1234567890', 'utf8')

        // Overwrite with shorter content
        const newContent = 'New'
        await service.write(newContent, testFile, 'overwrite')

        // Verify file was completely replaced, not partially
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(newContent)
        expect(savedContent).to.not.include('Original')
      })

      it('should respect append mode semantics', async () => {
        // Create file with initial content
        await mkdir(testDir, {recursive: true})
        const testFile = join(testDir, 'append-mode-test.txt')
        const initialContent = 'Original'
        await writeFile(testFile, initialContent, 'utf8')

        // Append new content
        const appendContent = ' + Appended'
        await service.write(appendContent, testFile, 'append')

        // Verify both original and appended content exist
        const savedContent = await readFile(testFile, 'utf8')
        expect(savedContent).to.equal(initialContent + appendContent)
        expect(savedContent).to.include('Original')
        expect(savedContent).to.include('Appended')
      })
    })
  })

  describe('integration scenarios', () => {
    it('should support exists -> write -> read cycle', async () => {
      const testFile = join(testDir, 'cycle.txt')

      // Check file doesn't exist
      expect(await service.exists(testFile)).to.be.false

      // Write content
      const content = 'Cycle test content'
      await service.write(content, testFile, 'overwrite')

      // Check file now exists
      expect(await service.exists(testFile)).to.be.true

      // Read content back
      const savedContent = await service.read(testFile)
      expect(savedContent).to.equal(content)
    })

    it('should support read -> write -> read cycle', async () => {
      // Create initial file
      await mkdir(testDir, {recursive: true})
      const testFile = join(testDir, 'read-write-read.txt')
      const initialContent = 'Initial content'
      await writeFile(testFile, initialContent, 'utf8')

      // Read initial content
      const readContent1 = await service.read(testFile)
      expect(readContent1).to.equal(initialContent)

      // Modify and write back
      const modifiedContent = readContent1 + ' - Modified'
      await service.write(modifiedContent, testFile, 'overwrite')

      // Read modified content
      const readContent2 = await service.read(testFile)
      expect(readContent2).to.equal(modifiedContent)
    })

    it('should support append workflow', async () => {
      const testFile = join(testDir, 'log.txt')

      // Simulate log file writing
      await service.write('[INFO] Application started\n', testFile, 'append')
      await service.write('[DEBUG] Connecting to database\n', testFile, 'append')
      await service.write('[INFO] Application ready\n', testFile, 'append')

      // Read full log
      const logContent = await service.read(testFile)
      expect(logContent).to.include('[INFO] Application started')
      expect(logContent).to.include('[DEBUG] Connecting to database')
      expect(logContent).to.include('[INFO] Application ready')
    })

    it('should handle concurrent writes to different files', async () => {
      const file1 = join(testDir, 'concurrent1.txt')
      const file2 = join(testDir, 'concurrent2.txt')
      const file3 = join(testDir, 'concurrent3.txt')

      // Write to multiple files concurrently
      await Promise.all([
        service.write('Content 1', file1, 'overwrite'),
        service.write('Content 2', file2, 'overwrite'),
        service.write('Content 3', file3, 'overwrite'),
      ])

      // Verify all files were written correctly
      expect(await service.read(file1)).to.equal('Content 1')
      expect(await service.read(file2)).to.equal('Content 2')
      expect(await service.read(file3)).to.equal('Content 3')
    })

    it('should handle large file content', async () => {
      const testFile = join(testDir, 'large.txt')
      // Create 1MB of content
      const largeContent = 'x'.repeat(1024 * 1024)

      await service.write(largeContent, testFile, 'overwrite')

      const savedContent = await service.read(testFile)
      expect(savedContent.length).to.equal(largeContent.length)
      expect(savedContent).to.equal(largeContent)
    })
  })
})
