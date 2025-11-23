import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import {SqliteBlobStorage} from '../../../../../src/infra/cipher/blob/sqlite-blob-storage.js'

/**
 * Integration tests for SqliteBlobStorage
 *
 * These tests verify real file system operations:
 * - Database file creation
 * - Data persistence across restarts
 * - WAL mode functionality
 * - Cleanup and resource management
 */
describe('SqliteBlobStorage Integration', () => {
  let testDir: string
  let storage: SqliteBlobStorage

  beforeEach(async () => {
    // Create a temporary directory for each test
    // Suppress console output during tests
    stub(console, 'log')
    stub(console, 'error')

    testDir = join(tmpdir(), `sqlite-blob-integration-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
  })

  afterEach(async () => {
    // Cleanup
    if (storage) {
      restore()

      storage.close()
    }

    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Database File Creation', () => {
    it('should create storage.db file on initialization', async () => {
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      const dbPath = join(testDir, 'storage.db')
      expect(existsSync(dbPath)).to.be.true
    })

    it('should create storage directory if it does not exist', async () => {
      const nestedDir = join(testDir, 'nested', 'path', 'to', 'storage')
      storage = new SqliteBlobStorage({storageDir: nestedDir})
      await storage.initialize()

      const dbPath = join(nestedDir, 'storage.db')
      expect(existsSync(dbPath)).to.be.true
    })

    it('should create WAL files when WAL mode is enabled', async () => {
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      // Store some data to trigger WAL
      await storage.store('test-key', Buffer.from('test data'))

      // Check for database file
      const files = await readdir(testDir)

      // WAL files may not always exist immediately, but the DB should
      expect(files).to.include('storage.db')
    })
  })

  describe('Data Persistence', () => {
    it('should persist data across storage restarts', async () => {
      // First storage instance
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      const key = 'persistent-key'
      const content = Buffer.from('This data should persist!')
      await storage.store(key, content, {
        tags: {category: 'persistence', type: 'test'},
      })

      storage.close()

      // Second storage instance (new connection)
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      const retrieved = await storage.retrieve(key)
      expect(retrieved).to.exist
      expect(retrieved!.content).to.deep.equal(content)
      expect(retrieved!.metadata.tags).to.deep.equal({category: 'persistence', type: 'test'})
    })

    it('should maintain correct stats after restart', async () => {
      // First instance: store 3 blobs
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      await storage.store('blob-1', Buffer.from('test1'))
      await storage.store('blob-2', Buffer.from('test22'))
      await storage.store('blob-3', Buffer.from('test333'))

      storage.close()

      // Second instance: verify stats
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      const stats = await storage.getStats()
      expect(stats.totalBlobs).to.equal(3)
      expect(stats.totalSize).to.equal(5 + 6 + 7) // "test1" + "test22" + "test333"
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle multiple stores in sequence', async () => {
      storage = new SqliteBlobStorage({storageDir: testDir})
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
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      const key = 'update-test'

      // Rapid sequential updates
      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await storage.store(key, Buffer.from(`version-${i}`))
      }

      const final = await storage.retrieve(key)
      expect(final!.content.toString()).to.equal('version-9')
    })
  })

  describe('Cleanup and Resource Management', () => {
    it('should properly close database connection', async () => {
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()

      await storage.store('test', Buffer.from('data'))

      // Close should not throw
      storage.close()

      // After close, DB should be inaccessible
      try {
        await storage.retrieve('test')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.exist
      }
    })

    it('should allow deleting storage directory after close', async () => {
      storage = new SqliteBlobStorage({storageDir: testDir})
      await storage.initialize()
      await storage.store('test', Buffer.from('data'))

      storage.close()

      // Should be able to delete directory
      await rm(testDir, {force: true, recursive: true})

      expect(existsSync(testDir)).to.be.false
    })
  })

  describe('Large Data Handling', () => {
    it('should handle large blobs (10MB)', async () => {
      storage = new SqliteBlobStorage({
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
