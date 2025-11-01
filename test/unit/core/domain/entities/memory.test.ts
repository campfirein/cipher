import {expect} from 'chai'

import {Memory} from '../../../../../src/core/domain/entities/memory.js'

describe('Memory Entity', () => {
  const validMemoryData = {
    bulletId: 'lessons-00001',
    childrenIds: ['child-id-1'],
    content: 'This is test content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    metadataType: 'experience',
    nodeKeys: ['path1', 'path2'],
    parentIds: ['parent-id-1'],
    score: 0.85,
    section: 'Lessons Learned',
    tags: ['typescript', 'testing'],
    timestamp: '2025-10-26T15:59:01.191Z',
    title: 'Test Memory',
  }

  const minimalMemoryData = {
    bulletId: 'common-00001',
    childrenIds: [],
    content: 'Test content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    metadataType: 'knowledge',
    nodeKeys: [],
    parentIds: [],
    score: 0.5,
    section: 'Common Errors',
    tags: ['manual'],
    timestamp: '2025-10-27T09:00:00.000Z',
    title: 'Test Memory',
  }

  describe('Constructor', () => {
    it('should create a valid Memory instance', () => {
      const memory = new Memory(validMemoryData)

      expect(memory.id).to.equal(validMemoryData.id)
      expect(memory.bulletId).to.equal(validMemoryData.bulletId)
      expect(memory.title).to.equal(validMemoryData.title)
      expect(memory.content).to.equal(validMemoryData.content)
      expect(memory.score).to.equal(validMemoryData.score)
      expect(memory.section).to.equal(validMemoryData.section)
      expect(memory.metadataType).to.equal(validMemoryData.metadataType)
      expect(memory.timestamp).to.equal(validMemoryData.timestamp)
      expect(memory.nodeKeys).to.deep.equal(validMemoryData.nodeKeys)
      expect(memory.parentIds).to.deep.equal(validMemoryData.parentIds)
      expect(memory.childrenIds).to.deep.equal(validMemoryData.childrenIds)
      expect(memory.tags).to.deep.equal(validMemoryData.tags)
    })

    it('should create a Memory with empty arrays', () => {
      const memory = new Memory(minimalMemoryData)

      expect(memory.nodeKeys).to.deep.equal([])
      expect(memory.parentIds).to.deep.equal([])
      expect(memory.childrenIds).to.deep.equal([])
      expect(memory.tags).to.deep.equal(['manual'])
    })

    it('should create a Memory with undefined score, parentIds, and childrenIds', () => {
      const relatedMemoryData = {
        bulletId: 'related-00001',
        content: 'Related memory content',
        id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
        metadataType: 'knowledge',
        nodeKeys: ['path1'],
        section: 'Common Errors',
        tags: ['error'],
        timestamp: '2025-10-26T16:00:00.000Z',
        title: 'Related Memory',
      }

      const memory = new Memory(relatedMemoryData)

      expect(memory.id).to.equal(relatedMemoryData.id)
      expect(memory.bulletId).to.equal(relatedMemoryData.bulletId)
      expect(memory.title).to.equal(relatedMemoryData.title)
      expect(memory.content).to.equal(relatedMemoryData.content)
      expect(memory.section).to.equal(relatedMemoryData.section)
      expect(memory.nodeKeys).to.deep.equal(relatedMemoryData.nodeKeys)
      expect(memory.tags).to.deep.equal(relatedMemoryData.tags)
      // Optional fields should be undefined
      expect(memory.score).to.be.undefined
      expect(memory.parentIds).to.be.undefined
      expect(memory.childrenIds).to.be.undefined
    })

    it('should distinguish primary memories (with score) from related memories (without score)', () => {
      const primaryMemory = new Memory(validMemoryData)
      const relatedMemory = new Memory({
        bulletId: 'related-00001',
        content: 'Related content',
        id: '019a1e9f-a5ec-7046-956d-27cdff4b6b69',
        metadataType: 'knowledge',
        nodeKeys: [],
        section: 'Common Errors',
        tags: [],
        timestamp: '2025-10-26T16:00:00.000Z',
        title: 'Related',
      })

      // Primary memory has score
      expect(primaryMemory.score).to.equal(0.85)
      expect(primaryMemory.parentIds).to.deep.equal(['parent-id-1'])
      expect(primaryMemory.childrenIds).to.deep.equal(['child-id-1'])

      // Related memory doesn't have score
      expect(relatedMemory.score).to.be.undefined
      expect(relatedMemory.parentIds).to.be.undefined
      expect(relatedMemory.childrenIds).to.be.undefined
    })

    it('should throw error when id is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            id: '',
          }),
      ).to.throw('Memory ID cannot be empty')
    })

    it('should throw error when id is whitespace', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            id: '   ',
          }),
      ).to.throw('Memory ID cannot be empty')
    })

    it('should throw error when title is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            title: '',
          }),
      ).to.throw('Memory title cannot be empty')
    })

    it('should throw error when content is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            content: '',
          }),
      ).to.throw('Memory content cannot be empty')
    })

    it('should throw error when score is less than 0', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            score: -0.1,
          }),
      ).to.throw('Memory score must be between 0.0 and 1.0')
    })

    it('should throw error when score is greater than 1', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            score: 1.1,
          }),
      ).to.throw('Memory score must be between 0.0 and 1.0')
    })

    it('should accept score of exactly 0', () => {
      const memory = new Memory({
        ...minimalMemoryData,
        score: 0,
      })

      expect(memory.score).to.equal(0)
    })

    it('should accept score of exactly 1', () => {
      const memory = new Memory({
        ...minimalMemoryData,
        score: 1,
      })

      expect(memory.score).to.equal(1)
    })

    it('should throw error when bulletId is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            bulletId: '',
          }),
      ).to.throw('Memory bulletId cannot be empty')
    })

    it('should throw error when bulletId is whitespace', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            bulletId: '   ',
          }),
      ).to.throw('Memory bulletId cannot be empty')
    })

    it('should throw error when section is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            section: '',
          }),
      ).to.throw('Memory section cannot be empty')
    })

    it('should throw error when section is whitespace', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            section: '   ',
          }),
      ).to.throw('Memory section cannot be empty')
    })

    it('should throw error when timestamp is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            timestamp: '',
          }),
      ).to.throw('Memory timestamp cannot be empty')
    })

    it('should throw error when timestamp is whitespace', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            timestamp: '   ',
          }),
      ).to.throw('Memory timestamp cannot be empty')
    })

    it('should throw error when metadataType is empty', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            metadataType: '',
          }),
      ).to.throw('Memory metadataType cannot be empty')
    })

    it('should throw error when metadataType is whitespace', () => {
      expect(
        () =>
          new Memory({
            ...minimalMemoryData,
            metadataType: '   ',
          }),
      ).to.throw('Memory metadataType cannot be empty')
    })
  })

  describe('Immutability', () => {
    it('should not expose mutable array references', () => {
      const originalNodeKeys = ['path1', 'path2']
      const originalParentIds = ['parent1']
      const originalChildrenIds = ['child1']
      const originalTags = ['typescript', 'testing']

      const memory = new Memory({
        ...minimalMemoryData,
        childrenIds: originalChildrenIds,
        nodeKeys: originalNodeKeys,
        parentIds: originalParentIds,
        tags: originalTags,
      })

      // Mutating original arrays should not affect memory instance
      originalNodeKeys.push('path3')
      originalParentIds.push('parent2')
      originalChildrenIds.push('child2')
      originalTags.push('performance')

      expect(memory.nodeKeys).to.deep.equal(['path1', 'path2'])
      expect(memory.parentIds).to.deep.equal(['parent1'])
      expect(memory.childrenIds).to.deep.equal(['child1'])
      expect(memory.tags).to.deep.equal(['typescript', 'testing'])
    })
  })

  describe('toJSON', () => {
    it('should serialize Memory to JSON', () => {
      const memory = new Memory(validMemoryData)

      const json = memory.toJson()

      expect(json).to.deep.equal(validMemoryData)
    })

    it('should serialize Memory with empty arrays to JSON', () => {
      const memory = new Memory(minimalMemoryData)

      const json = memory.toJson()

      expect(json.nodeKeys).to.deep.equal([])
      expect(json.parentIds).to.deep.equal([])
      expect(json.childrenIds).to.deep.equal([])
      expect(json.tags).to.deep.equal(['manual'])
      expect(json.bulletId).to.equal('common-00001')
      expect(json.section).to.equal('Common Errors')
      expect(json.timestamp).to.equal('2025-10-27T09:00:00.000Z')
      expect(json.metadataType).to.equal('knowledge')
    })
  })

  describe('fromJSON', () => {
    it('should deserialize Memory from JSON', () => {
      const memory = Memory.fromJson(validMemoryData)

      expect(memory.id).to.equal(validMemoryData.id)
      expect(memory.bulletId).to.equal(validMemoryData.bulletId)
      expect(memory.title).to.equal(validMemoryData.title)
      expect(memory.content).to.equal(validMemoryData.content)
      expect(memory.score).to.equal(validMemoryData.score)
      expect(memory.section).to.equal(validMemoryData.section)
      expect(memory.metadataType).to.equal(validMemoryData.metadataType)
      expect(memory.timestamp).to.equal(validMemoryData.timestamp)
      expect(memory.nodeKeys).to.deep.equal(validMemoryData.nodeKeys)
      expect(memory.parentIds).to.deep.equal(validMemoryData.parentIds)
      expect(memory.childrenIds).to.deep.equal(validMemoryData.childrenIds)
      expect(memory.tags).to.deep.equal(validMemoryData.tags)
    })

    it('should handle JSON with empty arrays', () => {
      const memory = Memory.fromJson(minimalMemoryData)

      expect(memory.nodeKeys).to.deep.equal([])
      expect(memory.parentIds).to.deep.equal([])
      expect(memory.childrenIds).to.deep.equal([])
    })

    it('should roundtrip correctly (toJson then fromJson)', () => {
      const original = new Memory(validMemoryData)

      const json = original.toJson()
      const restored = Memory.fromJson(json)

      expect(restored.id).to.equal(original.id)
      expect(restored.bulletId).to.equal(original.bulletId)
      expect(restored.title).to.equal(original.title)
      expect(restored.content).to.equal(original.content)
      expect(restored.score).to.equal(original.score)
      expect(restored.section).to.equal(original.section)
      expect(restored.metadataType).to.equal(original.metadataType)
      expect(restored.timestamp).to.equal(original.timestamp)
      expect(restored.nodeKeys).to.deep.equal(original.nodeKeys)
      expect(restored.parentIds).to.deep.equal(original.parentIds)
      expect(restored.childrenIds).to.deep.equal(original.childrenIds)
      expect(restored.tags).to.deep.equal(original.tags)
    })
  })
})
