/**
 * Tests for search knowledge service bug fixes:
 * - BUG 2: Stop-word-only queries should return empty, not everything at 100%
 * - BUG 3: Excerpts should not contain raw YAML frontmatter
 */

import {expect} from 'chai'
import {createSandbox} from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {SearchKnowledgeService} from '../../../../src/agent/infra/tools/implementations/search-knowledge-service.js'

function mockFileSystem(sandbox: ReturnType<typeof createSandbox>) {
  const globStub = sandbox.stub()
  const readStub = sandbox.stub()
  const listDirStub = sandbox.stub()

  listDirStub.resolves({count: 1, entries: [], tree: '', truncated: false})

  globStub.resolves({
    files: [
      {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/login.md', size: 100},
      {
        isDirectory: false,
        modified: new Date('2024-01-02'),
        path: '/test/.brv/context-tree/api/endpoints.md',
        size: 100,
      },
    ],
    ignoredCount: 0,
    message: 'Found 2 files',
    totalFound: 2,
    truncated: false,
  })

  readStub.callsFake((filePath: string) => {
    if (filePath.includes('login')) {
      return Promise.resolve({
        content: [
          '---',
          'title: Login Flow',
          'tags: [auth, oauth]',
          'importance: 70',
          'maturity: validated',
          'recency: 0.8',
          '---',
          '',
          '# Login Flow',
          '',
          '## Raw Concept',
          '**Task:** OAuth 2.0 login with session management',
          '',
          '## Narrative',
          '### Structure',
          'Users authenticate via OAuth provider then receive session tokens.',
        ].join('\n'),
        encoding: 'utf8',
        lines: 16,
        size: 300,
        totalLines: 16,
        truncated: false,
      })
    }

    if (filePath.includes('endpoints')) {
      return Promise.resolve({
        content: [
          '---',
          'title: API Endpoints',
          'tags: [api, rest]',
          'importance: 60',
          'maturity: draft',
          '---',
          '',
          '# API Endpoints',
          '',
          '## Raw Concept',
          '**Task:** RESTful API endpoint documentation',
          '',
          '## Narrative',
          'GET /users returns user list. POST /users creates a user.',
        ].join('\n'),
        encoding: 'utf8',
        lines: 14,
        size: 250,
        totalLines: 14,
        truncated: false,
      })
    }

    return Promise.reject(new Error('File not found'))
  })

  const fileSystem = {
    editFile: sandbox.stub(),
    globFiles: globStub,
    initialize: sandbox.stub(),
    listDirectory: listDirStub,
    readFile: readStub,
    searchContent: sandbox.stub(),
    writeFile: sandbox.stub().resolves({message: 'ok', path: '', success: true}),
  } as unknown as IFileSystem

  return fileSystem
}

describe('Search Knowledge Service - Bug Fixes', () => {
  const sandbox = createSandbox()

  afterEach(() => {
    sandbox.restore()
  })

  describe('BUG 2: Stop-word-only queries', () => {
    it('should return 0 results for stop-word-only query "the a an"', async () => {
      const fileSystem = mockFileSystem(sandbox)
      const service = new SearchKnowledgeService(fileSystem, {baseDirectory: '/test', cacheTtlMs: 0})

      const result = await service.search('the a an')

      expect(result.results).to.have.length(0)
      expect(result.message).to.be.a('string')
    })

    it('should return 0 results for stop-word-only query "is are was were"', async () => {
      const fileSystem = mockFileSystem(sandbox)
      const service = new SearchKnowledgeService(fileSystem, {baseDirectory: '/test', cacheTtlMs: 0})

      const result = await service.search('is are was were')

      expect(result.results).to.have.length(0)
    })

    it('should still return results for queries with non-stop words', async () => {
      const fileSystem = mockFileSystem(sandbox)
      const service = new SearchKnowledgeService(fileSystem, {baseDirectory: '/test', cacheTtlMs: 0})

      const result = await service.search('the OAuth login')

      expect(result.results.length).to.be.greaterThan(0)
    })
  })

  describe('BUG 3: Excerpts should not show frontmatter', () => {
    it('should not include YAML frontmatter in excerpt', async () => {
      const fileSystem = mockFileSystem(sandbox)
      const service = new SearchKnowledgeService(fileSystem, {baseDirectory: '/test', cacheTtlMs: 0})

      const result = await service.search('OAuth login')

      expect(result.results.length).to.be.greaterThan(0)
      for (const r of result.results) {
        expect(r.excerpt).to.not.include('---\ntitle:')
        expect(r.excerpt).to.not.include('tags: [')
        expect(r.excerpt).to.not.include('importance:')
        expect(r.excerpt).to.not.include('maturity:')
        expect(r.excerpt).to.not.include('recency:')
      }
    })

    it('should show meaningful content in excerpt instead of frontmatter', async () => {
      const fileSystem = mockFileSystem(sandbox)
      const service = new SearchKnowledgeService(fileSystem, {baseDirectory: '/test', cacheTtlMs: 0})

      const result = await service.search('API endpoints')

      const apiResult = result.results.find((r) => r.path.includes('endpoints'))
      if (apiResult) {
        // Should contain actual content, not frontmatter
        expect(apiResult.excerpt).to.not.match(/^---/)
        // Should contain something meaningful from the document body
        expect(apiResult.excerpt.length).to.be.greaterThan(0)
      }
    })
  })
})
