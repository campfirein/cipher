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
    it('should parse domain/topic/title.md relations from content', () => {
      const content = `
## Relations
@code_style/error-handling/overview.md
@structure/api-endpoints/guide.md
`
      const result = parseRelations(content)

      expect(result).to.have.members(['code_style/error-handling/overview.md', 'structure/api-endpoints/guide.md'])
    })

    it('should parse domain/topic/subtopic/title.md relations from content', () => {
      const content = `
## Relations
@code_style/error-handling/try-catch/guide.md
@structure/api/endpoints/rest.md
`
      const result = parseRelations(content)

      expect(result).to.have.members(['code_style/error-handling/try-catch/guide.md', 'structure/api/endpoints/rest.md'])
    })

    it('should return unique relations', () => {
      const content = `
@code_style/error-handling/overview.md
@code_style/error-handling/overview.md
@structure/api/guide.md
`
      const result = parseRelations(content)

      expect(result).to.have.lengthOf(2)
      expect(result).to.have.members(['code_style/error-handling/overview.md', 'structure/api/guide.md'])
    })

    it('should return empty array for content without relations', () => {
      const content = 'Some content without relations'

      const result = parseRelations(content)

      expect(result).to.deep.equal([])
    })

    it('should parse relations embedded in text', () => {
      const content = 'See @code_style/error-handling/overview.md for more info'

      const result = parseRelations(content)

      expect(result).to.deep.equal(['code_style/error-handling/overview.md'])
    })

    it('should not parse relations without title.md', () => {
      const content = `
@code_style/error-handling
@structure/api
`
      const result = parseRelations(content)

      expect(result).to.deep.equal([])
    })
  })

  describe('validateRelationPath', () => {
    it('should return true for valid domain/topic/title path', () => {
      expect(validateRelationPath('code_style/error-handling/overview.md')).to.be.true
    })

    it('should return true for valid domain/topic/subtopic/title path', () => {
      expect(validateRelationPath('code_style/error-handling/try-catch/guide.md')).to.be.true
    })

    it('should return true for path with hyphens and underscores', () => {
      expect(validateRelationPath('code_style/error-handling/overview.md')).to.be.true
      expect(validateRelationPath('code-style/error_handling/guide.md')).to.be.true
    })

    it('should return false for single part path', () => {
      expect(validateRelationPath('invalid')).to.be.false
    })

    it('should return false for two part path (missing title)', () => {
      expect(validateRelationPath('code_style/error-handling')).to.be.false
    })

    it('should return false for path with too many parts', () => {
      expect(validateRelationPath('too/many/parts/here/extra.md')).to.be.false
    })

    it('should return false for empty path', () => {
      expect(validateRelationPath('')).to.be.false
    })

    it('should return false for path with empty parts', () => {
      expect(validateRelationPath('/topic/title.md')).to.be.false
      expect(validateRelationPath('domain//title.md')).to.be.false
      expect(validateRelationPath('domain/topic/')).to.be.false
    })

    it('should return false for path with invalid characters', () => {
      expect(validateRelationPath('domain/topic!/title.md')).to.be.false
      expect(validateRelationPath('domain/topic with space/title.md')).to.be.false
    })
  })

  describe('resolveRelationPath', () => {
    it('should resolve domain/topic/title.md relation to file path', () => {
      const result = resolveRelationPath('.brv/context-tree', 'code_style/error-handling/overview.md')

      expect(result).to.equal('.brv/context-tree/code_style/error-handling/overview.md')
    })

    it('should resolve domain/topic/subtopic/title.md relation to file path', () => {
      const result = resolveRelationPath('.brv/context-tree', 'structure/api/endpoints/rest.md')

      expect(result).to.equal('.brv/context-tree/structure/api/endpoints/rest.md')
    })
  })

  describe('formatRelation', () => {
    it('should format domain/topic/title as @domain/topic/title', () => {
      const result = formatRelation('code_style', 'error-handling', 'overview.md')

      expect(result).to.equal('@code_style/error-handling/overview.md')
    })

    it('should format domain/topic/subtopic/title as @domain/topic/subtopic/title', () => {
      const result = formatRelation('structure', 'api', 'rest.md', 'endpoints')

      expect(result).to.equal('@structure/api/endpoints/rest.md')
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
      expect(normalizeRelation('code_style/error-handling/title.md')).to.equal('code_style/error-handling/title')
    })

    it('should handle path with subtopic with @ prefix', () => {
      expect(normalizeRelation('@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title')
    })

    it('should handle empty string', () => {
      expect(normalizeRelation('')).to.equal('')
    })

    it('should remove all @ characters and file extensions', () => {
      expect(normalizeRelation('@@double/prefix')).to.equal('double/prefix')
      expect(normalizeRelation('@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title')
      expect(normalizeRelation('@@@@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title')
      expect(normalizeRelation('code_style/error-handling/title.md')).to.equal('code_style/error-handling/title')
      expect(normalizeRelation('code_style/error-handling/title.py')).to.equal('code_style/error-handling/title')
      expect(normalizeRelation('code_style/error-handling/title.abc')).to.equal('code_style/error-handling/title')
    })
  })

  describe('generateRelationsSection', () => {
    it('should generate relations section with @ prefix and .md suffix', () => {
      const result = generateRelationsSection(['code_style/error-handling/overview', 'structure/api/guide'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/guide.md\n')
    })

    it('should return empty string for empty array', () => {
      const result = generateRelationsSection([])

      expect(result).to.equal('')
    })

    it('should handle single relation', () => {
      const result = generateRelationsSection(['code_style/error-handling/overview'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/overview.md\n')
    })

    it('should not double prefix relations that already have @', () => {
      const result = generateRelationsSection(['@code_style/error-handling/overview', 'structure/api/guide'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/guide.md\n')
    })

    it('should handle mixed prefixed and non-prefixed relations', () => {
      const result = generateRelationsSection(['@code_style/error-handling/overview', 'structure/api/guide', '@testing/unit/basics'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/guide.md\n@testing/unit/basics.md\n')
    })
  })
})
