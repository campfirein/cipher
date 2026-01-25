import {expect} from 'chai'
import {mkdir, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path, {join} from 'node:path'

import type {FileSystemConfig} from '../../../../src/agent/types/file-system/types.js'

import {PathValidator} from '../../../../src/agent/file-system/path-validator.js'

describe('PathValidator', () => {
  let testDir: string
  let config: FileSystemConfig

  beforeEach(async () => {
    testDir = join(tmpdir(), `path-validator-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    config = {
      allowedPaths: [testDir],
      blockedExtensions: ['.exe', '.sh', '.bat'],
      blockedPaths: ['node_modules', '.git', '.env'],
      maxFileSize: 10 * 1024 * 1024, // 10 MB
      workingDirectory: testDir,
    }
  })

  afterEach(async () => {
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {}
  })

  describe('constructor', () => {
    it('should create a validator with valid config', () => {
      const validator = new PathValidator(config)
      expect(validator).to.be.instanceOf(PathValidator)
    })

    it('should normalize file extensions to lowercase', () => {
      const upperCaseConfig = {...config, blockedExtensions: ['.EXE', '.SH']}
      const validator = new PathValidator(upperCaseConfig)

      const result = validator.validate('test.exe', 'write')
      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('.exe')
      }
    })
  })

  describe('validate - empty path checks', () => {
    it('should reject empty string', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.equal('Path cannot be empty')
      }
    })

    it('should reject whitespace-only string', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('   ', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.equal('Path cannot be empty')
      }
    })
  })

  describe('validate - path traversal detection (CRITICAL SECURITY)', () => {
    it('should block explicit parent directory traversal', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('../../../etc/passwd', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.equal('Path traversal detected')
      }
    })

    it('should block backslash parent directory traversal', () => {
      const validator = new PathValidator(config)
      const result = validator.validate(String.raw`..\..\..\windows\system32`, 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.equal('Path traversal detected')
      }
    })

    it('should block traversal that escapes working directory', () => {
      const validator = new PathValidator(config)
      const result = validator.validate(`../${path.basename(testDir)}/../etc`, 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.equal('Path traversal detected')
      }
    })

    it('should allow safe relative paths within working directory', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('subdir/file.txt', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        expect(result.normalizedPath).to.include('subdir')
      }
    })

    it('should allow legitimate directory names containing dots', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('my..parent..dir/file.txt', 'read')

      expect(result.valid).to.be.true
    })
  })

  describe('validate - allowed paths enforcement', () => {
    it('should allow paths within allowed directory', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('allowed-file.txt', 'read')

      expect(result.valid).to.be.true
    })

    it('should allow nested paths within allowed directory', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('dir1/dir2/dir3/file.txt', 'read')

      expect(result.valid).to.be.true
    })

    it('should block paths outside allowed directory', () => {
      const validator = new PathValidator(config)
      const outsidePath = path.join(tmpdir(), 'outside-dir', 'file.txt')
      const result = validator.validate(outsidePath, 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('not in allowed paths')
      }
    })

    it('should handle multiple allowed paths', async () => {
      const allowedDir1 = path.join(testDir, 'allowed1')
      const allowedDir2 = path.join(testDir, 'allowed2')
      await mkdir(allowedDir1)
      await mkdir(allowedDir2)

      const multiConfig = {...config, allowedPaths: [allowedDir1, allowedDir2]}
      const validator = new PathValidator(multiConfig)

      const result1 = validator.validate(path.join(allowedDir1, 'file.txt'), 'read')
      const result2 = validator.validate(path.join(allowedDir2, 'file.txt'), 'read')

      expect(result1.valid).to.be.true
      expect(result2.valid).to.be.true
    })

    it('should block root path attempt', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('/', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('not in allowed paths')
      }
    })
  })

  describe('validate - blocked paths enforcement', () => {
    it('should block files in node_modules', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('node_modules/package/index.js', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('blocked directory')
      }
    })

    it('should block files in .git', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('.git/config', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('blocked directory')
      }
    })

    it('should block .env files', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('.env', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('blocked directory')
      }
    })

    it('should block nested paths within blocked directories', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('node_modules/deep/nested/path/file.js', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('blocked directory')
      }
    })

    it('should allow files not in blocked paths', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('src/index.ts', 'read')

      expect(result.valid).to.be.true
    })
  })

  describe('validate - file extension blocking', () => {
    it('should block .exe files on write', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('malware.exe', 'write')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('.exe')
      }
    })

    it('should block .sh files on write', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('script.sh', 'write')

      expect(result.valid).to.be.false
      if (!result.valid) {
        expect(result.error).to.include('.sh')
      }
    })

    it('should allow .exe files on read (extensions only checked on write)', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('existing.exe', 'read')

      expect(result.valid).to.be.true
    })

    it('should handle case-insensitive extensions', () => {
      const validator = new PathValidator(config)

      const resultUpper = validator.validate('file.EXE', 'write')
      const resultMixed = validator.validate('file.ExE', 'write')

      expect(resultUpper.valid).to.be.false
      expect(resultMixed.valid).to.be.false
    })

    it('should allow safe file extensions on write', () => {
      const validator = new PathValidator(config)

      const txtResult = validator.validate('document.txt', 'write')
      const jsResult = validator.validate('script.js', 'write')

      expect(txtResult.valid).to.be.true
      expect(jsResult.valid).to.be.true
    })
  })

  describe('validate - symlink handling', () => {
    it('should detect symlink escaping allowed directory (CRITICAL SECURITY)', async () => {
      const outsideFile = path.join(tmpdir(), 'outside-target.txt')
      const symlinkPath = path.join(testDir, 'escape-symlink.txt')

      await writeFile(outsideFile, 'content')
      try {
        await symlink(outsideFile, symlinkPath)

        const validator = new PathValidator(config)
        const result = validator.validate(symlinkPath, 'read')

        expect(result.valid).to.be.false
        if (!result.valid) {
          expect(result.error).to.include('not in allowed paths')
        }
      } finally {
        await rm(outsideFile, {force: true})
      }
    })

    it('should handle non-existent paths for write operations', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('new-file.txt', 'write')

      expect(result.valid).to.be.true
    })
  })

  describe('validate - normalized path return', () => {
    it('should return normalized absolute path on success', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('subdir/file.txt', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        expect(result.normalizedPath).to.be.a('string')
        expect(path.isAbsolute(result.normalizedPath)).to.be.true
      }
    })

    it('should not return normalizedPath on validation failure', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('', 'read')

      expect(result.valid).to.be.false
      if (!result.valid) {
        // TypeScript knows normalizedPath doesn't exist on invalid results
        expect('normalizedPath' in result).to.be.false
      }
    })
  })

  describe('validate - path duplication prevention (ENG-711)', () => {
    it('should prevent path duplication when working directory ends with file path prefix', async () => {
      // Simulate the exact bug scenario from ENG-711:
      // workingDirectory = /project/.brv/context-tree
      // filePath = .brv/context-tree/structure/authentication/context.md
      // Expected: /project/.brv/context-tree/structure/authentication/context.md (NOT duplicated)
      const contextTreeDir = join(testDir, '.brv', 'context-tree')
      await mkdir(contextTreeDir, {recursive: true})

      // Create nested structure
      const structureDir = join(contextTreeDir, 'structure', 'authentication')
      await mkdir(structureDir, {recursive: true})
      await writeFile(join(structureDir, 'context.md'), 'test content')

      // Configure with working directory at context-tree level
      const contextTreeConfig = {
        ...config,
        allowedPaths: [contextTreeDir],
        workingDirectory: contextTreeDir,
      }

      const validator = new PathValidator(contextTreeConfig)

      // This is the exact path pattern that was causing the bug
      const result = validator.validate('.brv/context-tree/structure/authentication/context.md', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        // The path should NOT contain duplicate .brv/context-tree segments
        const pathParts = result.normalizedPath.split(path.sep)
        const contextTreeOccurrences = pathParts.filter(
          (_, i) => pathParts[i] === '.brv' && pathParts[i + 1] === 'context-tree',
        ).length
        expect(contextTreeOccurrences).to.equal(1, 'Path should only contain .brv/context-tree once')

        // Verify the path resolves to the actual file
        expect(result.normalizedPath).to.include('structure')
        expect(result.normalizedPath).to.include('authentication')
        expect(result.normalizedPath).to.include('context.md')
      }
    })

    it('should handle single segment path duplication', async () => {
      // workingDirectory = /project/src
      // filePath = src/file.ts
      // Expected: /project/src/file.ts (NOT /project/src/src/file.ts)
      const srcDir = join(testDir, 'src')
      await mkdir(srcDir, {recursive: true})
      await writeFile(join(srcDir, 'file.ts'), 'content')

      const srcConfig = {
        ...config,
        allowedPaths: [srcDir],
        workingDirectory: srcDir,
      }

      const validator = new PathValidator(srcConfig)
      const result = validator.validate('src/file.ts', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        // Count 'src' occurrences - should only appear once in the actual path after testDir
        const relativePath = path.relative(testDir, result.normalizedPath)
        const srcCount = relativePath.split(path.sep).filter((s) => s === 'src').length
        expect(srcCount).to.equal(1, 'Path should only contain src once')
      }
    })

    it('should not modify paths when no duplication would occur', async () => {
      // Normal case: workingDirectory = /project
      // filePath = .brv/context-tree/file.md
      // Expected: /project/.brv/context-tree/file.md (normal resolution)
      const brvDir = join(testDir, '.brv', 'context-tree')
      await mkdir(brvDir, {recursive: true})
      const filePath = join(brvDir, 'file.md')
      await writeFile(filePath, 'content')

      // Working directory at project root (not at context-tree level)
      const projectConfig = {
        ...config,
        allowedPaths: [testDir],
        workingDirectory: testDir,
      }

      const validator = new PathValidator(projectConfig)
      const result = validator.validate('.brv/context-tree/file.md', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        // Use realpath to get the expected path with symlinks resolved
        const {realpathSync} = await import('node:fs')
        const expectedPath = realpathSync.native(filePath)
        expect(result.normalizedPath).to.equal(expectedPath)
      }
    })

    it('should handle multi-level duplication correctly', async () => {
      // workingDirectory = /project/a/b/c
      // filePath = a/b/c/d/file.txt
      // Expected: /project/a/b/c/d/file.txt (NOT /project/a/b/c/a/b/c/d/file.txt)
      const nestedDir = join(testDir, 'a', 'b', 'c', 'd')
      await mkdir(nestedDir, {recursive: true})
      const filePath = join(nestedDir, 'file.txt')
      await writeFile(filePath, 'content')

      const abcDir = join(testDir, 'a', 'b', 'c')
      const nestedConfig = {
        ...config,
        allowedPaths: [abcDir],
        workingDirectory: abcDir,
      }

      const validator = new PathValidator(nestedConfig)
      const result = validator.validate('a/b/c/d/file.txt', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        // Verify the path is correct
        expect(result.normalizedPath).to.include(path.join('d', 'file.txt'))
        // Use realpath on testDir for consistent comparison
        const {realpathSync} = await import('node:fs')
        const realTestDir = realpathSync.native(testDir)
        const relativePath = path.relative(realTestDir, result.normalizedPath)
        expect(relativePath).to.equal(path.join('a', 'b', 'c', 'd', 'file.txt'))
      }
    })

    it('should handle partial segment matches correctly (no false positives)', async () => {
      // workingDirectory = /project/src-test
      // filePath = src/file.ts
      // These should NOT be considered duplicates (src-test != src)
      const srcTestDir = join(testDir, 'src-test')
      const srcDir = join(srcTestDir, 'src')
      await mkdir(srcDir, {recursive: true})
      const filePath = join(srcDir, 'file.ts')
      await writeFile(filePath, 'content')

      const partialConfig = {
        ...config,
        allowedPaths: [srcTestDir],
        workingDirectory: srcTestDir,
      }

      const validator = new PathValidator(partialConfig)
      const result = validator.validate('src/file.ts', 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        // Should resolve normally: /project/src-test/src/file.ts
        // Use realpath for consistent comparison
        const {realpathSync} = await import('node:fs')
        const expectedPath = realpathSync.native(filePath)
        expect(result.normalizedPath).to.equal(expectedPath)
      }
    })

    it('should handle absolute paths correctly', async () => {
      // Absolute paths should be normalized directly without any duplication logic
      const absPath = join(testDir, 'absolute-file.txt')
      await writeFile(absPath, 'content')

      const validator = new PathValidator(config)
      const result = validator.validate(absPath, 'read')

      expect(result.valid).to.be.true
      if (result.valid) {
        // Use realpath for consistent comparison (symlinks like /var -> /private/var)
        const {realpathSync} = await import('node:fs')
        const expectedPath = realpathSync.native(absPath)
        expect(result.normalizedPath).to.equal(expectedPath)
      }
    })
  })
})
