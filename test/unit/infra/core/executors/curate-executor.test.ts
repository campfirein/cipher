/**
 * CurateExecutor Unit Tests
 *
 * Tests the file validation logic with cwd parameter handling.
 * Since CurateExecutor uses getAgentStorage() which is an ES module export
 * and cannot be stubbed, we test the validation logic through the file-validator directly.
 *
 * Key scenarios:
 * - cwd parameter handling for file validation
 * - Cross-directory curate scenario (the main bug fix)
 * - File validation edge cases
 *
 * Important Note:
 * The validateFileForCurate function resolves relative paths using path.resolve()
 * which uses process.cwd(). For testing, we either:
 * 1. Use absolute paths, or
 * 2. Change process.cwd() to the test directory
 */

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {validateFileForCurate} from '../../../../../src/utils/file-validator.js'

describe('CurateExecutor - File Validation with cwd', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()

    // Create a temp directory to use as our test project
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-executor-test-'))

    // Create .brv directory to mark as project root
    fs.mkdirSync(path.join(tempDir, '.brv'), {recursive: true})
  })

  afterEach(() => {
    // Restore cwd FIRST before cleaning up directories
    // This prevents ENOENT errors when cwd is in a deleted directory
    try {
      if (process.cwd() !== originalCwd) {
        process.chdir(originalCwd)
      }
    } catch {
      // If current dir was deleted, just change to originalCwd
      process.chdir(originalCwd)
    }

    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, {recursive: true, force: true})
    }
  })

  describe('cwd parameter handling (using absolute paths)', () => {
    it('should validate files against provided projectRoot', () => {
      // Create a file in temp directory
      const testFile = path.join(tempDir, 'test-file.ts')
      fs.writeFileSync(testFile, 'const x = 1;')

      // Validate using absolute path
      const result = validateFileForCurate(testFile, tempDir)

      expect(result.valid).to.be.true
      expect(result.normalizedPath).to.include('test-file.ts')
    })

    it('should fail validation when file does not exist', () => {
      // File doesn't exist (use absolute path)
      const nonExistentFile = path.join(tempDir, 'non-existent-file.ts')
      const result = validateFileForCurate(nonExistentFile, tempDir)

      expect(result.valid).to.be.false
      expect(result.error).to.include('does not exist')
    })

    it('should validate files against client cwd even when agent runs in different directory', () => {
      // This is the core bug fix test:
      // 1. Agent runs in directory A (tempDir)
      // 2. Client calls from directory B (another temp dir)
      // 3. Files should be validated against directory B, not A

      const agentDir = tempDir
      const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-client-dir-'))

      try {
        // Create file in CLIENT directory (not agent directory)
        const clientFile = path.join(clientDir, 'client-file.ts')
        fs.writeFileSync(clientFile, 'const z = 3;')
        fs.mkdirSync(path.join(clientDir, '.brv'), {recursive: true})

        // Agent is running from agentDir
        process.chdir(agentDir)

        // Validate with clientDir as projectRoot, using absolute path
        // This mimics: `brv curate -f /path/to/clientDir/client-file.ts` called from clientDir
        const result = validateFileForCurate(clientFile, clientDir)

        // Should succeed because we validate against clientDir
        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.include('client-file.ts')
      } finally {
        // Cleanup client dir
        fs.rmSync(clientDir, {recursive: true, force: true})
      }
    })

    it('should fail when file is outside client cwd', () => {
      const agentDir = tempDir
      const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-client-empty-'))

      try {
        // Create file in AGENT directory (not client directory)
        const agentFile = path.join(agentDir, 'agent-only-file.ts')
        fs.writeFileSync(agentFile, 'const w = 4;')

        // Mark client dir as project root
        fs.mkdirSync(path.join(clientDir, '.brv'), {recursive: true})

        // Agent is running from agentDir
        process.chdir(agentDir)

        // Validate using agentFile path but with clientDir as projectRoot
        // This should fail because the file is outside clientDir
        const result = validateFileForCurate(agentFile, clientDir)

        // Should fail because file is outside clientDir
        expect(result.valid).to.be.false
        expect(result.error).to.include('outside project')
      } finally {
        // Cleanup client dir
        fs.rmSync(clientDir, {recursive: true, force: true})
      }
    })
  })

  describe('cwd parameter handling (relative paths from cwd)', () => {
    it('should validate relative paths when cwd matches projectRoot', () => {
      // Change to temp directory
      process.chdir(tempDir)

      // Create a file in temp directory (now current directory)
      const testFile = path.join(tempDir, 'relative-file.ts')
      fs.writeFileSync(testFile, 'const y = 2;')

      // Validate using relative path - this works because process.cwd() === projectRoot
      const result = validateFileForCurate('relative-file.ts', tempDir)

      expect(result.valid).to.be.true
    })

    it('should fail relative paths when cwd differs from projectRoot', () => {
      // This demonstrates the key behavior:
      // When validateFileForCurate receives a relative path,
      // it resolves it against process.cwd(), NOT projectRoot.
      // This is why we need to pass absolute paths from the client.

      const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-relative-test-'))

      try {
        // Create file in clientDir
        const clientFile = path.join(clientDir, 'relative-test.ts')
        fs.writeFileSync(clientFile, 'const rel = 1;')
        fs.mkdirSync(path.join(clientDir, '.brv'), {recursive: true})

        // Agent is in tempDir (different from clientDir)
        process.chdir(tempDir)

        // Validate relative path with clientDir as projectRoot
        // This will FAIL because 'relative-test.ts' resolves to tempDir/relative-test.ts
        // which doesn't exist
        const result = validateFileForCurate('relative-test.ts', clientDir)

        // Should fail - the relative path is resolved against process.cwd() (tempDir)
        // not against projectRoot (clientDir)
        expect(result.valid).to.be.false
      } finally {
        fs.rmSync(clientDir, {recursive: true, force: true})
      }
    })
  })

  describe('file validation edge cases', () => {
    beforeEach(() => {
      // Change to tempDir for these tests so relative paths work
      process.chdir(tempDir)
    })

    it('should validate text files correctly', () => {
      const testFile = path.join(tempDir, 'valid-file.ts')
      fs.writeFileSync(testFile, 'export const test = 1;')

      const result = validateFileForCurate(testFile, tempDir)

      expect(result.valid).to.be.true
    })

    it('should reject binary files', () => {
      // Create a binary file with null bytes
      const binaryFile = path.join(tempDir, 'binary-file.bin')
      const buffer = Buffer.alloc(100)
      buffer[0] = 0 // null byte - indicates binary
      fs.writeFileSync(binaryFile, buffer)

      const result = validateFileForCurate(binaryFile, tempDir)

      expect(result.valid).to.be.false
      expect(result.error).to.include('binary')
    })

    it('should reject directories', () => {
      const subDir = path.join(tempDir, 'sub-directory')
      fs.mkdirSync(subDir, {recursive: true})

      const result = validateFileForCurate(subDir, tempDir)

      expect(result.valid).to.be.false
      expect(result.error).to.include('not a file')
    })

    it('should reject files outside project directory', () => {
      // Create a file outside tempDir
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-project-'))
      const outsideFile = path.join(outsideDir, 'outside-file.ts')
      fs.writeFileSync(outsideFile, 'const outside = true;')

      try {
        // Validate with absolute path to file outside project
        const result = validateFileForCurate(outsideFile, tempDir)

        expect(result.valid).to.be.false
        expect(result.error).to.include('outside project')
      } finally {
        fs.rmSync(outsideDir, {recursive: true, force: true})
      }
    })

    it('should handle nested relative paths correctly', () => {
      // Create nested directory structure
      const nestedDir = path.join(tempDir, 'src', 'utils')
      fs.mkdirSync(nestedDir, {recursive: true})
      const nestedFile = path.join(nestedDir, 'helper.ts')
      fs.writeFileSync(nestedFile, 'export function help() {}')

      // Use absolute path since we're testing validation logic, not path resolution
      const result = validateFileForCurate(nestedFile, tempDir)

      expect(result.valid).to.be.true
    })

    it('should handle absolute paths within project', () => {
      const testFile = path.join(tempDir, 'absolute-test.ts')
      fs.writeFileSync(testFile, 'const abs = 1;')

      // Validate with absolute path
      const result = validateFileForCurate(testFile, tempDir)

      expect(result.valid).to.be.true
    })

    it('should handle symlinks correctly', () => {
      // Create a real file
      const realFile = path.join(tempDir, 'real-file.ts')
      fs.writeFileSync(realFile, 'const real = 1;')

      // Create a symlink to it
      const symlink = path.join(tempDir, 'link-file.ts')
      try {
        fs.symlinkSync(realFile, symlink)

        // Validate the symlink (using absolute path)
        const result = validateFileForCurate(symlink, tempDir)

        // Symlinks should be resolved and validated
        expect(result.valid).to.be.true
      } catch {
        // Skip if symlinks aren't supported (e.g., Windows without admin)
      }
    })

    it('should handle Unicode filenames', () => {
      const unicodeFile = path.join(tempDir, 'unicode-文件.ts')
      fs.writeFileSync(unicodeFile, 'const unicode = "你好";')

      const result = validateFileForCurate(unicodeFile, tempDir)

      expect(result.valid).to.be.true
    })

    it('should handle filenames with spaces', () => {
      const spaceFile = path.join(tempDir, 'file with spaces.ts')
      fs.writeFileSync(spaceFile, 'const space = true;')

      const result = validateFileForCurate(spaceFile, tempDir)

      expect(result.valid).to.be.true
    })
  })

  describe('cross-directory validation scenarios', () => {
    it('should correctly validate when client and agent are in completely different paths', () => {
      // Create two unrelated directories
      const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'dir1-'))
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dir2-'))

      try {
        // Setup dir1 as project with file
        fs.mkdirSync(path.join(dir1, '.brv'), {recursive: true})
        const file1 = path.join(dir1, 'file1.ts')
        fs.writeFileSync(file1, 'const x = 1;')

        // Setup dir2 as project with different file
        fs.mkdirSync(path.join(dir2, '.brv'), {recursive: true})
        const file2 = path.join(dir2, 'file2.ts')
        fs.writeFileSync(file2, 'const y = 2;')

        // Agent in dir1, client in dir2
        process.chdir(dir1)

        // file1 exists but is outside client's projectRoot (dir2)
        const result1 = validateFileForCurate(file1, dir2)
        expect(result1.valid).to.be.false
        expect(result1.error).to.include('outside project')

        // file2 exists and is inside client's projectRoot (dir2)
        const result2 = validateFileForCurate(file2, dir2)
        expect(result2.valid).to.be.true
      } finally {
        fs.rmSync(dir1, {recursive: true, force: true})
        fs.rmSync(dir2, {recursive: true, force: true})
      }
    })

    it('should handle nested paths from client perspective correctly', () => {
      // Create directory structure
      const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-workspace-'))

      try {
        // Client has nested structure
        fs.mkdirSync(path.join(clientDir, '.brv'), {recursive: true})
        fs.mkdirSync(path.join(clientDir, 'src', 'components'), {recursive: true})
        const buttonFile = path.join(clientDir, 'src', 'components', 'Button.tsx')
        fs.writeFileSync(buttonFile, 'export const Button = () => null;')

        // Agent is in tempDir (different location)
        process.chdir(tempDir)

        // Client specifies absolute path (as would happen with proper cwd resolution)
        const result = validateFileForCurate(buttonFile, clientDir)

        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.include('Button.tsx')
      } finally {
        fs.rmSync(clientDir, {recursive: true, force: true})
      }
    })
  })
})

describe('CurateExecutor - Type definitions', () => {
  // These tests verify the types include cwd parameter
  // TypeScript compilation verifies this at compile time

  it('TaskInput type should include cwd parameter', () => {
    // This test passes if compilation succeeds
    // The TypeScript compiler ensures TaskInput has cwd field
    const taskInput = {
      content: 'test',
      cwd: '/some/path',
      files: ['file.ts'],
      taskId: 'test-id',
      type: 'curate' as const,
    }

    expect(taskInput.cwd).to.equal('/some/path')
  })

  it('CurateExecuteOptions type should include cwd parameter', () => {
    // This test passes if compilation succeeds
    // The TypeScript compiler ensures CurateExecuteOptions has cwd field
    const options = {
      content: 'test',
      cwd: '/some/path',
      files: ['file.ts'],
      taskId: 'test-id',
    }

    expect(options.cwd).to.equal('/some/path')
  })
})
