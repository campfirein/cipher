import { expect } from 'chai'
import { SinonStub, stub } from 'sinon'

import type { StoredBlob } from '../../../../../src/core/domain/cipher/blob/types.js'
import type { IBlobStorage } from '../../../../../src/core/interfaces/cipher/i-blob-storage.js'

import { MemoryError, MemoryErrorCode, MemoryManager } from '../../../../../src/infra/cipher/memory/index.js'

describe('MemoryManager - Unit Tests (Mocked)', () => {
  let memoryManager: MemoryManager
  let mockBlobStorage: IBlobStorage
  let storeStub: SinonStub
  let retrieveStub: SinonStub
  let deleteStub: SinonStub
  let existsStub: SinonStub
  let listStub: SinonStub
  let initializeStub: SinonStub
  let clearStub: SinonStub
  let getMetadataStub: SinonStub
  let getStatsStub: SinonStub

  beforeEach(() => {
    // Create stubs for IBlobStorage methods
    storeStub = stub()
    retrieveStub = stub()
    deleteStub = stub()
    existsStub = stub()
    listStub = stub()
    initializeStub = stub()
    clearStub = stub()
    getMetadataStub = stub()
    getStatsStub = stub()

    // Mock IBlobStorage
    mockBlobStorage = {
      clear: clearStub,
      delete: deleteStub,
      exists: existsStub,
      getMetadata: getMetadataStub,
      getStats: getStatsStub,
      initialize: initializeStub,
      list: listStub,
      retrieve: retrieveStub,
      store: storeStub,
    }

    // Initialize MemoryManager with mocked storage
    memoryManager = new MemoryManager(mockBlobStorage)
  })

  describe('create', () => {
    it('should create a memory and store it', async () => {
      // Mock store to return success
      storeStub.resolves({
        content: Buffer.from(''),
        key: 'memory-test-id',
        metadata: {},
      })

      const memory = await memoryManager.create({
        content: 'Test memory',
        tags: ['test'],
      })

      expect(memory.id).to.be.a('string')
      expect(memory.content).to.equal('Test memory')
      expect(memory.tags).to.deep.equal(['test'])
      expect(memory.createdAt).to.be.a('number')
      expect(memory.updatedAt).to.equal(memory.createdAt)

      // Verify store was called
      expect(storeStub.calledOnce).to.be.true
      const [key, content] = storeStub.firstCall.args
      expect(key).to.include('memory-')
      expect(JSON.parse(content).content).to.equal('Test memory')
    })

    it('should create memory with metadata', async () => {
      storeStub.resolves({})

      const memory = await memoryManager.create({
        content: 'Test',
        metadata: {
          pinned: true,
          source: 'agent',
        },
      })

      expect(memory.metadata?.pinned).to.be.true
      expect(memory.metadata?.source).to.equal('agent')
    })

    it('should throw error if content exceeds max length', async () => {
      const longContent = 'a'.repeat(10_001) // > 10k chars

      try {
        await memoryManager.create({ content: longContent })
        expect.fail('Should have thrown validation error')
      } catch (error) {
        expect(error).to.exist
      }
    })

    it('should throw error if too many tags', async () => {
      const manyTags = Array.from({ length: 11 }, (_, i) => `tag${i}`)

      try {
        await memoryManager.create({
          content: 'Test',
          tags: manyTags,
        })
        expect.fail('Should have thrown validation error')
      } catch (error) {
        expect(error).to.exist
      }
    })

    it('should throw MemoryError if storage fails', async () => {
      storeStub.rejects(new Error('Storage error'))

      try {
        await memoryManager.create({ content: 'Test' })
        expect.fail('Should have thrown MemoryError')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).code).to.equal(MemoryErrorCode.MEMORY_STORAGE_ERROR)
      }
    })
  })

  describe('get', () => {
    it('should retrieve an existing memory', async () => {
      const mockMemory = {
        content: 'Test memory',
        createdAt: Date.now(),
        id: 'test-id',
        updatedAt: Date.now(),
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      const memory = await memoryManager.get('test-id')

      expect(memory.id).to.equal('test-id')
      expect(memory.content).to.equal('Test memory')
      expect(retrieveStub.calledOnceWith('memory-test-id')).to.be.true
    })

    it('should throw MemoryError.notFound if memory does not exist', async () => {
      retrieveStub.resolves()

      try {
        await memoryManager.get('non-existent')
        expect.fail('Should have thrown MemoryError')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).code).to.equal(MemoryErrorCode.MEMORY_NOT_FOUND)
      }
    })

    it('should throw MemoryError.invalidId for invalid ID', async () => {
      try {
        await memoryManager.get('')
        expect.fail('Should have thrown MemoryError')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).code).to.equal(MemoryErrorCode.MEMORY_INVALID_ID)
      }
    })

    it('should throw MemoryError.retrievalError if JSON is malformed', async () => {
      retrieveStub.resolves({
        content: Buffer.from('invalid json'),
        key: 'memory-test-id',
        metadata: {},
      })

      try {
        await memoryManager.get('test-id')
        expect.fail('Should have thrown MemoryError')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).code).to.equal(MemoryErrorCode.MEMORY_RETRIEVAL_ERROR)
      }
    })
  })

  describe('update', () => {
    it('should update memory content', async () => {
      const existingMemory = {
        content: 'Original',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(existingMemory)),
        key: 'memory-test-id',
        metadata: {},
      })
      storeStub.resolves({})

      const updated = await memoryManager.update('test-id', {
        content: 'Updated',
      })

      expect(updated.content).to.equal('Updated')
      expect(updated.updatedAt).to.be.greaterThan(existingMemory.updatedAt)
      expect(storeStub.calledOnce).to.be.true
    })

    it('should merge metadata on update', async () => {
      const existingMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        metadata: {
          customField: 'value',
          pinned: false,
        },
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(existingMemory)),
        key: 'memory-test-id',
        metadata: {},
      })
      storeStub.resolves({})

      const updated = await memoryManager.update('test-id', {
        metadata: { pinned: true },
      })

      expect(updated.metadata?.pinned).to.be.true
      expect(updated.metadata?.customField).to.equal('value')
    })

    it('should throw error if memory not found', async () => {
      retrieveStub.resolves()

      try {
        await memoryManager.update('non-existent', { content: 'Test' })
        expect.fail('Should have thrown MemoryError')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).code).to.equal(MemoryErrorCode.MEMORY_NOT_FOUND)
      }
    })
  })

  describe('delete', () => {
    it('should delete a memory without attachments', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })
      deleteStub.resolves()

      await memoryManager.delete('test-id')

      expect(deleteStub.calledOnceWith('memory-test-id')).to.be.true
    })

    it('should delete memory and all attachments', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        metadata: {
          attachments: [
            { blobKey: 'blob-1', createdAt: 1000, size: 100, type: 'text/plain' },
            { blobKey: 'blob-2', createdAt: 1000, size: 200, type: 'text/plain' },
          ],
        },
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })
      deleteStub.resolves()

      await memoryManager.delete('test-id')

      // Verify memory and both attachments were deleted
      expect(deleteStub.callCount).to.equal(3)
      expect(deleteStub.calledWith('memory-test-id')).to.be.true
      expect(deleteStub.calledWith('blob-1')).to.be.true
      expect(deleteStub.calledWith('blob-2')).to.be.true
    })

    it('should throw error if memory not found', async () => {
      retrieveStub.resolves()

      try {
        await memoryManager.delete('non-existent')
        expect.fail('Should have thrown MemoryError')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).code).to.equal(MemoryErrorCode.MEMORY_NOT_FOUND)
      }
    })
  })

  describe('list', () => {
    it('should list all memories', async () => {
      listStub.resolves(['memory-id1', 'memory-id2', 'memory-id3'])

      const memories = [
        { content: 'Memory 1', createdAt: 1000, id: 'id1', updatedAt: 3000 },
        { content: 'Memory 2', createdAt: 2000, id: 'id2', updatedAt: 2000 },
        { content: 'Memory 3', createdAt: 3000, id: 'id3', updatedAt: 1000 },
      ]

      retrieveStub.onCall(0).resolves({ content: Buffer.from(JSON.stringify(memories[0])), key: 'memory-id1', metadata: {} })
      retrieveStub.onCall(1).resolves({ content: Buffer.from(JSON.stringify(memories[1])), key: 'memory-id2', metadata: {} })
      retrieveStub.onCall(2).resolves({ content: Buffer.from(JSON.stringify(memories[2])), key: 'memory-id3', metadata: {} })

      const result = await memoryManager.list()

      expect(result).to.have.lengthOf(3)
      // Should be sorted by updatedAt descending
      expect(result[0].id).to.equal('id1')
      expect(result[1].id).to.equal('id2')
      expect(result[2].id).to.equal('id3')
    })

    it('should filter by source', async () => {
      listStub.resolves(['memory-id1', 'memory-id2'])

      const memories = [
        { content: 'Memory 1', createdAt: 1000, id: 'id1', metadata: { source: 'agent' }, updatedAt: 1000 },
        { content: 'Memory 2', createdAt: 2000, id: 'id2', metadata: { source: 'user' }, updatedAt: 2000 },
      ]

      retrieveStub.onCall(0).resolves({ content: Buffer.from(JSON.stringify(memories[0])), key: 'memory-id1', metadata: {} })
      retrieveStub.onCall(1).resolves({ content: Buffer.from(JSON.stringify(memories[1])), key: 'memory-id2', metadata: {} })

      const result = await memoryManager.list({ source: 'agent' })

      expect(result).to.have.lengthOf(1)
      expect(result[0].metadata?.source).to.equal('agent')
    })

    it('should filter by pinned status', async () => {
      listStub.resolves(['memory-id1', 'memory-id2'])

      const memories = [
        { content: 'Memory 1', createdAt: 1000, id: 'id1', metadata: { pinned: true }, updatedAt: 1000 },
        { content: 'Memory 2', createdAt: 2000, id: 'id2', metadata: { pinned: false }, updatedAt: 2000 },
      ]

      retrieveStub.onCall(0).resolves({ content: Buffer.from(JSON.stringify(memories[0])), key: 'memory-id1', metadata: {} })
      retrieveStub.onCall(1).resolves({ content: Buffer.from(JSON.stringify(memories[1])), key: 'memory-id2', metadata: {} })

      const result = await memoryManager.list({ pinned: true })

      expect(result).to.have.lengthOf(1)
      expect(result[0].metadata?.pinned).to.be.true
    })

    it('should apply limit and offset', async () => {
      listStub.resolves(['memory-id1', 'memory-id2', 'memory-id3'])

      const memories = [
        { content: 'Memory 1', createdAt: 1000, id: 'id1', updatedAt: 3000 },
        { content: 'Memory 2', createdAt: 2000, id: 'id2', updatedAt: 2000 },
        { content: 'Memory 3', createdAt: 3000, id: 'id3', updatedAt: 1000 },
      ]

      retrieveStub.onCall(0).resolves({ content: Buffer.from(JSON.stringify(memories[0])), key: 'memory-id1', metadata: {} })
      retrieveStub.onCall(1).resolves({ content: Buffer.from(JSON.stringify(memories[1])), key: 'memory-id2', metadata: {} })
      retrieveStub.onCall(2).resolves({ content: Buffer.from(JSON.stringify(memories[2])), key: 'memory-id3', metadata: {} })

      const result = await memoryManager.list({ limit: 2, offset: 1 })

      expect(result).to.have.lengthOf(2)
      expect(result[0].id).to.equal('id2')
      expect(result[1].id).to.equal('id3')
    })
  })

  describe('has', () => {
    it('should return true if memory exists', async () => {
      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify({ content: 'Test', createdAt: 1000, id: 'test-id', updatedAt: 1000 })),
        key: 'memory-test-id',
        metadata: {},
      })

      const exists = await memoryManager.has('test-id')

      expect(exists).to.be.true
    })

    it('should return false if memory does not exist', async () => {
      retrieveStub.resolves()

      const exists = await memoryManager.has('non-existent')

      expect(exists).to.be.false
    })
  })

  describe('count', () => {
    it('should return count of all memories', async () => {
      listStub.resolves(['memory-id1', 'memory-id2', 'memory-id3'])

      retrieveStub.onCall(0).resolves({ content: Buffer.from(JSON.stringify({ content: 'Test', createdAt: 1000, id: 'id1', updatedAt: 1000 })), key: 'memory-id1', metadata: {} })
      retrieveStub.onCall(1).resolves({ content: Buffer.from(JSON.stringify({ content: 'Test', createdAt: 1000, id: 'id2', updatedAt: 1000 })), key: 'memory-id2', metadata: {} })
      retrieveStub.onCall(2).resolves({ content: Buffer.from(JSON.stringify({ content: 'Test', createdAt: 1000, id: 'id3', updatedAt: 1000 })), key: 'memory-id3', metadata: {} })

      const count = await memoryManager.count()

      expect(count).to.equal(3)
    })

    it('should return count with filters applied', async () => {
      listStub.resolves(['memory-id1', 'memory-id2'])

      retrieveStub.onCall(0).resolves({ content: Buffer.from(JSON.stringify({ content: 'Test', createdAt: 1000, id: 'id1', metadata: { pinned: true }, updatedAt: 1000 })), key: 'memory-id1', metadata: {} })
      retrieveStub.onCall(1).resolves({ content: Buffer.from(JSON.stringify({ content: 'Test', createdAt: 1000, id: 'id2', metadata: { pinned: false }, updatedAt: 1000 })), key: 'memory-id2', metadata: {} })

      const count = await memoryManager.count({ pinned: true })

      expect(count).to.equal(1)
    })
  })

  describe('attachBlob', () => {
    it('should attach a blob to memory', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.onCall(0).resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      storeStub.onCall(0).resolves({
        content: Buffer.from('blob content'),
        key: 'memory-test-id-abc123',
        metadata: {
          contentType: 'text/plain',
          originalName: 'test.txt',
          size: 12,
        },
      } as StoredBlob)

      storeStub.onCall(1).resolves({}) // For updated memory

      const attachment = await memoryManager.attachBlob('test-id', Buffer.from('blob content'), {
        name: 'test.txt',
        type: 'text/plain',
      })

      expect(attachment.blobKey).to.include('memory-test-id')
      expect(attachment.name).to.equal('test.txt')
      expect(attachment.type).to.equal('text/plain')
      expect(attachment.size).to.equal(12)
    })

    it('should rollback blob if memory update fails', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      storeStub.onCall(0).resolves({
        content: Buffer.from('blob'),
        key: 'blob-key',
        metadata: { size: 4 },
      } as StoredBlob)

      storeStub.onCall(1).rejects(new Error('Storage error'))

      try {
        await memoryManager.attachBlob('test-id', Buffer.from('blob'))
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        // Verify rollback: delete was called for the blob
        expect(deleteStub.calledOnce).to.be.true
      }
    })
  })

  describe('detachBlob', () => {
    it('should detach a blob from memory', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        metadata: {
          attachments: [
            { blobKey: 'blob-1', createdAt: 1000, size: 100, type: 'text/plain' },
          ],
        },
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      deleteStub.resolves()
      storeStub.resolves({})

      await memoryManager.detachBlob('test-id', 'blob-1')

      expect(deleteStub.calledOnceWith('blob-1')).to.be.true
      expect(storeStub.calledOnce).to.be.true
    })

    it('should throw error if attachment not found', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      try {
        await memoryManager.detachBlob('test-id', 'non-existent-blob')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as Error).message).to.include('Attachment not found')
      }
    })
  })

  describe('getAttachment', () => {
    it('should retrieve attachment blob', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        metadata: {
          attachments: [
            { blobKey: 'blob-1', createdAt: 1000, size: 100, type: 'text/plain' },
          ],
        },
        updatedAt: 1000,
      }

      retrieveStub.onCall(0).resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      retrieveStub.onCall(1).resolves({
        content: Buffer.from('blob content'),
        key: 'blob-1',
        metadata: { size: 12 },
      })

      const blob = await memoryManager.getAttachment('test-id', 'blob-1')

      expect(blob).to.exist
      expect(blob!.key).to.equal('blob-1')
      expect(blob!.content).to.deep.equal(Buffer.from('blob content'))
    })

    it('should throw error if attachment not in memory metadata', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      try {
        await memoryManager.getAttachment('test-id', 'blob-1')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as Error).message).to.include('Attachment not found')
      }
    })
  })

  describe('listAttachments', () => {
    it('should list all attachments for a memory', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        metadata: {
          attachments: [
            { blobKey: 'blob-1', createdAt: 1000, name: 'file1.txt', size: 100, type: 'text/plain' },
            { blobKey: 'blob-2', createdAt: 2000, name: 'file2.txt', size: 200, type: 'text/plain' },
          ],
        },
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      const attachments = await memoryManager.listAttachments('test-id')

      expect(attachments).to.have.lengthOf(2)
      expect(attachments[0].name).to.equal('file1.txt')
      expect(attachments[1].name).to.equal('file2.txt')
    })

    it('should return empty array if no attachments', async () => {
      const mockMemory = {
        content: 'Test',
        createdAt: 1000,
        id: 'test-id',
        updatedAt: 1000,
      }

      retrieveStub.resolves({
        content: Buffer.from(JSON.stringify(mockMemory)),
        key: 'memory-test-id',
        metadata: {},
      })

      const attachments = await memoryManager.listAttachments('test-id')

      expect(attachments).to.be.an('array')
      expect(attachments).to.have.lengthOf(0)
    })
  })
})
