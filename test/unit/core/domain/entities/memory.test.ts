import {expect} from 'chai'

import {Memory} from '../../../../../src/core/domain/entities/memory.js'

describe('Memory Entity', () => {
  const validMemoryData = {
    childrenIds: ['child-id-1'],
    content: 'This is test content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    nodeKeys: ['path1', 'path2'],
    parentIds: ['parent-id-1'],
    score: 0.85,
    title: 'Test Memory',
  }

  const minimalMemoryData = {
    childrenIds: [],
    content: 'Test content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    nodeKeys: [],
    parentIds: [],
    score: 0.5,
    title: 'Test Memory',
  }

  describe('Constructor', () => {
    it('should create a valid Memory instance', () => {
      const memory = new Memory(validMemoryData)

      expect(memory.id).to.equal(validMemoryData.id)
      expect(memory.title).to.equal(validMemoryData.title)
      expect(memory.content).to.equal(validMemoryData.content)
      expect(memory.score).to.equal(validMemoryData.score)
      expect(memory.nodeKeys).to.deep.equal(validMemoryData.nodeKeys)
      expect(memory.parentIds).to.deep.equal(validMemoryData.parentIds)
      expect(memory.childrenIds).to.deep.equal(validMemoryData.childrenIds)
    })

    it('should create a Memory with empty arrays', () => {
      const memory = new Memory(minimalMemoryData)

      expect(memory.nodeKeys).to.deep.equal([])
      expect(memory.parentIds).to.deep.equal([])
      expect(memory.childrenIds).to.deep.equal([])
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
  })

  describe('Immutability', () => {
    it('should not expose mutable array references', () => {
      const originalNodeKeys = ['path1', 'path2']
      const originalParentIds = ['parent1']
      const originalChildrenIds = ['child1']

      const memory = new Memory({
        ...minimalMemoryData,
        childrenIds: originalChildrenIds,
        nodeKeys: originalNodeKeys,
        parentIds: originalParentIds,
      })

      // Mutating original arrays should not affect memory instance
      originalNodeKeys.push('path3')
      originalParentIds.push('parent2')
      originalChildrenIds.push('child2')

      expect(memory.nodeKeys).to.deep.equal(['path1', 'path2'])
      expect(memory.parentIds).to.deep.equal(['parent1'])
      expect(memory.childrenIds).to.deep.equal(['child1'])
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
    })
  })

  describe('fromJSON', () => {
    it('should deserialize Memory from JSON', () => {
      const memory = Memory.fromJson(validMemoryData)

      expect(memory.id).to.equal(validMemoryData.id)
      expect(memory.title).to.equal(validMemoryData.title)
      expect(memory.content).to.equal(validMemoryData.content)
      expect(memory.score).to.equal(validMemoryData.score)
      expect(memory.nodeKeys).to.deep.equal(validMemoryData.nodeKeys)
      expect(memory.parentIds).to.deep.equal(validMemoryData.parentIds)
      expect(memory.childrenIds).to.deep.equal(validMemoryData.childrenIds)
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
      expect(restored.title).to.equal(original.title)
      expect(restored.content).to.equal(original.content)
      expect(restored.score).to.equal(original.score)
      expect(restored.nodeKeys).to.deep.equal(original.nodeKeys)
      expect(restored.parentIds).to.deep.equal(original.parentIds)
      expect(restored.childrenIds).to.deep.equal(original.childrenIds)
    })
  })
})
