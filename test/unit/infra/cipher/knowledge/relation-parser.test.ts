import {expect} from 'chai'

import {
  formatRelation,
  generateRelationsSection,
  normalizeRelation,
  parseRelations,
  resolveRelationPath,
  validateRelationPath,
} from '../../../../../src/core/domain/knowledge/relation-parser.js'
/**
 * Unit tests for relation-parser.
 */
describe('relation-parser', () => {
  describe('parseRelations', () => {
    it('should parse domain/topic relations from content', () => {
      const content = `
## Relations
@code_style/error-handling
@structure/api-endpoints
`
      const result = parseRelations(content)

      expect(result).to.have.members(['code_style/error-handling', 'structure/api-endpoints'])
    })

    it('should parse domain/topic/subtopic relations from content', () => {
      const content = `
## Relations
@code_style/error-handling/try-catch
@structure/api/endpoints
`
      const result = parseRelations(content)

      expect(result).to.have.members(['code_style/error-handling/try-catch', 'structure/api/endpoints'])
    })

    it('should return unique relations', () => {
      const content = `
@code_style/error-handling
@code_style/error-handling
@structure/api
`
      const result = parseRelations(content)

      expect(result).to.have.lengthOf(2)
      expect(result).to.have.members(['code_style/error-handling', 'structure/api'])
    })

    it('should return empty array for content without relations', () => {
      const content = 'Some content without relations'

      const result = parseRelations(content)

      expect(result).to.deep.equal([])
    })

    it('should parse relations embedded in text', () => {
      const content = 'See @code_style/error-handling for more info'

      const result = parseRelations(content)

      expect(result).to.deep.equal(['code_style/error-handling'])
    })
  })

  describe('validateRelationPath', () => {
    it('should return true for valid domain/topic path', () => {
      expect(validateRelationPath('code_style/error-handling')).to.be.true
    })

    it('should return true for valid domain/topic/subtopic path', () => {
      expect(validateRelationPath('code_style/error-handling/try-catch')).to.be.true
    })

    it('should return true for path with hyphens and underscores', () => {
      expect(validateRelationPath('code_style/error-handling')).to.be.true
      expect(validateRelationPath('code-style/error_handling')).to.be.true
    })

    it('should return false for single part path', () => {
      expect(validateRelationPath('invalid')).to.be.false
    })

    it('should return false for path with too many parts', () => {
      expect(validateRelationPath('too/many/parts/here')).to.be.false
    })

    it('should return false for empty path', () => {
      expect(validateRelationPath('')).to.be.false
    })

    it('should return false for path with empty parts', () => {
      expect(validateRelationPath('/topic')).to.be.false
      expect(validateRelationPath('domain/')).to.be.false
      expect(validateRelationPath('domain//subtopic')).to.be.false
    })

    it('should return false for path with invalid characters', () => {
      expect(validateRelationPath('domain/topic!')).to.be.false
      expect(validateRelationPath('domain/topic with space')).to.be.false
    })
  })

  describe('resolveRelationPath', () => {
    it('should resolve domain/topic relation to file path', () => {
      const result = resolveRelationPath('.brv/context-tree', 'code_style/error-handling')

      expect(result).to.equal('.brv/context-tree/code_style/error-handling/context.md')
    })

    it('should resolve domain/topic/subtopic relation to file path', () => {
      const result = resolveRelationPath('.brv/context-tree', 'structure/api/endpoints')

      expect(result).to.equal('.brv/context-tree/structure/api/endpoints/context.md')
    })
  })

  describe('formatRelation', () => {
    it('should format domain/topic as @domain/topic', () => {
      const result = formatRelation('code_style', 'error-handling')

      expect(result).to.equal('@code_style/error-handling')
    })

    it('should format domain/topic/subtopic as @domain/topic/subtopic', () => {
      const result = formatRelation('structure', 'api', 'endpoints')

      expect(result).to.equal('@structure/api/endpoints')
    })
  })

  describe('normalizeRelation', () => {
    it('should return path unchanged if no @ prefix', () => {
      expect(normalizeRelation('code_style/error-handling')).to.equal('code_style/error-handling')
    })

    it('should remove @ prefix if present', () => {
      expect(normalizeRelation('@code_style/error-handling')).to.equal('code_style/error-handling')
    })

    it('should handle path with subtopic without @ prefix', () => {
      expect(normalizeRelation('code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
    })

    it('should handle path with subtopic with @ prefix', () => {
      expect(normalizeRelation('@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
    })

    it('should handle empty string', () => {
      expect(normalizeRelation('')).to.equal('')
    })

    it('should only remove first @ character', () => {
      expect(normalizeRelation('@@double/prefix')).to.equal('@double/prefix')
    })
  })

  describe('generateRelationsSection', () => {
    it('should generate relations section with @ prefix', () => {
      const result = generateRelationsSection(['code_style/error-handling', 'structure/api'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling\n@structure/api\n')
    })

    it('should return empty string for empty array', () => {
      const result = generateRelationsSection([])

      expect(result).to.equal('')
    })

    it('should handle single relation', () => {
      const result = generateRelationsSection(['code_style/error-handling'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling\n')
    })

    it('should not double prefix relations that already have @', () => {
      const result = generateRelationsSection(['@code_style/error-handling', 'structure/api'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling\n@structure/api\n')
    })

    it('should handle mixed prefixed and non-prefixed relations', () => {
      const result = generateRelationsSection(['@code_style/error-handling', 'structure/api', '@testing/unit'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling\n@structure/api\n@testing/unit\n')
    })
  })
})
