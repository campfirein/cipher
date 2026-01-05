import {expect} from 'chai'

import {
  formatRelation,
  generateRelationsSection,
  normalizeRelation,
  parseRelations,
  resolveRelationPath,
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

    it('should parse relations with optional file extension', () => {
      const content = `
@code_style/error-handling/overview.md
@structure/api/guide.txt
@testing/unit/basics
`
      const result = parseRelations(content)

      expect(result).to.have.members(['code_style/error-handling/overview.md', 'structure/api/guide.txt', 'testing/unit/basics'])
    })

    it('should match relations even when @ is preceded by word characters', () => {
      const content = 'email@code_style/error-handling/overview.md or @structure/api/guide.md'
      const result = parseRelations(content)

      expect(result).to.have.members(['code_style/error-handling/overview.md', 'structure/api/guide.md'])
    })

    it('should handle relations with underscores and hyphens', () => {
      const content = '@test-domain/my_topic/sub-topic/file-name.md'
      const result = parseRelations(content)

      expect(result).to.deep.equal(['test-domain/my_topic/sub-topic/file-name.md'])
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

    it('should preserve .md extension when no @ prefix', () => {
      expect(normalizeRelation('code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
    })

    it('should preserve .md extension when @ prefix is present', () => {
      expect(normalizeRelation('@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
    })

    it('should handle empty string', () => {
      expect(normalizeRelation('')).to.equal('')
    })

    it('should remove multiple leading @ characters', () => {
      expect(normalizeRelation('@@double/prefix')).to.equal('double/prefix')
      expect(normalizeRelation('@@@@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
    })

    it('should preserve all file extensions', () => {
      expect(normalizeRelation('code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
      expect(normalizeRelation('@code_style/error-handling/title.md')).to.equal('code_style/error-handling/title.md')
      expect(normalizeRelation('code_style/error-handling/file.txt')).to.equal('code_style/error-handling/file.txt')
      expect(normalizeRelation('code_style/error-handling/file.py')).to.equal('code_style/error-handling/file.py')
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

    it('should handle relations with .md extension already present', () => {
      const result = generateRelationsSection(['code_style/error-handling/overview.md', 'structure/api/guide.md'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/guide.md\n')
    })

    it('should handle relations with subtopic', () => {
      const result = generateRelationsSection(['code_style/error-handling/try-catch/guide', 'structure/api/endpoints/rest'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/try-catch/guide.md\n@structure/api/endpoints/rest.md\n')
    })

    it('should normalize relations before formatting', () => {
      const result = generateRelationsSection(['@code_style/error-handling/overview.md', '@structure/api/guide.md'])

      expect(result).to.equal('\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/guide.md\n')
    })

    it('should add .md extension when relation is missing it', () => {
      const result = generateRelationsSection(['backend/database/database_orm_and_services', 'structure/api/guide'])

      expect(result).to.equal('\n## Relations\n@backend/database/database_orm_and_services.md\n@structure/api/guide.md\n')
    })

    it('should handle mixed relations with and without .md extension', () => {
      const result = generateRelationsSection([
        'backend/database/database_orm_and_services',
        'structure/api/guide.md',
        'testing/unit/basics',
      ])

      expect(result).to.equal(
        '\n## Relations\n@backend/database/database_orm_and_services.md\n@structure/api/guide.md\n@testing/unit/basics.md\n',
      )
    })
  })
})
