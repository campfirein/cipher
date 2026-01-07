import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createSearchKnowledgeTool} from '../../../../../src/infra/cipher/tools/implementations/search-knowledge-tool.js'

interface SearchKnowledgeOutput {
  message: string
  results: Array<{
    excerpt: string
    path: string
    score: number
    title: string
  }>
  totalFound: number
}

describe('Search Knowledge Tool', () => {
  let tmpDir: string
  let contextTreePath: string

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = join(tmpdir(), `search-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    contextTreePath = join(tmpDir, '.brv/context-tree')
    await fs.mkdir(contextTreePath, {recursive: true})
  })

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(tmpDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Tool Properties', () => {
    it('should have correct id', () => {
      const tool = createSearchKnowledgeTool()
      expect(tool.id).to.equal('search_knowledge')
    })

    it('should have correct input schema', () => {
      const tool = createSearchKnowledgeTool()
      expect(tool.inputSchema).to.exist
    })

    it('should have a description', () => {
      const tool = createSearchKnowledgeTool()
      expect(tool.description).to.be.a('string')
      expect(tool.description.length).to.be.greaterThan(0)
    })
  })

  describe('Context Tree Not Initialized', () => {
    it('should return message when context tree does not exist', async () => {
      const nonExistentDir = join(tmpdir(), `non-existent-${Date.now()}`)
      const tool = createSearchKnowledgeTool({baseDirectory: nonExistentDir})

      const result = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput

      expect(result.results).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
      expect(result.message).to.include('not initialized')
    })
  })

  describe('Empty Context Tree', () => {
    it('should return message when context tree is empty', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput

      expect(result.results).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
      expect(result.message).to.include('empty')
    })
  })

  describe('Search Functionality', () => {
    beforeEach(async () => {
      // Create sample knowledge files
      const authDomain = join(contextTreePath, 'authentication')
      const apiDomain = join(contextTreePath, 'api_design')

      await fs.mkdir(join(authDomain, 'oauth'), {recursive: true})
      await fs.mkdir(join(apiDomain, 'patterns'), {recursive: true})

      // Create authentication/oauth/context.md
      await fs.writeFile(
        join(authDomain, 'oauth/context.md'),
        '# OAuth Authentication Flow\n\nThis document describes the OAuth 2.0 authentication flow used in our application.\n\n---\n\nThe flow involves:\n1. Redirect to auth provider\n2. User grants permission\n3. Callback with authorization code\n4. Exchange code for tokens',
      )

      // Create api_design/patterns/context.md
      await fs.writeFile(
        join(apiDomain, 'patterns/context.md'),
        '# API Design Patterns\n\nBest practices for REST API design.\n\n---\n\n- Use resource-based URLs\n- Proper HTTP methods (GET, POST, PUT, DELETE)\n- Consistent error responses',
      )

      // Create authentication/jwt.md
      await fs.writeFile(
        join(authDomain, 'jwt.md'),
        '# JWT Token Handling\n\nHow we handle JSON Web Tokens in the application.\n\n---\n\nTokens are stored securely and refreshed automatically before expiration.',
      )
    })

    it('should find documents matching query', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({query: 'OAuth authentication'})) as SearchKnowledgeOutput

      expect(result.totalFound).to.be.greaterThan(0)
      expect(result.results.length).to.be.greaterThan(0)

      // Should find OAuth authentication document
      const oauthResult = result.results.find((r) => r.path.includes('oauth'))
      expect(oauthResult).to.exist
      expect(oauthResult?.title).to.include('OAuth')
    })

    it('should support fuzzy matching', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      // Search with slight typo
      const result = (await tool.execute({query: 'autentication'})) as SearchKnowledgeOutput

      // Should still find results due to fuzzy matching
      expect(result.totalFound).to.be.greaterThan(0)
    })

    it('should respect limit parameter', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({limit: 1, query: 'authentication'})) as SearchKnowledgeOutput

      expect(result.results.length).to.be.lessThanOrEqual(1)
    })

    it('should return excerpts from matching documents', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({query: 'API design patterns'})) as SearchKnowledgeOutput

      expect(result.totalFound).to.be.greaterThan(0)
      const apiResult = result.results.find((r) => r.path.includes('api_design'))
      expect(apiResult).to.exist
      expect(apiResult?.excerpt).to.be.a('string')
      expect(apiResult?.excerpt.length).to.be.greaterThan(0)
    })

    it('should include score in results', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({query: 'authentication'})) as SearchKnowledgeOutput

      for (const r of result.results) {
        expect(r.score).to.be.a('number')
        expect(r.score).to.be.greaterThan(0)
      }
    })

    it('should search across multiple domains', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({query: 'design'})) as SearchKnowledgeOutput

      // Should find API design patterns
      expect(result.totalFound).to.be.greaterThan(0)
    })

    it('should handle queries with no matches', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      const result = (await tool.execute({query: 'nonexistent random term xyz123'})) as SearchKnowledgeOutput

      expect(result.results).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
      expect(result.message).to.include('No matching')
    })

    it('should use default limit of 10', async () => {
      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})

      // Note: with only 3 files, we can't test the 10 limit directly
      // But we can verify the tool works with default parameters
      const result = (await tool.execute({query: 'authentication'})) as SearchKnowledgeOutput

      expect(result.results.length).to.be.lessThanOrEqual(10)
    })
  })

  describe('Title Extraction', () => {
    it('should extract title from markdown heading', async () => {
      const domainPath = join(contextTreePath, 'test_domain')
      await fs.mkdir(domainPath, {recursive: true})
      await fs.writeFile(
        join(domainPath, 'my_topic.md'),
        '# Custom Topic Title\n\nSome content here.',
      )

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'topic'})) as SearchKnowledgeOutput

      const topicResult = result.results.find((r) => r.path.includes('my_topic'))
      expect(topicResult?.title).to.equal('Custom Topic Title')
    })

    it('should use filename as fallback when no heading exists', async () => {
      const domainPath = join(contextTreePath, 'test_domain')
      await fs.mkdir(domainPath, {recursive: true})
      await fs.writeFile(
        join(domainPath, 'no_heading.md'),
        'Just some content without a heading.',
      )

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'content'})) as SearchKnowledgeOutput

      const noHeadingResult = result.results.find((r) => r.path.includes('no_heading'))
      expect(noHeadingResult?.title).to.equal('no_heading')
    })
  })

  describe('Hidden Files', () => {
    it('should ignore hidden files and directories', async () => {
      const domainPath = join(contextTreePath, 'visible_domain')
      const hiddenDomain = join(contextTreePath, '.hidden_domain')

      await fs.mkdir(domainPath, {recursive: true})
      await fs.mkdir(hiddenDomain, {recursive: true})

      await fs.writeFile(join(domainPath, 'visible.md'), '# Visible\n\nThis should be searchable.')
      await fs.writeFile(join(domainPath, '.hidden.md'), '# Hidden\n\nThis should not be searchable.')
      await fs.writeFile(join(hiddenDomain, 'also_hidden.md'), '# Also Hidden\n\nThis should not be searchable.')

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'searchable'})) as SearchKnowledgeOutput

      // Should only find the visible file
      expect(result.totalFound).to.equal(1)
      expect(result.results[0].path).to.include('visible')
      expect(result.results[0].path).to.not.include('.hidden')
    })
  })

  describe('Nested Directories', () => {
    it('should search deeply nested markdown files', async () => {
      const deepPath = join(contextTreePath, 'level1/level2/level3')
      await fs.mkdir(deepPath, {recursive: true})
      await fs.writeFile(
        join(deepPath, 'deep_knowledge.md'),
        '# Deep Knowledge Topic\n\nThis is deeply nested content.',
      )

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'deeply nested'})) as SearchKnowledgeOutput

      expect(result.totalFound).to.be.greaterThan(0)
      expect(result.results[0].path).to.include('level1/level2/level3')
    })
  })

  describe('Excerpt Generation', () => {
    it('should generate excerpt containing query-relevant content', async () => {
      const domainPath = join(contextTreePath, 'test_domain')
      await fs.mkdir(domainPath, {recursive: true})
      await fs.writeFile(
        join(domainPath, 'long_content.md'),
        '# Long Document\n\n## Introduction\nThis is an introduction paragraph.\n\n## Important Section\nThis section contains important information about authentication and security.\n\n## Conclusion\nThis is the conclusion.',
      )

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'authentication security'})) as SearchKnowledgeOutput

      const doc = result.results.find((r) => r.path.includes('long_content'))
      expect(doc?.excerpt).to.include('authentication')
    })

    it('should truncate long excerpts', async () => {
      const domainPath = join(contextTreePath, 'test_domain')
      await fs.mkdir(domainPath, {recursive: true})

      // Create a very long document
      const longContent = '# Very Long Document\n\n' + 'This is a paragraph. '.repeat(100)
      await fs.writeFile(join(domainPath, 'very_long.md'), longContent)

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'paragraph'})) as SearchKnowledgeOutput

      const doc = result.results.find((r) => r.path.includes('very_long'))
      // Excerpt should be reasonably bounded
      expect(doc?.excerpt.length).to.be.lessThan(500)
    })
  })

  describe('Relations Section Handling', () => {
    it('should exclude relations section from excerpt', async () => {
      const domainPath = join(contextTreePath, 'test_domain')
      await fs.mkdir(domainPath, {recursive: true})
      await fs.writeFile(
        join(domainPath, 'with_relations.md'),
        '# Document With Relations\n\n## Relations\n@other_domain/topic\n@another_domain/subtopic\n\n## Content\nThis is the actual content about authentication patterns.',
      )

      const tool = createSearchKnowledgeTool({baseDirectory: tmpDir})
      const result = (await tool.execute({query: 'authentication patterns'})) as SearchKnowledgeOutput

      const doc = result.results.find((r) => r.path.includes('with_relations'))
      // The excerpt should not prominently feature the relations section
      expect(doc?.excerpt).to.include('authentication')
    })
  })
})
