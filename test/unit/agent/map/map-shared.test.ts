import {expect} from 'chai'
import {realpathSync} from 'node:fs'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {resolveAndValidatePath} from '../../../../src/agent/infra/map/map-shared.js'

describe('resolveAndValidatePath', () => {
  let workDir: string

  beforeEach(async () => {
    // mkdtemp creates a unique directory atomically — no leaks, no timestamp races
    const raw = await mkdtemp(join(tmpdir(), 'map-path-test-'))
    // Canonicalize to handle /tmp -> /private/tmp on macOS
    workDir = realpathSync.native(raw)
  })

  afterEach(async () => {
    await rm(workDir, {force: true, recursive: true}).catch(() => {})
  })

  describe('basic path traversal prevention', () => {
    it('should accept a relative path within the working directory', () => {
      const result = resolveAndValidatePath(workDir, 'data/input.jsonl')
      expect(result).to.equal(join(workDir, 'data/input.jsonl'))
    })

    it('should accept an absolute path within the working directory', async () => {
      const subDir = join(workDir, 'sub')
      await mkdir(subDir, {recursive: true})
      const filePath = join(subDir, 'file.jsonl')
      await writeFile(filePath, '')

      const result = resolveAndValidatePath(workDir, filePath)
      expect(result).to.equal(filePath)
    })

    it('should reject ../ traversal that escapes the working directory', () => {
      expect(() => resolveAndValidatePath(workDir, '../../etc/passwd'))
        .to.throw('resolves outside the working directory')
    })

    it('should reject absolute path outside the working directory', () => {
      expect(() => resolveAndValidatePath(workDir, '/etc/passwd'))
        .to.throw('resolves outside the working directory')
    })

    it('should accept the working directory itself', () => {
      const result = resolveAndValidatePath(workDir, '.')
      expect(result).to.equal(workDir)
    })
  })

  describe('symlink escape prevention', () => {
    it('should reject a symlink pointing outside the working directory', async () => {
      // Create target file outside workDir
      const outsideDir = join(tmpdir(), `map-outside-${Date.now()}`)
      await mkdir(outsideDir, {recursive: true})
      const outsideFile = join(outsideDir, 'secret.txt')
      await writeFile(outsideFile, 'sensitive data')

      try {
        // Create symlink inside workDir → outside file
        const symlinkPath = join(workDir, 'escape.txt')
        await symlink(outsideFile, symlinkPath)

        expect(() => resolveAndValidatePath(workDir, 'escape.txt'))
          .to.throw('resolves outside the working directory')
      } finally {
        await rm(outsideDir, {force: true, recursive: true}).catch(() => {})
      }
    })

    it('should reject a symlinked directory pointing outside the working directory', async () => {
      const outsideDir = join(tmpdir(), `map-outside-dir-${Date.now()}`)
      await mkdir(outsideDir, {recursive: true})
      await writeFile(join(outsideDir, 'data.jsonl'), '{"a":1}')

      try {
        // Create directory symlink inside workDir → outside directory
        const symlinkDir = join(workDir, 'linked-data')
        await symlink(outsideDir, symlinkDir)

        expect(() => resolveAndValidatePath(workDir, 'linked-data/data.jsonl'))
          .to.throw('resolves outside the working directory')
      } finally {
        await rm(outsideDir, {force: true, recursive: true}).catch(() => {})
      }
    })

    it('should allow a symlink that stays within the working directory', async () => {
      // Create real file inside workDir
      const realDir = join(workDir, 'real')
      await mkdir(realDir, {recursive: true})
      const realFile = join(realDir, 'data.jsonl')
      await writeFile(realFile, '{"a":1}')

      // Create symlink inside workDir → file also inside workDir
      const symlinkPath = join(workDir, 'link.jsonl')
      await symlink(realFile, symlinkPath)

      const result = resolveAndValidatePath(workDir, 'link.jsonl')
      expect(result).to.equal(join(workDir, 'link.jsonl'))
    })
  })

  describe('non-existent output path handling', () => {
    it('should accept a non-existent file in an existing directory', () => {
      const result = resolveAndValidatePath(workDir, 'output.jsonl')
      expect(result).to.equal(join(workDir, 'output.jsonl'))
    })

    it('should accept a non-existent file in a non-existent subdirectory', () => {
      const result = resolveAndValidatePath(workDir, 'new-dir/output.jsonl')
      expect(result).to.equal(join(workDir, 'new-dir/output.jsonl'))
    })

    it('should reject a non-existent output path via symlinked parent escaping the workspace', async () => {
      const outsideDir = join(tmpdir(), `map-outside-parent-${Date.now()}`)
      await mkdir(outsideDir, {recursive: true})

      try {
        // Create symlinked directory inside workDir that points outside
        const symlinkDir = join(workDir, 'output-dir')
        await symlink(outsideDir, symlinkDir)

        // Non-existent file under symlinked directory — parent exists but escapes
        expect(() => resolveAndValidatePath(workDir, 'output-dir/results.jsonl'))
          .to.throw('resolves outside the working directory')
      } finally {
        await rm(outsideDir, {force: true, recursive: true}).catch(() => {})
      }
    })

    it('should reject nested non-existent paths under a symlinked directory escaping the workspace', async () => {
      // Reproduces the bypass: workspace/linkout/newdir/subdir/results.jsonl
      // where linkout → /outside, and newdir/subdir/results.jsonl don't exist.
      // The old 1-parent fallback would hit normalize() and allow this.
      const outsideDir = join(tmpdir(), `map-nested-outside-${Date.now()}`)
      await mkdir(outsideDir, {recursive: true})

      try {
        const symlinkDir = join(workDir, 'linkout')
        await symlink(outsideDir, symlinkDir)

        // Multiple non-existent levels under the symlink
        expect(() => resolveAndValidatePath(workDir, 'linkout/newdir/subdir/results.jsonl'))
          .to.throw('resolves outside the working directory')
      } finally {
        await rm(outsideDir, {force: true, recursive: true}).catch(() => {})
      }
    })
  })
})
