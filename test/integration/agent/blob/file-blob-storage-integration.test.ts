import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import {FileBlobStorage} from '../../../../src/agent/infra/blob/file-blob-storage.js'

/**
 * Integration tests for FileBlobStorage
 *
 * These tests verify real file system operations:
 * - Directory and file creation
 * - Data persistence across restarts
 * - Cleanup and resource management
 * - Large data handling
 */
describe('FileBlobStorage Integration', () => {
  let testDir: string
  let storage: FileBlobStorage

  beforeEach(async () => {
    stub(console, 'log')
    stub(console, 'error')

    testDir = join(tmpdir(), `file-blob-integration-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
  })

  afterEach(async () => {
    if (storage) {
      storage.close()
    }

    restore()

    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Directory Creation', () => {
    it('should create blobs directory on initialization', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      const blobsDir = join(testDir, 'blobs')
      expect(existsSync(blobsDir)).to.be.true
    })

    it('should create storage directory if it does not exist', async () => {
      const nestedDir = join(testDir, 'nested', 'path', 'to', 'storage')
      storage = new FileBlobStorage({storageDir: nestedDir})
      await storage.initialize()

      const blobsDir = join(nestedDir, 'blobs')
      expect(existsSync(blobsDir)).to.be.true
    })

    it('should create per-blob directories with content.bin and metadata.json', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      await storage.store('test-key', Buffer.from('test data'))

      const blobDir = join(testDir, 'blobs', 'test-key')
      expect(existsSync(join(blobDir, 'content.bin'))).to.be.true
      expect(existsSync(join(blobDir, 'metadata.json'))).to.be.true
    })
  })

  describe('Data Persistence', () => {
    it('should persist data across storage restarts', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      const key = 'persistent-key'
      const content = Buffer.from('This data should persist!')
      await storage.store(key, content, {
        tags: {category: 'persistence', type: 'test'},
      })

      storage.close()

      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      const retrieved = await storage.retrieve(key)
      expect(retrieved).to.exist
      expect(retrieved!.content).to.deep.equal(content)
      expect(retrieved!.metadata.tags).to.deep.equal({category: 'persistence', type: 'test'})
    })

    it('should maintain correct stats after restart', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      await storage.store('blob-1', Buffer.from('test1'))
      await storage.store('blob-2', Buffer.from('test22'))
      await storage.store('blob-3', Buffer.from('test333'))

      storage.close()

      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      const stats = await storage.getStats()
      expect(stats.totalBlobs).to.equal(3)
      expect(stats.totalSize).to.equal(5 + 6 + 7) // "test1" + "test22" + "test333"
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle multiple stores in sequence', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      const numBlobs = 100
      for (let i = 0; i < numBlobs; i++) {
        // eslint-disable-next-line no-await-in-loop
        await storage.store(`blob-${i}`, Buffer.from(`content-${i}`))
      }

      const keys = await storage.list()
      expect(keys).to.have.lengthOf(numBlobs)
    })

    it('should maintain data integrity during rapid updates', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      const key = 'update-test'

      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await storage.store(key, Buffer.from(`version-${i}`))
      }

      const final = await storage.retrieve(key)
      expect(final!.content.toString()).to.equal('version-9')
    })
  })

  describe('Cleanup and Resource Management', () => {
    it('should properly close storage', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      await storage.store('test', Buffer.from('data'))

      storage.close()

      // After close, operations should fail
      try {
        await storage.retrieve('test')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.exist
      }
    })

    it('should allow deleting storage directory after close', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()
      await storage.store('test', Buffer.from('data'))

      storage.close()

      await rm(testDir, {force: true, recursive: true})

      expect(existsSync(testDir)).to.be.false
    })

    it('should clear all blobs from disk', async () => {
      storage = new FileBlobStorage({storageDir: testDir})
      await storage.initialize()

      await storage.store('blob-1', Buffer.from('test1'))
      await storage.store('blob-2', Buffer.from('test2'))

      await storage.clear()

      const entries = await readdir(join(testDir, 'blobs'))
      expect(entries).to.have.lengthOf(0)

      const stats = await storage.getStats()
      expect(stats.totalBlobs).to.equal(0)
    })
  })

  describe('Large Data Handling', () => {
    it('should handle large blobs (10MB)', async () => {
      storage = new FileBlobStorage({
        maxBlobSize: 20 * 1024 * 1024, // 20MB
        storageDir: testDir,
      })
      await storage.initialize()

      const largeBlob = Buffer.alloc(10 * 1024 * 1024) // 10MB
      largeBlob.fill('A')

      await storage.store('large-blob', largeBlob)

      const retrieved = await storage.retrieve('large-blob')
      expect(retrieved!.content.length).to.equal(10 * 1024 * 1024)
    })
  })
})
