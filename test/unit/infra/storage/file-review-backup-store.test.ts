import {expect} from 'chai'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FileReviewBackupStore} from '../../../../src/server/infra/storage/file-review-backup-store.js'

describe('FileReviewBackupStore', () => {
  let tempDir: string
  let store: FileReviewBackupStore

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-review-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    store = new FileReviewBackupStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  describe('save + has + read', () => {
    it('should save and read back file content', async () => {
      await store.save('auth/jwt/refresh.md', '# Old Content\nSome text')
      expect(await store.has('auth/jwt/refresh.md')).to.be.true
      expect(await store.read('auth/jwt/refresh.md')).to.equal('# Old Content\nSome text')
    })

    it('should create nested directories as needed', async () => {
      await store.save('deep/nested/path/file.md', 'content')
      expect(await store.read('deep/nested/path/file.md')).to.equal('content')
    })

    it('should return false/null for non-existent paths', async () => {
      expect(await store.has('nonexistent.md')).to.be.false
      expect(await store.read('nonexistent.md')).to.be.null
    })
  })

  describe('first-write-wins', () => {
    it('should not overwrite an existing backup', async () => {
      await store.save('auth/jwt/refresh.md', 'original content')
      await store.save('auth/jwt/refresh.md', 'new content that should be ignored')

      expect(await store.read('auth/jwt/refresh.md')).to.equal('original content')
    })
  })

  describe('delete', () => {
    it('should remove a single backup', async () => {
      await store.save('auth/jwt/refresh.md', 'content')
      await store.save('api/rate_limiting.md', 'other')

      await store.delete('auth/jwt/refresh.md')

      expect(await store.has('auth/jwt/refresh.md')).to.be.false
      expect(await store.read('auth/jwt/refresh.md')).to.be.null
      // Other backups unaffected
      expect(await store.has('api/rate_limiting.md')).to.be.true
    })

    it('should be safe to call when backup does not exist', async () => {
      await store.delete('nonexistent.md')
    })

    it('should allow re-saving after delete', async () => {
      await store.save('auth/jwt/refresh.md', 'original')
      await store.delete('auth/jwt/refresh.md')
      await store.save('auth/jwt/refresh.md', 'new content')

      expect(await store.read('auth/jwt/refresh.md')).to.equal('new content')
    })

    it('should prune empty parent directories after deleting the last file', async () => {
      await store.save('auth/jwt/refresh.md', 'content')
      await store.delete('auth/jwt/refresh.md')

      expect(await store.list()).to.deep.equal([])
      // The backup root itself should be gone when it becomes empty
      expect(await store.has('auth/jwt/refresh.md')).to.be.false
    })

    it('should not prune a directory that still has other files', async () => {
      await store.save('auth/jwt/refresh.md', 'content')
      await store.save('auth/jwt/access.md', 'other')

      await store.delete('auth/jwt/refresh.md')

      // auth/jwt/ dir still exists because access.md is there
      expect(await store.has('auth/jwt/access.md')).to.be.true
    })

    it('should prune recursively when all files under a nested path are deleted', async () => {
      await store.save('auth/jwt/refresh.md', 'a')
      await store.save('auth/session/cookie.md', 'b')

      await store.delete('auth/jwt/refresh.md')
      // auth/session/cookie.md still present — auth/ dir not pruned yet
      expect(await store.list()).to.deep.equal(['auth/session/cookie.md'])

      await store.delete('auth/session/cookie.md')
      // Now everything is gone
      expect(await store.list()).to.deep.equal([])
    })
  })

  describe('clear', () => {
    it('should remove all backups', async () => {
      await store.save('file1.md', 'content1')
      await store.save('nested/file2.md', 'content2')

      await store.clear()

      expect(await store.has('file1.md')).to.be.false
      expect(await store.has('nested/file2.md')).to.be.false
    })

    it('should be safe to call when no backups exist', async () => {
      await store.clear()
    })
  })

  describe('list', () => {
    it('should return all backed-up file paths', async () => {
      await store.save('auth/jwt/refresh.md', 'a')
      await store.save('api/rate_limiting.md', 'b')
      await store.save('auth/session/cookie.md', 'c')

      const paths = await store.list()
      expect(paths.sort()).to.deep.equal([
        'api/rate_limiting.md',
        'auth/jwt/refresh.md',
        'auth/session/cookie.md',
      ])
    })

    it('should return empty array when no backups exist', async () => {
      expect(await store.list()).to.deep.equal([])
    })
  })
})
