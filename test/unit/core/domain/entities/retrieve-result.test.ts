import {expect} from 'chai'

import {Memory} from '../../../../../src/core/domain/entities/memory'
import {RetrieveResult} from '../../../../../src/core/domain/entities/retrieve-result'

describe('RetrieveResult Entity', () => {
  const sampleMemory1 = new Memory({
    bulletId: 'lessons-00001',
    childrenIds: [],
    content: 'First memory content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    metadataType: 'experience',
    nodeKeys: ['path1'],
    parentIds: [],
    score: 0.85,
    section: 'Lessons Learned',
    tags: ['typescript'],
    timestamp: '2025-10-26T10:00:00.000Z',
    title: 'First Memory',
  })

  const sampleMemory2 = new Memory({
    bulletId: 'lessons-00002',
    childrenIds: [],
    content: 'Second memory content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
    metadataType: 'experience',
    nodeKeys: ['path2'],
    parentIds: [],
    score: 0.75,
    section: 'Lessons Learned',
    tags: ['javascript'],
    timestamp: '2025-10-26T11:00:00.000Z',
    title: 'Second Memory',
  })

  const sampleMemory3 = new Memory({
    bulletId: 'common-00001',
    childrenIds: [],
    content: 'Related memory content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b69',
    metadataType: 'knowledge',
    nodeKeys: ['path3'],
    parentIds: [],
    score: 0.5,
    section: 'Common Errors',
    tags: ['error'],
    timestamp: '2025-10-26T12:00:00.000Z',
    title: 'Related Memory',
  })

  describe('Constructor', () => {
    it('should create a valid RetrieveResult instance', () => {
      const result = new RetrieveResult({
        memories: [sampleMemory1, sampleMemory2],
        relatedMemories: [sampleMemory3],
      })

      expect(result.memories).to.have.lengthOf(2)
      expect(result.relatedMemories).to.have.lengthOf(1)
      expect(result.memories[0]).to.equal(sampleMemory1)
      expect(result.memories[1]).to.equal(sampleMemory2)
      expect(result.relatedMemories[0]).to.equal(sampleMemory3)
    })

    it('should create a RetrieveResult with empty arrays', () => {
      const result = new RetrieveResult({
        memories: [],
        relatedMemories: [],
      })

      expect(result.memories).to.deep.equal([])
      expect(result.relatedMemories).to.deep.equal([])
    })

    it('should create a RetrieveResult with memories but no related memories', () => {
      const result = new RetrieveResult({
        memories: [sampleMemory1],
        relatedMemories: [],
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(0)
    })

    it('should create a RetrieveResult with related memories but no memories', () => {
      const result = new RetrieveResult({
        memories: [],
        relatedMemories: [sampleMemory3],
      })

      expect(result.memories).to.have.lengthOf(0)
      expect(result.relatedMemories).to.have.lengthOf(1)
    })
  })

  describe('Immutability', () => {
    it('should not expose mutable array references', () => {
      const originalMemories = [sampleMemory1]
      const originalRelated = [sampleMemory3]

      const result = new RetrieveResult({
        memories: originalMemories,
        relatedMemories: originalRelated,
      })

      // Mutating original arrays should not affect result instance
      originalMemories.push(sampleMemory2)
      originalRelated.push(sampleMemory2)

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(1)
    })
  })

  describe('toJson', () => {
    it('should serialize RetrieveResult to JSON', () => {
      const result = new RetrieveResult({
        memories: [sampleMemory1, sampleMemory2],
        relatedMemories: [sampleMemory3],
      })

      const json = result.toJson()

      expect(json.memories).to.have.lengthOf(2)
      expect(json.relatedMemories).to.have.lengthOf(1)
      expect(json.memories[0]).to.deep.equal(sampleMemory1.toJson())
      expect(json.memories[1]).to.deep.equal(sampleMemory2.toJson())
      expect(json.relatedMemories[0]).to.deep.equal(sampleMemory3.toJson())
    })

    it('should serialize RetrieveResult with empty arrays to JSON', () => {
      const result = new RetrieveResult({
        memories: [],
        relatedMemories: [],
      })

      const json = result.toJson()

      expect(json.memories).to.deep.equal([])
      expect(json.relatedMemories).to.deep.equal([])
    })
  })

  describe('fromJson', () => {
    it('should deserialize RetrieveResult from JSON', () => {
      const json = {
        memories: [sampleMemory1.toJson(), sampleMemory2.toJson()],
        relatedMemories: [sampleMemory3.toJson()],
      }

      const result = RetrieveResult.fromJson(json)

      expect(result.memories).to.have.lengthOf(2)
      expect(result.relatedMemories).to.have.lengthOf(1)
      expect(result.memories[0].id).to.equal(sampleMemory1.id)
      expect(result.memories[1].id).to.equal(sampleMemory2.id)
      expect(result.relatedMemories[0].id).to.equal(sampleMemory3.id)
    })

    it('should handle JSON with empty arrays', () => {
      const json = {
        memories: [],
        relatedMemories: [],
      }

      const result = RetrieveResult.fromJson(json)

      expect(result.memories).to.deep.equal([])
      expect(result.relatedMemories).to.deep.equal([])
    })

    it('should roundtrip correctly (toJson then fromJson)', () => {
      const original = new RetrieveResult({
        memories: [sampleMemory1, sampleMemory2],
        relatedMemories: [sampleMemory3],
      })

      const json = original.toJson()
      const restored = RetrieveResult.fromJson(json)

      expect(restored.memories).to.have.lengthOf(original.memories.length)
      expect(restored.relatedMemories).to.have.lengthOf(original.relatedMemories.length)
      expect(restored.memories[0].id).to.equal(original.memories[0].id)
      expect(restored.memories[1].id).to.equal(original.memories[1].id)
      expect(restored.relatedMemories[0].id).to.equal(original.relatedMemories[0].id)
    })
  })
})
