import {expect} from 'chai'

import {Memory} from '../../../../src/core/domain/entities/memory.js'
import {RetrieveResult} from '../../../../src/core/domain/entities/retrieve-result.js'
import {
  transformMemoryToBullet,
  transformRetrieveResultToPlaybook,
} from '../../../../src/infra/memory/memory-to-playbook-mapper.js'

describe('Memory to Playbook Mapper', () => {
  const validMemory = new Memory({
    bulletId: 'lessons-00001',
    childrenIds: ['child-1'],
    content: 'Production-ready implementation with best practices',
    id: '019a2a2e-a278-7201-b15d-b54f5d1471e8',
    metadataType: 'experience',
    nodeKeys: ['src/auth/login.ts', 'src/auth/oauth.ts'],
    parentIds: [],
    score: 0.85,
    section: 'Lessons Learned',
    tags: ['typescript', 'authentication', 'best-practices'],
    timestamp: '2025-10-26T15:59:01.191Z',
    title: 'Authentication Best Practices',
  })

  describe('transformMemoryToBullet', () => {
    it('should transform Memory to Bullet with correct mapping', () => {
      const bullet = transformMemoryToBullet(validMemory)

      expect(bullet.id).to.equal('lessons-00001')
      expect(bullet.section).to.equal('Lessons Learned')
      expect(bullet.content).to.equal('Production-ready implementation with best practices')
      expect(bullet.metadata.tags).to.deep.equal(['typescript', 'authentication', 'best-practices'])
      expect(bullet.metadata.relatedFiles).to.deep.equal(['src/auth/login.ts', 'src/auth/oauth.ts'])
      expect(bullet.metadata.timestamp).to.equal('2025-10-26T15:59:01.191Z')
    })

    it('should create defensive copies of arrays', () => {
      const bullet = transformMemoryToBullet(validMemory)

      // Verify arrays are independent
      expect(bullet.metadata.tags).to.not.equal(validMemory.tags)
      expect(bullet.metadata.relatedFiles).to.not.equal(validMemory.nodeKeys)
    })

    it('should handle memory with empty node keys', () => {
      const memoryWithEmptyNodeKeys = new Memory({
        ...validMemory.toJson(),
        nodeKeys: [],
      })

      const bullet = transformMemoryToBullet(memoryWithEmptyNodeKeys)

      expect(bullet.metadata.relatedFiles).to.deep.equal([])
    })

    it('should preserve all tags from memory', () => {
      const memoryWithMultipleTags = new Memory({
        ...validMemory.toJson(),
        tags: ['tag1', 'tag2', 'tag3', 'tag4'],
      })

      const bullet = transformMemoryToBullet(memoryWithMultipleTags)

      expect(bullet.metadata.tags).to.deep.equal(['tag1', 'tag2', 'tag3', 'tag4'])
    })
  })

  describe('transformRetrieveResultToPlaybook', () => {
    it('should transform RetrieveResult with memories to Playbook', () => {
      const memory1 = new Memory({
        bulletId: 'lessons-00001',
        childrenIds: [],
        content: 'First lesson content',
        id: 'id-1',
        metadataType: 'experience',
        nodeKeys: ['file1.ts'],
        parentIds: [],
        score: 0.9,
        section: 'Lessons Learned',
        tags: ['typescript'],
        timestamp: '2025-10-26T10:00:00.000Z',
        title: 'Lesson 1',
      })

      const memory2 = new Memory({
        bulletId: 'lessons-00002',
        childrenIds: [],
        content: 'Second lesson content',
        id: 'id-2',
        metadataType: 'experience',
        nodeKeys: ['file2.ts'],
        parentIds: [],
        score: 0.85,
        section: 'Lessons Learned',
        tags: ['javascript'],
        timestamp: '2025-10-26T11:00:00.000Z',
        title: 'Lesson 2',
      })

      const retrieveResult = new RetrieveResult({
        memories: [memory1, memory2],
        relatedMemories: [],
      })

      const playbook = transformRetrieveResultToPlaybook(retrieveResult)

      expect(playbook.getBullets()).to.have.lengthOf(2)
      expect(playbook.getBullet('lessons-00001')).to.exist
      expect(playbook.getBullet('lessons-00002')).to.exist
      expect(playbook.getSections()).to.deep.equal(['Lessons Learned'])
    })

    it('should combine memories and relatedMemories', () => {
      const directMemory = new Memory({
        bulletId: 'lessons-00001',
        childrenIds: [],
        content: 'Direct match',
        id: 'id-1',
        metadataType: 'experience',
        nodeKeys: [],
        parentIds: [],
        score: 0.9,
        section: 'Lessons Learned',
        tags: ['direct'],
        timestamp: '2025-10-26T10:00:00.000Z',
        title: 'Direct',
      })

      const relatedMemory = new Memory({
        bulletId: 'common-00001',
        childrenIds: [],
        content: 'Related match',
        id: 'id-2',
        metadataType: 'knowledge',
        nodeKeys: [],
        parentIds: [],
        score: 0.7,
        section: 'Common Errors',
        tags: ['related'],
        timestamp: '2025-10-26T11:00:00.000Z',
        title: 'Related',
      })

      const retrieveResult = new RetrieveResult({
        memories: [directMemory],
        relatedMemories: [relatedMemory],
      })

      const playbook = transformRetrieveResultToPlaybook(retrieveResult)

      expect(playbook.getBullets()).to.have.lengthOf(2)
      expect(playbook.getBullet('lessons-00001')).to.exist
      expect(playbook.getBullet('common-00001')).to.exist
    })

    it('should group bullets by section correctly', () => {
      const lesson1 = new Memory({
        bulletId: 'lessons-00001',
        childrenIds: [],
        content: 'Lesson 1',
        id: 'id-1',
        metadataType: 'experience',
        nodeKeys: [],
        parentIds: [],
        score: 0.9,
        section: 'Lessons Learned',
        tags: ['tag1'],
        timestamp: '2025-10-26T10:00:00.000Z',
        title: 'Lesson 1',
      })

      const lesson2 = new Memory({
        bulletId: 'lessons-00002',
        childrenIds: [],
        content: 'Lesson 2',
        id: 'id-2',
        metadataType: 'experience',
        nodeKeys: [],
        parentIds: [],
        score: 0.85,
        section: 'Lessons Learned',
        tags: ['tag2'],
        timestamp: '2025-10-26T11:00:00.000Z',
        title: 'Lesson 2',
      })

      const error1 = new Memory({
        bulletId: 'common-00001',
        childrenIds: [],
        content: 'Common error',
        id: 'id-3',
        metadataType: 'knowledge',
        nodeKeys: [],
        parentIds: [],
        score: 0.8,
        section: 'Common Errors',
        tags: ['error'],
        timestamp: '2025-10-26T12:00:00.000Z',
        title: 'Error 1',
      })

      const retrieveResult = new RetrieveResult({
        memories: [lesson1, lesson2, error1],
        relatedMemories: [],
      })

      const playbook = transformRetrieveResultToPlaybook(retrieveResult)

      expect(playbook.getSections()).to.have.members(['Common Errors', 'Lessons Learned'])
      expect(playbook.getBulletsInSection('Lessons Learned')).to.have.lengthOf(2)
      expect(playbook.getBulletsInSection('Common Errors')).to.have.lengthOf(1)
    })

    it('should set nextId to total memories/bullets + 1', () => {
      const memory = new Memory({
        bulletId: 'lessons-00001',
        childrenIds: [],
        content: 'Content',
        id: 'id-1',
        metadataType: 'experience',
        nodeKeys: [],
        parentIds: [],
        score: 0.9,
        section: 'Lessons Learned',
        tags: ['tag'],
        timestamp: '2025-10-26T10:00:00.000Z',
        title: 'Title',
      })

      const retrieveResult = new RetrieveResult({
        memories: [memory],
        relatedMemories: [],
      })

      const playbook = transformRetrieveResultToPlaybook(retrieveResult)

      // Verify nextId by checking the JSON output
      const playbookJson = playbook.toJson()
      expect(playbookJson.nextId).to.equal(retrieveResult.memories.length + retrieveResult.relatedMemories.length + 1)
    })

    it('should handle empty retrieve result', () => {
      const retrieveResult = new RetrieveResult({
        memories: [],
        relatedMemories: [],
      })

      const playbook = transformRetrieveResultToPlaybook(retrieveResult)

      expect(playbook.getBullets()).to.have.lengthOf(0)
      expect(playbook.getSections()).to.have.lengthOf(0)
    })

    it('should handle retrieve result with only related memories', () => {
      const relatedMemory = new Memory({
        bulletId: 'common-00001',
        childrenIds: [],
        content: 'Related content',
        id: 'id-1',
        metadataType: 'knowledge',
        nodeKeys: [],
        parentIds: [],
        score: 0.7,
        section: 'Common Errors',
        tags: ['error'],
        timestamp: '2025-10-26T10:00:00.000Z',
        title: 'Error',
      })

      const retrieveResult = new RetrieveResult({
        memories: [],
        relatedMemories: [relatedMemory],
      })

      const playbook = transformRetrieveResultToPlaybook(retrieveResult)

      expect(playbook.getBullets()).to.have.lengthOf(1)
      expect(playbook.getBullet('common-00001')).to.exist
    })
  })
})
