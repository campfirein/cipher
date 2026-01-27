import {expect} from 'chai'

import {CogitPushContext} from '../../../../../src/server/core/domain/entities/cogit-push-context.js'

describe('CogitPushContext Entity', () => {
  const validAddContextData = {
    content: '# Test Title\n\nThis is test content',
    operation: 'add' as const,
    path: 'structure/context.md',
    tags: ['typescript', 'testing'],
    title: 'Test Title',
  }

  const validEditContextData = {
    content: '# Updated Title\n\nUpdated content',
    operation: 'edit' as const,
    path: 'structure/context.md',
    tags: [],
    title: 'Updated Title',
  }

  const validDeleteContextData = {
    content: '',
    operation: 'delete' as const,
    path: 'structure/context.md',
    tags: [],
    title: '',
  }

  describe('Constructor', () => {
    it('should create a valid CogitPushContext instance for add operation', () => {
      const context = new CogitPushContext(validAddContextData)

      expect(context.operation).to.equal('add')
      expect(context.path).to.equal(validAddContextData.path)
      expect(context.title).to.equal(validAddContextData.title)
      expect(context.content).to.equal(validAddContextData.content)
      expect(context.tags).to.deep.equal(validAddContextData.tags)
    })

    it('should create a valid CogitPushContext instance for edit operation', () => {
      const context = new CogitPushContext(validEditContextData)

      expect(context.operation).to.equal('edit')
      expect(context.path).to.equal(validEditContextData.path)
    })

    it('should create a valid CogitPushContext instance for delete operation', () => {
      const context = new CogitPushContext(validDeleteContextData)

      expect(context.operation).to.equal('delete')
      expect(context.path).to.equal(validDeleteContextData.path)
      expect(context.content).to.equal('')
      expect(context.title).to.equal('')
    })

    it('should create context with empty tags array', () => {
      const context = new CogitPushContext({
        ...validAddContextData,
        tags: [],
      })

      expect(context.tags).to.deep.equal([])
    })

    it('should throw error when path is empty', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            path: '',
          }),
      ).to.throw('CogitPushContext path cannot be empty')
    })

    it('should throw error when path is whitespace', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            path: '   ',
          }),
      ).to.throw('CogitPushContext path cannot be empty')
    })

    it('should throw error when content is empty for add operation', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            content: '',
          }),
      ).to.throw('CogitPushContext content cannot be empty for add operation')
    })

    it('should throw error when content is whitespace for add operation', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            content: '   ',
          }),
      ).to.throw('CogitPushContext content cannot be empty for add operation')
    })

    it('should throw error when title is empty for add operation', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            title: '',
          }),
      ).to.throw('CogitPushContext title cannot be empty for add operation')
    })

    it('should throw error when title is whitespace for add operation', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            title: '   ',
          }),
      ).to.throw('CogitPushContext title cannot be empty for add operation')
    })

    it('should throw error when operation is invalid', () => {
      expect(
        () =>
          new CogitPushContext({
            ...validAddContextData,
            operation: 'invalid' as 'add',
          }),
      ).to.throw("Invalid operation: invalid. Must be 'add', 'edit', or 'delete'")
    })

    it('should allow empty content for delete operation', () => {
      const context = new CogitPushContext(validDeleteContextData)

      expect(context.content).to.equal('')
    })

    it('should allow empty title for delete operation', () => {
      const context = new CogitPushContext(validDeleteContextData)

      expect(context.title).to.equal('')
    })
  })

  describe('Immutability', () => {
    it('should not expose mutable array references', () => {
      const originalTags = ['typescript', 'testing']

      const context = new CogitPushContext({
        ...validAddContextData,
        tags: originalTags,
      })

      // Mutating original array should not affect context instance
      originalTags.push('performance')

      expect(context.tags).to.deep.equal(['typescript', 'testing'])
    })
  })

  describe('toJson', () => {
    it('should serialize CogitPushContext to JSON', () => {
      const context = new CogitPushContext(validAddContextData)

      const json = context.toJson()

      expect(json).to.deep.equal({
        content: validAddContextData.content,
        operation: validAddContextData.operation,
        path: validAddContextData.path,
        tags: validAddContextData.tags,
        title: validAddContextData.title,
      })
    })

    it('should serialize context with empty tags to JSON', () => {
      const context = new CogitPushContext({
        ...validAddContextData,
        tags: [],
      })

      const json = context.toJson()

      expect(json.tags).to.deep.equal([])
    })

    it('should create defensive copy of tags in toJson', () => {
      const context = new CogitPushContext(validAddContextData)

      const json = context.toJson()
      ;(json.tags as string[]).push('mutated')

      expect(context.tags).to.deep.equal(['typescript', 'testing'])
    })
  })

  describe('fromJson', () => {
    it('should deserialize CogitPushContext from JSON', () => {
      const context = CogitPushContext.fromJson(validAddContextData)

      expect(context.operation).to.equal(validAddContextData.operation)
      expect(context.path).to.equal(validAddContextData.path)
      expect(context.title).to.equal(validAddContextData.title)
      expect(context.content).to.equal(validAddContextData.content)
      expect(context.tags).to.deep.equal(validAddContextData.tags)
    })

    it('should throw TypeError when JSON is null', () => {
      expect(() => CogitPushContext.fromJson(null)).to.throw(TypeError, 'CogitPushContext JSON must be an object')
    })

    it('should throw TypeError when JSON is not an object', () => {
      expect(() => CogitPushContext.fromJson('string')).to.throw(TypeError, 'CogitPushContext JSON must be an object')
    })

    it('should throw TypeError when operation is missing', () => {
      expect(() =>
        CogitPushContext.fromJson({
          content: 'test',
          path: 'test.md',
          tags: [],
          title: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushContext JSON must have a string operation field')
    })

    it('should throw TypeError when path is missing', () => {
      expect(() =>
        CogitPushContext.fromJson({
          content: 'test',
          operation: 'add',
          tags: [],
          title: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushContext JSON must have a string path field')
    })

    it('should throw TypeError when title is missing', () => {
      expect(() =>
        CogitPushContext.fromJson({
          content: 'test',
          operation: 'add',
          path: 'test.md',
          tags: [],
        }),
      ).to.throw(TypeError, 'CogitPushContext JSON must have a string title field')
    })

    it('should throw TypeError when content is missing', () => {
      expect(() =>
        CogitPushContext.fromJson({
          operation: 'add',
          path: 'test.md',
          tags: [],
          title: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushContext JSON must have a string content field')
    })

    it('should throw TypeError when tags is missing', () => {
      expect(() =>
        CogitPushContext.fromJson({
          content: 'test',
          operation: 'add',
          path: 'test.md',
          title: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushContext JSON must have a tags array')
    })

    it('should throw TypeError when tags is not an array', () => {
      expect(() =>
        CogitPushContext.fromJson({
          content: 'test',
          operation: 'add',
          path: 'test.md',
          tags: 'not-array',
          title: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushContext JSON must have a tags array')
    })

    it('should throw TypeError when tags contains non-string values', () => {
      expect(() =>
        CogitPushContext.fromJson({
          content: 'test',
          operation: 'add',
          path: 'test.md',
          tags: ['valid', 123],
          title: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushContext tags must all be strings')
    })

    it('should roundtrip correctly (toJson then fromJson)', () => {
      const original = new CogitPushContext(validAddContextData)

      const json = original.toJson()
      const restored = CogitPushContext.fromJson(json)

      expect(restored.operation).to.equal(original.operation)
      expect(restored.path).to.equal(original.path)
      expect(restored.title).to.equal(original.title)
      expect(restored.content).to.equal(original.content)
      expect(restored.tags).to.deep.equal(original.tags)
    })
  })
})
