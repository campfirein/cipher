import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createFindKnowledgeTopicsTool} from '../../../src/infra/cipher/tools/implementations/find-knowledge-topics-tool.js'

interface FindKnowledgeTopicsOutput {
  results: Array<{
    contentPreview?: string
    domain: string
    path: string
    subtopics?: Array<{
      contentPreview?: string
      name: string
      path: string
    }>
    topic: string
  }>
  total: number
}

describe('findKnowledgeTopicsTool', () => {
  let testDir: string
  let basePath: string
  const tool = createFindKnowledgeTopicsTool()

  beforeEach(async () => {
    // Create temporary test directory
    testDir = join(tmpdir(), `byterover-test-${Date.now()}`)
    basePath = join(testDir, '.brv', 'context-tree')
    await mkdir(basePath, {recursive: true})
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('basic search', () => {
    it('should return empty results when no topics exist', async () => {
      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result).to.deep.equal({
        results: [],
        total: 0,
      })
    })

    it('should find topics in a single domain', async () => {
      // Create test structure: testing/unit_tests/context.md
      const domainPath = join(basePath, 'testing')
      const topicPath = join(domainPath, 'unit_tests')
      await mkdir(topicPath, {recursive: true})
      await writeFile(join(topicPath, 'context.md'), 'Unit test context')

      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results).to.have.length(1)
      expect(result.results[0]).to.deep.include({
        domain: 'testing',
        path: 'testing/unit_tests',
        topic: 'unit_tests',
      })
    })

    it('should find topics across multiple domains', async () => {
      // Create multiple domains
      await mkdir(join(basePath, 'testing', 'unit_tests'), {recursive: true})
      await writeFile(join(basePath, 'testing', 'unit_tests', 'context.md'), 'Unit tests')

      await mkdir(join(basePath, 'architecture', 'patterns'), {recursive: true})
      await writeFile(join(basePath, 'architecture', 'patterns', 'context.md'), 'Design patterns')

      await mkdir(join(basePath, 'code_style', 'linting'), {recursive: true})
      await writeFile(join(basePath, 'code_style', 'linting', 'context.md'), 'Linting rules')

      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(3)
      expect(result.results).to.have.length(3)
      expect(result.results.map((r) => r.domain)).to.have.members(['testing', 'architecture', 'code_style'])
    })
  })

  describe('pattern matching', () => {
    beforeEach(async () => {
      // Set up test data
      await mkdir(join(basePath, 'testing', 'unit_tests'), {recursive: true})
      await writeFile(join(basePath, 'testing', 'unit_tests', 'context.md'), 'Unit tests')

      await mkdir(join(basePath, 'testing', 'integration_tests'), {recursive: true})
      await writeFile(join(basePath, 'testing', 'integration_tests', 'context.md'), 'Integration tests')

      await mkdir(join(basePath, 'code_style', 'eslint_rules'), {recursive: true})
      await writeFile(join(basePath, 'code_style', 'eslint_rules', 'context.md'), 'ESLint config')
    })

    it('should filter by domain pattern', async () => {
      const result = (await tool.execute({
        basePath,
        domainPattern: 'test',
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(2)
      expect(result.results.every((r) => r.domain === 'testing')).to.be.true
    })

    it('should filter by topic pattern', async () => {
      const result = (await tool.execute({
        basePath,
        topicPattern: 'unit',
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results[0].topic).to.equal('unit_tests')
    })

    it('should filter by exact domain', async () => {
      const result = (await tool.execute({
        basePath,
        domain: 'code_style',
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results[0].domain).to.equal('code_style')
      expect(result.results[0].topic).to.equal('eslint_rules')
    })

    it('should combine domain filter and topic pattern', async () => {
      const result = (await tool.execute({
        basePath,
        domain: 'testing',
        topicPattern: 'integration',
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results[0].topic).to.equal('integration_tests')
    })
  })

  describe('subtopics', () => {
    beforeEach(async () => {
      // Create topic with subtopics
      const topicPath = join(basePath, 'testing', 'unit_tests')
      await mkdir(topicPath, {recursive: true})
      await writeFile(join(topicPath, 'context.md'), 'Unit test context')

      // Add subtopics
      await mkdir(join(topicPath, 'mocking'), {recursive: true})
      await writeFile(join(topicPath, 'mocking', 'context.md'), 'Mocking strategies')

      await mkdir(join(topicPath, 'assertions'), {recursive: true})
      await writeFile(join(topicPath, 'assertions', 'context.md'), 'Assertion patterns')
    })

    it('should not include subtopics by default', async () => {
      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results[0].subtopics).to.be.undefined
    })

    it('should include subtopics when requested', async () => {
      const result = (await tool.execute({
        basePath,
        includeSubtopics: true,
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results[0].subtopics).to.exist
      expect(result.results[0].subtopics).to.have.length(2)
      expect(result.results[0].subtopics?.map((s) => s.name)).to.have.members(['mocking', 'assertions'])
    })

    it('should filter subtopics by pattern', async () => {
      const result = (await tool.execute({
        basePath,
        includeSubtopics: true,
        subtopicPattern: 'mock',
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
      expect(result.results[0].subtopics).to.have.length(1)
      expect(result.results[0].subtopics?.[0].name).to.equal('mocking')
    })

    it('should include correct subtopic paths', async () => {
      const result = (await tool.execute({
        basePath,
        includeSubtopics: true,
      })) as FindKnowledgeTopicsOutput

      expect(result.results[0].subtopics?.[0].path).to.match(/testing\/unit_tests\/(mocking|assertions)/)
    })
  })

  describe('content preview', () => {
    beforeEach(async () => {
      await mkdir(join(basePath, 'testing', 'unit_tests'), {recursive: true})
    })

    it('should not include content by default', async () => {
      await writeFile(join(basePath, 'testing', 'unit_tests', 'context.md'), 'Test content')

      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.results[0].contentPreview).to.be.undefined
    })

    it('should include content when requested', async () => {
      const content = 'This is test content for unit tests'
      await writeFile(join(basePath, 'testing', 'unit_tests', 'context.md'), content)

      const result = (await tool.execute({
        basePath,
        includeContent: true,
      })) as FindKnowledgeTopicsOutput

      expect(result.results[0].contentPreview).to.equal(content)
    })

    it('should truncate long content to 500 characters', async () => {
      const longContent = 'a'.repeat(600)
      await writeFile(join(basePath, 'testing', 'unit_tests', 'context.md'), longContent)

      const result = (await tool.execute({
        basePath,
        includeContent: true,
      })) as FindKnowledgeTopicsOutput

      expect(result.results[0].contentPreview).to.have.length(503) // 500 + '...'
      expect(result.results[0].contentPreview).to.match(/^a+\.\.\.$/)
    })

    it('should include subtopic content when requested', async () => {
      const topicPath = join(basePath, 'testing', 'unit_tests')
      await writeFile(join(topicPath, 'context.md'), 'Topic content')

      await mkdir(join(topicPath, 'mocking'), {recursive: true})
      await writeFile(join(topicPath, 'mocking', 'context.md'), 'Subtopic content')

      const result = (await tool.execute({
        basePath,
        includeContent: true,
        includeSubtopics: true,
      })) as FindKnowledgeTopicsOutput

      expect(result.results[0].contentPreview).to.equal('Topic content')
      expect(result.results[0].subtopics?.[0].contentPreview).to.equal('Subtopic content')
    })
  })

  describe('pagination', () => {
    beforeEach(async () => {
      // Create 5 topics
      for (let i = 1; i <= 5; i++) {
        const topicPath = join(basePath, 'domain', `topic_${i}`)
        // eslint-disable-next-line no-await-in-loop
        await mkdir(topicPath, {recursive: true})
        // eslint-disable-next-line no-await-in-loop
        await writeFile(join(topicPath, 'context.md'), `Topic ${i}`)
      }
    })

    it('should return all results without limit', async () => {
      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(5)
      expect(result.results).to.have.length(5)
    })

    it('should limit results when specified', async () => {
      const result = (await tool.execute({
        basePath,
        limit: 2,
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(5) // Total should still be 5
      expect(result.results).to.have.length(2)
    })

    it('should skip results with offset', async () => {
      const result = (await tool.execute({
        basePath,
        offset: 2,
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(5)
      expect(result.results).to.have.length(3)
    })

    it('should combine limit and offset', async () => {
      const result = (await tool.execute({
        basePath,
        limit: 2,
        offset: 1,
      })) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(5)
      expect(result.results).to.have.length(2)
    })
  })

  describe('edge cases', () => {
    it('should handle non-existent base path gracefully', async () => {
      const result = (await tool.execute({
        basePath: '/non/existent/path',
      })) as FindKnowledgeTopicsOutput

      expect(result).to.deep.equal({
        results: [],
        total: 0,
      })
    })

    it('should skip non-context.md files', async () => {
      const topicPath = join(basePath, 'testing', 'unit_tests')
      await mkdir(topicPath, {recursive: true})
      await writeFile(join(topicPath, 'context.md'), 'Valid context')
      await writeFile(join(topicPath, 'notes.md'), 'Should be ignored')
      await writeFile(join(topicPath, 'README.md'), 'Should be ignored')

      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(1)
    })

    it('should handle topics with same name in different domains', async () => {
      await mkdir(join(basePath, 'domain1', 'shared_topic'), {recursive: true})
      await writeFile(join(basePath, 'domain1', 'shared_topic', 'context.md'), 'Domain 1')

      await mkdir(join(basePath, 'domain2', 'shared_topic'), {recursive: true})
      await writeFile(join(basePath, 'domain2', 'shared_topic', 'context.md'), 'Domain 2')

      const result = (await tool.execute({basePath})) as FindKnowledgeTopicsOutput

      expect(result.total).to.equal(2)
      expect(result.results.map((r) => r.path)).to.have.members([
        'domain1/shared_topic',
        'domain2/shared_topic',
      ])
    })

    it('should handle unavailable content gracefully', async () => {
      const topicPath = join(basePath, 'testing', 'unit_tests')
      await mkdir(topicPath, {recursive: true})
      await writeFile(join(topicPath, 'context.md'), 'Content')

      // First call should work
      const result = (await tool.execute({
        basePath,
        includeContent: true,
      })) as FindKnowledgeTopicsOutput

      expect(result.results[0].contentPreview).to.equal('Content')

      // After deleting context.md, the topic should not appear in results
      await rm(join(topicPath, 'context.md'))

      const result2 = (await tool.execute({
        basePath,
        includeContent: true,
      })) as FindKnowledgeTopicsOutput

      // Topic should not be found since context.md doesn't exist
      expect(result2.total).to.equal(0)
      expect(result2.results).to.have.length(0)
    })
  })

  describe('tool metadata', () => {
    it('should have correct tool ID', () => {
      expect(tool.id).to.equal('find_knowledge_topics')
    })

    it('should have description', () => {
      expect(tool.description).to.be.a('string')
      expect(tool.description).to.include('Search and filter')
    })

    it('should have input schema', () => {
      expect(tool.inputSchema).to.exist
    })
  })
})
