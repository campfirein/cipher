import {expect} from 'chai'
import {mkdir, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path, {join} from 'node:path'

import type {FileSystemConfig} from '../../../../src/core/domain/file-system/types.js'

import {PathValidator} from '../../../../src/infra/file-system/path-validator.js'

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
      expect(result.error).to.include('.exe')
    })
  })

  describe('validate - empty path checks', () => {
    it('should reject empty string', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.equal('Path cannot be empty')
    })

    it('should reject whitespace-only string', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('   ', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.equal('Path cannot be empty')
    })
  })

  describe('validate - path traversal detection (CRITICAL SECURITY)', () => {
    it('should block explicit parent directory traversal', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('../../../etc/passwd', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.equal('Path traversal detected')
    })

    it('should block backslash parent directory traversal', () => {
      const validator = new PathValidator(config)
      const result = validator.validate(String.raw`..\..\..\windows\system32`, 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.equal('Path traversal detected')
    })

    it('should block traversal that escapes working directory', () => {
      const validator = new PathValidator(config)
      const result = validator.validate(`../${path.basename(testDir)}/../etc`, 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.equal('Path traversal detected')
    })

    it('should allow safe relative paths within working directory', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('subdir/file.txt', 'read')

      expect(result.valid).to.be.true
      expect(result.normalizedPath).to.include('subdir')
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
      expect(result.error).to.include('not in allowed paths')
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
      expect(result.error).to.include('not in allowed paths')
    })
  })

  describe('validate - blocked paths enforcement', () => {
    it('should block files in node_modules', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('node_modules/package/index.js', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.include('blocked directory')
    })

    it('should block files in .git', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('.git/config', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.include('blocked directory')
    })

    it('should block .env files', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('.env', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.include('blocked directory')
    })

    it('should block nested paths within blocked directories', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('node_modules/deep/nested/path/file.js', 'read')

      expect(result.valid).to.be.false
      expect(result.error).to.include('blocked directory')
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
      expect(result.error).to.include('.exe')
    })

    it('should block .sh files on write', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('script.sh', 'write')

      expect(result.valid).to.be.false
      expect(result.error).to.include('.sh')
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
        expect(result.error).to.include('not in allowed paths')
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
      expect(result.normalizedPath).to.be.a('string')
      expect(path.isAbsolute(result.normalizedPath!)).to.be.true
    })

    it('should not return normalizedPath on validation failure', () => {
      const validator = new PathValidator(config)
      const result = validator.validate('', 'read')

      expect(result.valid).to.be.false
      expect(result.normalizedPath).to.be.undefined
    })
  })
})
