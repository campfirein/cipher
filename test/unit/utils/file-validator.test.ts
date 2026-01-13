import { expect } from 'chai'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { validateFileForCurate } from '../../../src/utils/file-validator.js'

describe('file-validator', () => {
  let testDir: string
  let testFile: string

  beforeEach(() => {
    // Create a unique test directory
    const rawTestDir = path.join(tmpdir(), `file-validator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(rawTestDir, { recursive: true })
    // Resolve symlinks (e.g., /var -> /private/var on macOS)
    testDir = realpathSync(rawTestDir)

    // Create a test text file
    testFile = path.join(testDir, 'test-file.txt')
    writeFileSync(testFile, 'Hello, this is a test file with some text content.')
  })

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { force: true, recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('validateFileForCurate()', () => {
    describe('path normalization with clientCwd (ENG-846 fix)', () => {
      it('should resolve relative paths against projectRoot, not process.cwd()', () => {
        // Create a subdirectory with a file
        const subDir = path.join(testDir, 'subdir')
        mkdirSync(subDir, { recursive: true })
        const fileInSubdir = path.join(subDir, 'file.txt')
        writeFileSync(fileInSubdir, 'content')

        // Validate with relative path, using testDir as projectRoot
        const result = validateFileForCurate('subdir/file.txt', testDir)

        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.equal(fileInSubdir)
      })

      it('should NOT use process.cwd() for relative path resolution', () => {
        // This is the core ENG-846 scenario:
        // - Client is in /Users/foo/project (clientCwd)
        // - Agent might be running from different directory
        // - Relative paths should resolve against clientCwd, not agent's cwd

        // Create file in testDir
        const file = path.join(testDir, 'myfile.txt')
        writeFileSync(file, 'content')

        // Precondition: Verify the file would NOT be found if resolved against process.cwd()
        // This ensures our test actually validates the fix
        const cwdResolved = path.resolve(process.cwd(), 'myfile.txt')
        expect(cwdResolved).to.not.equal(file)

        // Now verify our function correctly resolves against projectRoot
        const result = validateFileForCurate('myfile.txt', testDir)

        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.equal(file)
      })

      it('should handle nested relative paths correctly', () => {
        // Create nested directory structure
        const nestedDir = path.join(testDir, 'a', 'b', 'c')
        mkdirSync(nestedDir, { recursive: true })
        const nestedFile = path.join(nestedDir, 'deep.ts')
        writeFileSync(nestedFile, 'export const x = 1;')

        const result = validateFileForCurate('a/b/c/deep.ts', testDir)

        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.equal(nestedFile)
      })
    })

    describe('absolute path handling', () => {
      it('should accept absolute paths within project', () => {
        const result = validateFileForCurate(testFile, testDir)

        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.equal(testFile)
      })

      it('should reject absolute paths outside project', () => {
        // Create a file outside the project
        const rawOutsideDir = path.join(tmpdir(), `outside-${Date.now()}`)
        mkdirSync(rawOutsideDir, { recursive: true })
        const outsideDir = realpathSync(rawOutsideDir)
        const outsideFile = path.join(outsideDir, 'outside.txt')
        writeFileSync(outsideFile, 'outside content')

        try {
          const result = validateFileForCurate(outsideFile, testDir)

          expect(result.valid).to.be.false
          expect(result.error).to.include('outside project directory')
        } finally {
          rmSync(outsideDir, { force: true, recursive: true })
        }
      })
    })

    describe('tilde expansion', () => {
      it('should expand tilde to home directory and reject if outside project', () => {
        // Tilde paths typically point to home directory which is outside our test project
        const homeRelativePath = '~/.bashrc'
        const result = validateFileForCurate(homeRelativePath, testDir)

        // Should fail because home directory is outside testDir
        expect(result.valid).to.be.false
        // Error message should show the expanded path or indicate it's outside project
        /* eslint-disable max-nested-callbacks -- Chai assertion syntax requires callback */
        expect(result.error).to.satisfy(
          (err: string) => err.includes('does not exist') || err.includes('outside project directory')
        )
        /* eslint-enable max-nested-callbacks */
      })
    })

    describe('file existence validation', () => {
      it('should reject non-existent files', () => {
        const result = validateFileForCurate('non-existent-file.txt', testDir)

        expect(result.valid).to.be.false
        expect(result.error).to.include('does not exist')
      })

      it('should reject directories (not files)', () => {
        const subDir = path.join(testDir, 'a-directory')
        mkdirSync(subDir, { recursive: true })

        const result = validateFileForCurate('a-directory', testDir)

        expect(result.valid).to.be.false
        expect(result.error).to.include('not a file')
      })
    })

    describe('binary file detection', () => {
      it('should reject binary files', () => {
        // Create a binary file with null bytes
        const binaryFile = path.join(testDir, 'binary.bin')
        const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03])
        writeFileSync(binaryFile, binaryContent)

        const result = validateFileForCurate('binary.bin', testDir)

        expect(result.valid).to.be.false
        expect(result.error).to.include('File type not supported')
      })

      it('should accept text files', () => {
        const result = validateFileForCurate('test-file.txt', testDir)

        expect(result.valid).to.be.true
      })

      it('should accept source code files', () => {
        const sourceFile = path.join(testDir, 'source.ts')
        writeFileSync(sourceFile, 'export function hello(): string { return "world"; }')

        const result = validateFileForCurate('source.ts', testDir)

        expect(result.valid).to.be.true
      })

      it('should accept JSON files', () => {
        const jsonFile = path.join(testDir, 'config.json')
        writeFileSync(jsonFile, '{"key": "value", "number": 42}')

        const result = validateFileForCurate('config.json', testDir)

        expect(result.valid).to.be.true
      })
    })

    describe('project boundary validation', () => {
      it('should reject path traversal attempts', () => {
        // Try to escape project directory with ../
        const result = validateFileForCurate('../../../etc/passwd', testDir)

        expect(result.valid).to.be.false
        // Either "does not exist" or "outside project directory"
        /* eslint-disable max-nested-callbacks -- Chai assertion syntax requires callback */
        expect(result.error).to.satisfy(
          (err: string) => err.includes('does not exist') || err.includes('outside project directory')
        )
        /* eslint-enable max-nested-callbacks */
      })

      it('should accept files at project root', () => {
        const result = validateFileForCurate('test-file.txt', testDir)

        expect(result.valid).to.be.true
      })

      it('should accept files in subdirectories of project', () => {
        const subDir = path.join(testDir, 'src', 'utils')
        mkdirSync(subDir, { recursive: true })
        const utilFile = path.join(subDir, 'helper.ts')
        writeFileSync(utilFile, 'export const helper = () => {};')

        const result = validateFileForCurate('src/utils/helper.ts', testDir)

        expect(result.valid).to.be.true
        expect(result.normalizedPath).to.equal(utilFile)
      })
    })

    describe('edge cases', () => {
      it('should handle empty string path', () => {
        const result = validateFileForCurate('', testDir)

        expect(result.valid).to.be.false
      })

      it('should handle path with spaces', () => {
        const fileWithSpaces = path.join(testDir, 'file with spaces.txt')
        writeFileSync(fileWithSpaces, 'content with spaces in filename')

        const result = validateFileForCurate('file with spaces.txt', testDir)

        expect(result.valid).to.be.true
      })

      it('should handle path with special characters', () => {
        const specialFile = path.join(testDir, 'file-with_special.chars.test.ts')
        writeFileSync(specialFile, '// special chars')

        const result = validateFileForCurate('file-with_special.chars.test.ts', testDir)

        expect(result.valid).to.be.true
      })

      it('should handle hidden files (dotfiles)', () => {
        const dotfile = path.join(testDir, '.gitignore')
        writeFileSync(dotfile, 'node_modules\n.env')

        const result = validateFileForCurate('.gitignore', testDir)

        expect(result.valid).to.be.true
      })

      it('should handle deeply nested paths', () => {
        const deepPath = path.join(testDir, 'a', 'b', 'c', 'd', 'e', 'f')
        mkdirSync(deepPath, { recursive: true })
        const deepFile = path.join(deepPath, 'deep.txt')
        writeFileSync(deepFile, 'very deep file')

        const result = validateFileForCurate('a/b/c/d/e/f/deep.txt', testDir)

        expect(result.valid).to.be.true
      })
    })
  })
})
