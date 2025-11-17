import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import type {Attachment} from '../../../../../src/core/domain/cipher/memory/types.js'

import {FileBlobStorage} from '../../../../../src/infra/cipher/blob/file-blob-storage.js'
import {MemoryError} from '../../../../../src/infra/cipher/memory/index.js'
import {MemoryManager} from '../../../../../src/infra/cipher/memory/memory-manager.js'

describe('MemoryManager - Blob Attachments', () => {
  let memoryManager: MemoryManager
  let blobStorage: FileBlobStorage
  let testDir: string

  beforeEach(async () => {
    stub(console, 'log')
    stub(console, 'warn')

    // Create temporary test directory
    testDir = join(tmpdir(), `memory-blob-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})

    // Initialize blob storage
    blobStorage = new FileBlobStorage({
      maxBlobSize: 1024 * 1024, // 1MB for tests
      maxTotalSize: 5 * 1024 * 1024, // 5MB for tests
      storageDir: join(testDir, 'blobs'),
    })
    await blobStorage.initialize()

    // Initialize memory manager with blob storage
    memoryManager = new MemoryManager(blobStorage)
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, {force: true, recursive: true})
    }

    restore()
  })

  describe('constructor', () => {
    it('should initialize with blob storage', () => {
      expect(memoryManager).to.exist
    })
  })

  describe('attachBlob', () => {
    it('should attach a blob to a memory with Buffer content', async () => {
      // Create a memory first
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      // Attach blob
      const content = Buffer.from('Hello, World!')
      const attachment = await memoryManager.attachBlob(memory.id, content, {
        name: 'test.txt',
        type: 'text/plain',
      })

      // Verify attachment metadata
      expect(attachment.blobKey).to.be.a('string')
      expect(attachment.blobKey).to.include(`memory-${memory.id}`)
      expect(attachment.name).to.equal('test.txt')
      expect(attachment.type).to.equal('text/plain')
      expect(attachment.size).to.equal(content.length)
      expect(attachment.createdAt).to.be.a('number')

      // Verify memory was updated
      const updatedMemory = await memoryManager.get(memory.id)
      expect(updatedMemory.metadata?.attachments).to.be.an('array')
      expect(updatedMemory.metadata?.attachments).to.have.lengthOf(1)
      const attachments = updatedMemory.metadata?.attachments as Attachment[]
      expect(attachments[0]).to.deep.equal(attachment)
    })

    it('should attach a blob with string content', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const content = 'String content'
      const attachment = await memoryManager.attachBlob(memory.id, content)

      expect(attachment.size).to.equal(Buffer.from(content).length)
    })

    it('should attach multiple blobs to the same memory', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      // Attach first blob
      const attachment1 = await memoryManager.attachBlob(memory.id, Buffer.from('First file'), {
        name: 'file1.txt',
        type: 'text/plain',
      })

      // Attach second blob
      const attachment2 = await memoryManager.attachBlob(memory.id, Buffer.from('Second file'), {
        name: 'file2.txt',
        type: 'text/plain',
      })

      // Verify memory has both attachments
      const updatedMemory = await memoryManager.get(memory.id)
      expect(updatedMemory.metadata?.attachments).to.have.lengthOf(2)
      const attachments = updatedMemory.metadata?.attachments as Attachment[]
      expect(attachments[0].blobKey).to.equal(attachment1.blobKey)
      expect(attachments[1].blobKey).to.equal(attachment2.blobKey)
    })

    it('should throw error if memory does not exist', async () => {
      try {
        await memoryManager.attachBlob('nonexistent-id', Buffer.from('test'))
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })

    it('should rollback blob if memory update fails', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      // Sabotage the storage by deleting the memory blob directly
      await blobStorage.delete(`memory-${memory.id}`)

      try {
        await memoryManager.attachBlob(memory.id, Buffer.from('test'), {
          name: 'test.txt',
        })
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)

        // Verify attachment blob was not left behind (rollback worked)
        const blobs = await blobStorage.list(`memory-${memory.id}-`)
        expect(blobs).to.have.lengthOf(0)
      }
    })

    it('should handle metadata without name and type', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachment = await memoryManager.attachBlob(memory.id, Buffer.from('test'))

      expect(attachment.name).to.be.undefined
      expect(attachment.type).to.equal('application/octet-stream')
    })
  })

  describe('detachBlob', () => {
    it('should detach a blob from a memory', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachment = await memoryManager.attachBlob(memory.id, Buffer.from('test'), {name: 'test.txt'})

      // Detach the blob
      await memoryManager.detachBlob(memory.id, attachment.blobKey)

      // Verify blob was deleted
      const exists = await blobStorage.exists(attachment.blobKey)
      expect(exists).to.be.false

      // Verify memory metadata was updated
      const updatedMemory = await memoryManager.get(memory.id)
      expect(updatedMemory.metadata?.attachments).to.be.an('array')
      expect(updatedMemory.metadata?.attachments).to.have.lengthOf(0)
    })

    it('should detach specific blob when multiple attachments exist', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachment1 = await memoryManager.attachBlob(memory.id, Buffer.from('file1'), {name: 'file1.txt'})
      const attachment2 = await memoryManager.attachBlob(memory.id, Buffer.from('file2'), {name: 'file2.txt'})

      // Detach first blob
      await memoryManager.detachBlob(memory.id, attachment1.blobKey)

      // Verify only second attachment remains
      const updatedMemory = await memoryManager.get(memory.id)
      expect(updatedMemory.metadata?.attachments).to.have.lengthOf(1)
      const attachments = updatedMemory.metadata?.attachments as Attachment[]
      expect(attachments[0].blobKey).to.equal(attachment2.blobKey)

      // Verify first blob was deleted, second blob still exists
      expect(await blobStorage.exists(attachment1.blobKey)).to.be.false
      expect(await blobStorage.exists(attachment2.blobKey)).to.be.true
    })

    it('should throw error if memory does not exist', async () => {
      try {
        await memoryManager.detachBlob('nonexistent-id', 'some-blob-key')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })

    it('should throw error if attachment not found', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      try {
        await memoryManager.detachBlob(memory.id, 'nonexistent-blob-key')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).message).to.include('Attachment not found')
      }
    })
  })

  describe('getAttachment', () => {
    it('should retrieve blob content', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const originalContent = Buffer.from('Hello, World!')
      const attachment = await memoryManager.attachBlob(memory.id, originalContent, {
        name: 'test.txt',
        type: 'text/plain',
      })

      // Get the attachment
      const storedBlob = await memoryManager.getAttachment(memory.id, attachment.blobKey)

      expect(storedBlob).to.exist
      expect(storedBlob!.key).to.equal(attachment.blobKey)
      expect(storedBlob!.content).to.deep.equal(originalContent)
      expect(storedBlob!.metadata.size).to.equal(originalContent.length)
      expect(storedBlob!.metadata.contentType).to.equal('text/plain')
      expect(storedBlob!.metadata.originalName).to.equal('test.txt')
    })

    it('should throw error if memory does not exist', async () => {
      try {
        await memoryManager.getAttachment('nonexistent-id', 'some-blob-key')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })

    it('should throw error if attachment not found in memory metadata', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      try {
        await memoryManager.getAttachment(memory.id, 'nonexistent-blob-key')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).message).to.include('Attachment not found')
      }
    })

    it('should handle case when blob was deleted from storage but still in metadata', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachment = await memoryManager.attachBlob(memory.id, Buffer.from('test'))

      // Manually delete blob from storage
      await blobStorage.delete(attachment.blobKey)

      try {
        await memoryManager.getAttachment(memory.id, attachment.blobKey)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
        expect((error as MemoryError).message).to.include('Failed to retrieve attachment')
      }
    })
  })

  describe('listAttachments', () => {
    it('should list all attachments for a memory', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      await memoryManager.attachBlob(memory.id, Buffer.from('file1'), {
        name: 'file1.txt',
      })
      await memoryManager.attachBlob(memory.id, Buffer.from('file2'), {
        name: 'file2.txt',
      })
      await memoryManager.attachBlob(memory.id, Buffer.from('file3'), {
        name: 'file3.txt',
      })

      const attachments = await memoryManager.listAttachments(memory.id)

      expect(attachments).to.have.lengthOf(3)
      expect(attachments[0].name).to.equal('file1.txt')
      expect(attachments[1].name).to.equal('file2.txt')
      expect(attachments[2].name).to.equal('file3.txt')
    })

    it('should return empty array if no attachments', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachments = await memoryManager.listAttachments(memory.id)

      expect(attachments).to.be.an('array')
      expect(attachments).to.have.lengthOf(0)
    })

    it('should throw error if memory does not exist', async () => {
      try {
        await memoryManager.listAttachments('nonexistent-id')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })
  })

  describe('delete - cascade to blobs', () => {
    it('should delete all attachments when deleting a memory', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachment1 = await memoryManager.attachBlob(memory.id, Buffer.from('file1'))
      const attachment2 = await memoryManager.attachBlob(memory.id, Buffer.from('file2'))

      // Delete the memory
      await memoryManager.delete(memory.id)

      // Verify blobs were deleted
      expect(await blobStorage.exists(attachment1.blobKey)).to.be.false
      expect(await blobStorage.exists(attachment2.blobKey)).to.be.false

      // Verify memory was deleted
      try {
        await memoryManager.get(memory.id)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })

    it('should delete memory even if blob deletion fails', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      const attachment = await memoryManager.attachBlob(memory.id, Buffer.from('test'))

      // Manually delete blob to cause deletion failure
      await blobStorage.delete(attachment.blobKey)

      // Delete should succeed even though blob is already gone
      await memoryManager.delete(memory.id)

      // Verify memory was deleted
      try {
        await memoryManager.get(memory.id)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })

    it('should not fail when deleting memory without attachments', async () => {
      const memory = await memoryManager.create({
        content: 'Test memory',
      })

      await memoryManager.delete(memory.id)

      // Verify memory was deleted
      try {
        await memoryManager.get(memory.id)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(MemoryError)
      }
    })
  })

  describe('integration scenarios', () => {
    it('should handle complete attachment lifecycle', async () => {
      // Create memory
      const memory = await memoryManager.create({
        content: 'Project notes',
        tags: ['work', 'important'],
      })

      // Attach multiple files
      const doc1 = await memoryManager.attachBlob(memory.id, Buffer.from('Meeting notes'), {
        name: 'meeting.txt',
        type: 'text/plain',
      })

      const doc2 = await memoryManager.attachBlob(memory.id, Buffer.from(JSON.stringify({data: 'test'})), {
        name: 'data.json',
        type: 'application/json',
      })

      // List attachments
      let attachments = await memoryManager.listAttachments(memory.id)
      expect(attachments).to.have.lengthOf(2)

      // Get specific attachment
      const retrieved = await memoryManager.getAttachment(memory.id, doc1.blobKey)
      expect(retrieved!.content.toString()).to.equal('Meeting notes')

      // Detach one attachment
      await memoryManager.detachBlob(memory.id, doc1.blobKey)
      attachments = await memoryManager.listAttachments(memory.id)
      expect(attachments).to.have.lengthOf(1)
      expect(attachments[0].blobKey).to.equal(doc2.blobKey)

      // Update memory content (attachments should persist)
      await memoryManager.update(memory.id, {
        content: 'Updated project notes',
      })

      const updatedMemory = await memoryManager.get(memory.id)
      expect(updatedMemory.content).to.equal('Updated project notes')
      expect(updatedMemory.metadata?.attachments).to.have.lengthOf(1)

      // Delete memory (should cascade to remaining attachment)
      await memoryManager.delete(memory.id)
      expect(await blobStorage.exists(doc2.blobKey)).to.be.false
    })

    it('should handle attachments with existing memory metadata', async () => {
      const memory = await memoryManager.create({
        content: 'Test',
        metadata: {
          customField: 'value',
          pinned: true,
          source: 'user' as const,
        },
      })

      // Attach blob
      await memoryManager.attachBlob(memory.id, Buffer.from('test'))

      // Verify existing metadata is preserved
      const updated = await memoryManager.get(memory.id)
      expect(updated.metadata?.customField).to.equal('value')
      expect(updated.metadata?.pinned).to.be.true
      expect(updated.metadata?.source).to.equal('user')
      expect(updated.metadata?.attachments).to.have.lengthOf(1)
    })
  })

  describe('edge cases', () => {
    it('should handle empty buffer attachment', async () => {
      const memory = await memoryManager.create({
        content: 'Test',
      })

      const attachment = await memoryManager.attachBlob(memory.id, Buffer.from(''))

      expect(attachment.size).to.equal(0)

      const retrieved = await memoryManager.getAttachment(memory.id, attachment.blobKey)
      expect(retrieved!.content.length).to.equal(0)
    })

    it('should handle binary data attachments', async () => {
      const memory = await memoryManager.create({
        content: 'Test',
      })

      const binaryData = Buffer.from([0x00, 0xff, 0xaa, 0x55, 0x12, 0x34])
      const attachment = await memoryManager.attachBlob(memory.id, binaryData, {
        name: 'binary.dat',
        type: 'application/octet-stream',
      })

      const retrieved = await memoryManager.getAttachment(memory.id, attachment.blobKey)
      expect(retrieved!.content).to.deep.equal(binaryData)
    })

    it('should handle attachments with no metadata.attachments initially', async () => {
      const memory = await memoryManager.create({
        content: 'Test',
        metadata: {
          customField: 'value',
        },
      })

      // Verify attachments array doesn't exist initially
      expect(memory.metadata?.attachments).to.be.undefined

      // Attach blob
      await memoryManager.attachBlob(memory.id, Buffer.from('test'))

      // Verify attachments array was created
      const updated = await memoryManager.get(memory.id)
      expect(updated.metadata?.attachments).to.be.an('array')
      expect(updated.metadata?.attachments).to.have.lengthOf(1)
    })
  })
})
