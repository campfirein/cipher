import {expect} from 'chai'
import {createSandbox, SinonStub} from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {SearchKnowledgeService} from '../../../../src/agent/infra/tools/implementations/search-knowledge-service.js'
import {createSearchKnowledgeTool} from '../../../../src/agent/infra/tools/implementations/search-knowledge-tool.js'

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
  const sandbox = createSandbox()
  let fileSystemMock: IFileSystem
  let globFilesStub: SinonStub
  let listDirectoryStub: SinonStub
  let readFileStub: SinonStub
  let writeFileStub: SinonStub

  beforeEach(() => {
    globFilesStub = sandbox.stub()
    listDirectoryStub = sandbox.stub()
    readFileStub = sandbox.stub()
    writeFileStub = sandbox.stub()

    fileSystemMock = {
      editFile: sandbox.stub(),
      globFiles: globFilesStub,
      initialize: sandbox.stub(),
      listDirectory: listDirectoryStub,
      readFile: readFileStub,
      searchContent: sandbox.stub(),
      writeFile: writeFileStub,
    } as unknown as IFileSystem
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('Tool Properties', () => {
    it('should have correct id', () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      expect(tool.id).to.equal('search_knowledge')
    })

    it('should have correct input schema', () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      expect(tool.inputSchema).to.exist
    })

    it('should have a description', () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      expect(tool.description).to.be.a('string')
      expect(tool.description.length).to.be.greaterThan(0)
    })
  })

  describe('Context Tree Not Initialized', () => {
    it('should return message when context tree does not exist', async () => {
      listDirectoryStub.rejects(new Error('Directory not found'))

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput

      expect(result.results).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
      expect(result.message).to.include('not initialized')
    })
  })

  describe('Empty Context Tree', () => {
    it('should return message when context tree is empty', async () => {
      listDirectoryStub.resolves({count: 0, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({files: [], ignoredCount: 0, message: 'No files', totalFound: 0, truncated: false})

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput

      expect(result.results).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
      expect(result.message).to.include('empty')
    })
  })

  describe('Search Functionality', () => {
    beforeEach(() => {
      listDirectoryStub.resolves({count: 3, entries: [], tree: '', truncated: false})

      // Setup glob to return test files
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-01-01'),
            path: '/test/.brv/context-tree/authentication/oauth/context.md',
            size: 100,
          },
          {
            isDirectory: false,
            modified: new Date('2024-01-02'),
            path: '/test/.brv/context-tree/api_design/patterns/context.md',
            size: 100,
          },
          {
            isDirectory: false,
            modified: new Date('2024-01-03'),
            path: '/test/.brv/context-tree/authentication/jwt.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 3 files',
        totalFound: 3,
        truncated: false,
      })

      // Setup readFile to return different content based on file path
      readFileStub.callsFake((filePath: string) => {
        if (filePath.includes('oauth')) {
          return Promise.resolve({
            content:
              '# OAuth Authentication Flow\n\nThis document describes the OAuth 2.0 authentication flow used in our application.\n\n---\n\nThe flow involves:\n1. Redirect to auth provider\n2. User grants permission\n3. Callback with authorization code\n4. Exchange code for tokens',
            encoding: 'utf8',
            lines: 10,
            size: 200,
            totalLines: 10,
            truncated: false,
          })
        }

        if (filePath.includes('patterns')) {
          return Promise.resolve({
            content:
              '# API Design Patterns\n\nBest practices for REST API design.\n\n---\n\n- Use resource-based URLs\n- Proper HTTP methods (GET, POST, PUT, DELETE)\n- Consistent error responses',
            encoding: 'utf8',
            lines: 8,
            size: 150,
            totalLines: 8,
            truncated: false,
          })
        }

        if (filePath.includes('jwt')) {
          return Promise.resolve({
            content:
              '# JWT Token Handling\n\nHow we handle JSON Web Tokens in the application.\n\n---\n\nTokens are stored securely and refreshed automatically before expiration.',
            encoding: 'utf8',
            lines: 5,
            size: 100,
            totalLines: 5,
            truncated: false,
          })
        }

        return Promise.reject(new Error('File not found'))
      })
    })

    it('should find documents matching query', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'OAuth authentication'})) as SearchKnowledgeOutput

      expect(result.totalFound).to.be.greaterThan(0)
      expect(result.results.length).to.be.greaterThan(0)

      // Should find OAuth authentication document
      const oauthResult = result.results.find((r) => r.path.includes('oauth'))
      expect(oauthResult).to.exist
      expect(oauthResult?.title).to.include('OAuth')
    })

    it('should support fuzzy matching', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)

      // Search with slight typo
      const result = (await tool.execute({query: 'autentication'})) as SearchKnowledgeOutput

      // Should still find results due to fuzzy matching
      expect(result.totalFound).to.be.greaterThan(0)
    })

    it('should respect limit parameter', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({limit: 1, query: 'authentication'})) as SearchKnowledgeOutput

      expect(result.results.length).to.be.lessThanOrEqual(1)
    })

    it('should return excerpts from matching documents', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'API design patterns'})) as SearchKnowledgeOutput

      expect(result.totalFound).to.be.greaterThan(0)
      const apiResult = result.results.find((r) => r.path.includes('api_design'))
      expect(apiResult).to.exist
      expect(apiResult?.excerpt).to.be.a('string')
      expect(apiResult?.excerpt.length).to.be.greaterThan(0)
    })

    it('should include a positive compound score', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'authentication'})) as SearchKnowledgeOutput

      // Compound score = W_RELEVANCE*bm25 + W_IMPORTANCE*(imp/100) + W_RECENCY*recency
      // Max theoretical: 1.0 + 0.15 + 0.05 = 1.20
      for (const r of result.results) {
        expect(r.score).to.be.a('number')
        expect(r.score).to.be.greaterThan(0)
        expect(r.score).to.be.lessThan(1.25)
      }
    })

    it('should search across multiple domains', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'design'})) as SearchKnowledgeOutput

      // Should find API design patterns
      expect(result.totalFound).to.be.greaterThan(0)
    })

    it('should handle queries with no matches', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'nonexistent random term xyz123'})) as SearchKnowledgeOutput

      expect(result.results).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
      expect(result.message).to.include('No matching')
    })

    it('should use default limit of 10', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)

      // Note: with only 3 files, we can't test the 10 limit directly
      // But we can verify the tool works with default parameters
      const result = (await tool.execute({query: 'authentication'})) as SearchKnowledgeOutput

      expect(result.results.length).to.be.lessThanOrEqual(10)
    })
  })

  describe('Title Extraction', () => {
    beforeEach(() => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})
    })

    it('should extract title from markdown heading', async () => {
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/test_domain/my_topic.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: '# Custom Topic Title\n\nSome content here.',
        encoding: 'utf8',
        lines: 3,
        size: 50,
        totalLines: 3,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'topic'})) as SearchKnowledgeOutput

      const topicResult = result.results.find((r) => r.path.includes('my_topic'))
      expect(topicResult?.title).to.equal('Custom Topic Title')
    })

    it('should use filename as fallback when no heading exists', async () => {
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/test_domain/no_heading.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: 'Just some content without a heading.',
        encoding: 'utf8',
        lines: 1,
        size: 40,
        totalLines: 1,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'content'})) as SearchKnowledgeOutput

      const noHeadingResult = result.results.find((r) => r.path.includes('no_heading'))
      expect(noHeadingResult?.title).to.equal('no_heading')
    })
  })

  describe('Nested Directories', () => {
    it('should search deeply nested markdown files', async () => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})

      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/level1/level2/level3/deep_knowledge.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: '# Deep Knowledge Topic\n\nThis is deeply nested content.',
        encoding: 'utf8',
        lines: 3,
        size: 60,
        totalLines: 3,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'deeply nested'})) as SearchKnowledgeOutput

      expect(result.totalFound).to.be.greaterThan(0)
      expect(result.results[0].path).to.include('level1/level2/level3')
    })
  })

  describe('Excerpt Generation', () => {
    beforeEach(() => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})
    })

    it('should generate excerpt containing query-relevant content', async () => {
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/test_domain/long_content.md',
            size: 200,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content:
          '# Long Document\n\n## Introduction\nThis is an introduction paragraph.\n\n## Important Section\nThis section contains important information about authentication and security.\n\n## Conclusion\nThis is the conclusion.',
        encoding: 'utf8',
        lines: 10,
        size: 200,
        totalLines: 10,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'authentication security'})) as SearchKnowledgeOutput

      const doc = result.results.find((r) => r.path.includes('long_content'))
      expect(doc?.excerpt).to.include('authentication')
    })

    it('should truncate long excerpts', async () => {
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/test_domain/very_long.md',
            size: 5000,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      // Create a very long document
      const longContent = '# Very Long Document\n\n' + 'This is a paragraph. '.repeat(100)
      readFileStub.resolves({
        content: longContent,
        encoding: 'utf8',
        lines: 100,
        size: 5000,
        totalLines: 100,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'paragraph'})) as SearchKnowledgeOutput

      const doc = result.results.find((r) => r.path.includes('very_long'))
      // Excerpt should be reasonably bounded (maxLength=800 + "..." = 803)
      expect(doc?.excerpt.length).to.be.lessThan(804)
    })
  })

  describe('Relations Section Handling', () => {
    it('should exclude relations section from excerpt', async () => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})

      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/test_domain/with_relations.md',
            size: 200,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content:
          '# Document With Relations\n\n## Relations\n@other_domain/topic\n@another_domain/subtopic\n\n## Content\nThis is the actual content about authentication patterns.',
        encoding: 'utf8',
        lines: 8,
        size: 200,
        totalLines: 8,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'authentication patterns'})) as SearchKnowledgeOutput

      const doc = result.results.find((r) => r.path.includes('with_relations'))
      // The excerpt should not prominently feature the relations section
      expect(doc?.excerpt).to.include('authentication')
    })
  })

  describe('Index Caching', () => {
    beforeEach(() => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})

      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-01-01'),
            path: '/test/.brv/context-tree/test/file.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: '# Test File\n\nTest content for caching.',
        encoding: 'utf8',
        lines: 3,
        size: 50,
        totalLines: 3,
        truncated: false,
      })
    })

    it('should cache index between searches', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)

      // First search builds the index
      await tool.execute({query: 'test'})
      const firstGlobCount = globFilesStub.callCount

      // Second search should use cached index (flush may call readFile for scoring,
      // but the index itself is not rebuilt — glob should not be called again)
      await tool.execute({query: 'test'})
      const secondGlobCount = globFilesStub.callCount

      // Glob should not be called again — index was served from TTL cache
      expect(secondGlobCount).to.equal(firstGlobCount)
    })

    it('should invalidate cache when file is modified', async () => {
      // Disable TTL to test mtime-based invalidation
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // First search builds the index
      await tool.execute({query: 'test'})
      const firstCallCount = readFileStub.callCount

      // Simulate file modification by changing mtime
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-02-01'), // Different modification time
            path: '/test/.brv/context-tree/test/file.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      // Second search should rebuild the index
      await tool.execute({query: 'test'})
      const secondCallCount = readFileStub.callCount

      // readFile should be called again due to cache invalidation
      expect(secondCallCount).to.be.greaterThan(firstCallCount)
    })

    it('should invalidate cache when files are added', async () => {
      // Disable TTL to test mtime-based invalidation
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // First search builds the index
      await tool.execute({query: 'test'})
      const firstCallCount = readFileStub.callCount

      // Simulate adding a new file
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-01-01'),
            path: '/test/.brv/context-tree/test/file.md',
            size: 100,
          },
          {
            isDirectory: false,
            modified: new Date('2024-01-02'),
            path: '/test/.brv/context-tree/test/new_file.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 2 files',
        totalFound: 2,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) =>
        Promise.resolve({
          content: filePath.includes('new_file') ? '# New File\n\nNew content.' : '# Test File\n\nTest content.',
          encoding: 'utf8',
          lines: 3,
          size: 50,
          totalLines: 3,
          truncated: false,
        }),
      )

      // Second search should rebuild the index
      await tool.execute({query: 'test'})
      const secondCallCount = readFileStub.callCount

      // readFile should be called again for all files due to cache invalidation
      expect(secondCallCount).to.be.greaterThan(firstCallCount)
    })

    it('should skip glob check within TTL window', async () => {
      // Use a long TTL to ensure we stay within the window
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 60_000})

      // First search builds the index
      await tool.execute({query: 'test'})
      const firstGlobCount = globFilesStub.callCount

      // Second search within TTL should skip glob entirely
      await tool.execute({query: 'test'})
      const secondGlobCount = globFilesStub.callCount

      // globFiles should NOT be called again (TTL fast path)
      expect(secondGlobCount).to.equal(firstGlobCount)
    })

    it('should skip listDirectory when cache exists for same path', async () => {
      // Disable TTL to ensure we go through the full validation path
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // First search - listDirectory is called
      await tool.execute({query: 'test'})
      const firstListDirCount = listDirectoryStub.callCount

      // Second search - listDirectory should be skipped (cache exists for same path)
      await tool.execute({query: 'test'})
      const secondListDirCount = listDirectoryStub.callCount

      // listDirectory should NOT be called again
      expect(secondListDirCount).to.equal(firstListDirCount)
    })

    it('should flush access hits to disk even when index cache stays valid', async () => {
      // Use long TTL so the index is never rebuilt — flush must still persist hits
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 60_000})
      const writeFileStub = fileSystemMock.writeFile as SinonStub

      // First search: builds index, accumulates 1 hit
      await tool.execute({query: 'test'})
      expect(writeFileStub.callCount).to.equal(0) // no flush yet (nothing to flush before first search)

      // Second search: flush runs before acquireIndex, writes the hit to disk
      await tool.execute({query: 'test'})
      expect(writeFileStub.callCount).to.equal(1) // hit from first search flushed

      // The written content must contain a scoring frontmatter block — even for legacy
      // files that started with no frontmatter (the upsert path must prepend it)
      const writtenContent: string = writeFileStub.firstCall.args[1]
      expect(writtenContent).to.include('---', 'flushed file must have a frontmatter block')
      expect(writtenContent).to.match(/importance:\s*\d/, 'flushed frontmatter must include importance')
      expect(writtenContent).to.include('# Test File', 'original body must be preserved after prepended frontmatter')

      // Third search: pendingAccessHits cleared after second flush; second hit now flushed
      await tool.execute({query: 'test'})
      expect(writeFileStub.callCount).to.equal(2)
    })

    it('should reflect flushed scoring in the same search that triggered the flush', async () => {
      // Use long TTL so the index is never rebuilt between calls
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 60_000})

      // First search: builds index with default scoring (importance=50, no frontmatter)
      const result1 = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput
      expect(result1.results).to.have.length.greaterThan(0, 'first search must find the test file')

      // readFile returns the updated content (with elevated importance) when flushing on second search
      readFileStub.resolves({
        content: '---\nimportance: 53\nmaturity: draft\nrecency: 1\n---\n# Test File\n\nTest content for caching.',
        encoding: 'utf8',
        lines: 7,
        size: 100,
        totalLines: 7,
        truncated: false,
      })

      // Second search: flush patches documentMap — result score must be >= first search's score
      // because importance grew from 50 → 53 (one access hit applied)
      const result2 = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput
      expect(result2.results).to.have.length.greaterThan(0, 'second search must still find the test file after flush')
      expect(result2.results[0].score).to.be.greaterThanOrEqual(result1.results[0].score)
    })

    it('should reflect flushed maturity in minMaturity filter after warm-TTL flush', async () => {
      // Use long TTL so the index is never rebuilt
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 60_000})

      // First search: file is indexed with maturity='draft' (no frontmatter → applyDefaultScoring)
      await tool.execute({query: 'test'})

      // On flush the file is read with importance=62; after +3 access bonus → 65 → promoted to 'validated'
      readFileStub.resolves({
        content: '---\nimportance: 62\nmaturity: draft\nrecency: 1\n---\n# Test File\n\nTest content for caching.',
        encoding: 'utf8',
        lines: 7,
        size: 100,
        totalLines: 7,
        truncated: false,
      })

      // Second search with minMaturity='validated': flush fires first, promoting the file.
      // The minMaturity filter reads symbolTree.symbolMap which must be patched for the file to pass.
      // If the symbolTree patch regressed, symbol.metadata.maturity stays 'draft' and the file is
      // excluded → results are empty → this assertion fails (not skipped).
      const result = (await tool.execute({minMaturity: 'validated', query: 'test'})) as SearchKnowledgeOutput
      expect(result.results).to.have.length.greaterThan(0, 'promoted file must pass the minMaturity filter')
      const found = result.results.find((r) => r.path.includes('file'))
      expect(found).to.exist
    })

    it('should reflect flushed importance in overview after warm-TTL flush', async () => {
      // baseDirectory='/test' makes contextTreePath='/test/.brv/context-tree', which is the
      // common prefix of the mock file paths.  That causes findMarkdownFilesWithMtime to strip
      // the prefix correctly, yielding relative path 'test/file.md' (depth 2) — reachable by
      // the default overviewDepth=2.  Without this, the absolute mock path is used as-is and
      // the file appears at depth 5, invisible to the depth-2 overview.
      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 60_000})

      // Search 1: build index and accumulate 1 hit
      await tool.execute({query: 'test'})
      // Search 2 (overview): flush search-1 hit, snapshot importance after flush (50+3=53)
      const overview1 = (await tool.execute({overview: true, query: 'irrelevant'})) as SearchKnowledgeOutput

      // Switch readFile to return content with higher importance for the next flush
      readFileStub.resolves({
        content: '---\nimportance: 80\nmaturity: validated\nrecency: 1\n---\n# Test File\n\nTest content for caching.',
        encoding: 'utf8',
        lines: 7,
        size: 100,
        totalLines: 7,
        truncated: false,
      })

      // Search 3: accumulates another hit (overview searches don't accumulate hits)
      await tool.execute({query: 'test'})
      // Search 4 (overview): flush search-3 hit (80+3=83), symbolTree patched to importance=83
      const overview2 = (await tool.execute({overview: true, query: 'irrelevant'})) as SearchKnowledgeOutput

      // Both entries must be present — overview always shows all nodes regardless of query
      const entry1 = overview1.results.find((r) => r.path.includes('file'))
      const entry2 = overview2.results.find((r) => r.path.includes('file'))
      expect(entry1).to.exist
      expect(entry2).to.exist
      // score = importance/100; after symbolTree patch entry2 must score higher than entry1
      expect(entry2!.score).to.be.greaterThan(entry1!.score)
    })

    it('should handle concurrent searches racing over the same flush batch', async () => {
      // Use long TTL so both concurrent searches take the TTL fast path after the first build
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 60_000})
      const writeFileStub = fileSystemMock.writeFile as SinonStub

      // Build index and accumulate 1 pending hit; capture pre-flush score as baseline
      const result0 = (await tool.execute({query: 'test'})) as SearchKnowledgeOutput
      expect(result0.results).to.have.length.greaterThan(0, 'first search must find the test file')
      expect(writeFileStub.callCount).to.equal(0)

      // Two concurrent searches: in test environments with synchronous stubs, each
      // search's flush completes before the next enters (no in-flight overlap).
      // With real I/O the flushingPromise dedup kicks in and coalesces writes.
      // Either way both searches must succeed without errors or lost results.
      const [result1, result2] = (await Promise.all([
        tool.execute({query: 'test'}),
        tool.execute({query: 'test'}),
      ])) as [SearchKnowledgeOutput, SearchKnowledgeOutput]

      // Both must return valid results — concurrent execution must not cause errors
      expect(result1.results).to.have.length.greaterThan(0, 'concurrent search 1 must find the test file')
      expect(result2.results).to.have.length.greaterThan(0, 'concurrent search 2 must find the test file')

      // At least one flush write must have occurred
      expect(writeFileStub.callCount).to.be.greaterThanOrEqual(1)
    })
  })

  describe('Stop Word Filtering', () => {
    beforeEach(() => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})

      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/auth/authentication.md',
            size: 100,
          },
          {
            isDirectory: false,
            modified: new Date(),
            path: '/test/.brv/context-tree/api/api_design.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 2 files',
        totalFound: 2,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        if (filePath.includes('authentication')) {
          return Promise.resolve({
            content: '# Authentication System\n\nJWT-based authentication with refresh tokens.',
            encoding: 'utf8',
            lines: 3,
            size: 80,
            totalLines: 3,
            truncated: false,
          })
        }

        return Promise.resolve({
          content: '# API Design Patterns\n\nRESTful API conventions.',
          encoding: 'utf8',
          lines: 3,
          size: 60,
          totalLines: 3,
          truncated: false,
        })
      })
    })

    it('should filter stop words from natural language queries', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Natural language query with stop words
      const result = (await tool.execute({
        query: 'I want to know about authentication logic in this project',
      })) as SearchKnowledgeOutput

      // Should find authentication document despite stop words
      expect(result.totalFound).to.be.greaterThan(0)
      const authResult = result.results.find((r) => r.path.includes('authentication'))
      expect(authResult).to.exist
    })

    it('should handle query with only stop words by using original query', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Query with mostly stop words - should fall back to original
      const result = (await tool.execute({
        query: 'the and or',
      })) as SearchKnowledgeOutput

      // Should not crash, may or may not find results
      expect(result.results).to.be.an('array')
    })

    it('should preserve meaningful keywords in query', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Query with mix of stop words and meaningful terms
      const result = (await tool.execute({
        query: 'how does the JWT authentication work',
      })) as SearchKnowledgeOutput

      // Should find authentication (JWT is a meaningful term)
      expect(result.totalFound).to.be.greaterThan(0)
      const authResult = result.results.find((r) => r.path.includes('authentication'))
      expect(authResult).to.exist
    })

    it('should handle API-related queries with stop words', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Natural language query about API
      const result = (await tool.execute({
        query: 'show me the API design patterns we use',
      })) as SearchKnowledgeOutput

      // Should find API design document
      expect(result.totalFound).to.be.greaterThan(0)
      const apiResult = result.results.find((r) => r.path.includes('api_design'))
      expect(apiResult).to.exist
    })
  })

  describe('Parallel Execution Safety', () => {
    beforeEach(() => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})

      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-01-01'),
            path: '/test/.brv/context-tree/test/file.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: '# Test File\n\nTest content for parallel execution.',
        encoding: 'utf8',
        lines: 3,
        size: 50,
        totalLines: 3,
        truncated: false,
      })
    })

    it('should prevent duplicate index builds when executed in parallel', async () => {
      // Disable TTL to force index validation path
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Add artificial delay to readFile to simulate slow I/O
      readFileStub.callsFake(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50)
        })
        return {
          content: '# Test File\n\nTest content for parallel execution.',
          encoding: 'utf8',
          lines: 3,
          size: 50,
          totalLines: 3,
          truncated: false,
        }
      })

      // Execute 5 searches in parallel (simulating batch tool or concurrent agent calls)
      const parallelResults = await Promise.all([
        tool.execute({query: 'test'}),
        tool.execute({query: 'content'}),
        tool.execute({query: 'parallel'}),
        tool.execute({query: 'file'}),
        tool.execute({query: 'execution'}),
      ])

      // All results should be valid
      for (const result of parallelResults) {
        expect(result).to.have.property('results')
        expect(result).to.have.property('totalFound')
      }

      // readFile should only be called once (not 5 times) due to promise-based locking
      // The first call builds the index, subsequent parallel calls wait on the same promise
      expect(readFileStub.callCount).to.equal(1)
    })

    it('should return same cached index to all parallel callers', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 60_000})

      // Add delay to make parallel execution overlap
      readFileStub.callsFake(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 30)
        })
        return {
          content: '# Test File\n\nTest content.',
          encoding: 'utf8',
          lines: 3,
          size: 50,
          totalLines: 3,
          truncated: false,
        }
      })

      // Execute searches in parallel
      const [result1, result2, result3] = await Promise.all([
        tool.execute({query: 'test'}),
        tool.execute({query: 'test'}),
        tool.execute({query: 'test'}),
      ])

      // All should get valid results
      expect((result1 as SearchKnowledgeOutput).results).to.be.an('array')
      expect((result2 as SearchKnowledgeOutput).results).to.be.an('array')
      expect((result3 as SearchKnowledgeOutput).results).to.be.an('array')

      // Only one index build should have happened
      expect(readFileStub.callCount).to.equal(1)
    })

    it('should handle parallel execution when cache is invalidated mid-flight', async () => {
      // Use short TTL to test cache validation
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      let buildCount = 0
      readFileStub.callsFake(async () => {
        buildCount++
        const currentBuild = buildCount
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20)
        })
        return {
          content: `# Test File ${currentBuild}\n\nBuild number ${currentBuild}.`,
          encoding: 'utf8',
          lines: 3,
          size: 50,
          totalLines: 3,
          truncated: false,
        }
      })

      // First batch of parallel calls
      const firstBatch = await Promise.all([tool.execute({query: 'test'}), tool.execute({query: 'test'})])

      // Both should succeed
      expect((firstBatch[0] as SearchKnowledgeOutput).results).to.be.an('array')
      expect((firstBatch[1] as SearchKnowledgeOutput).results).to.be.an('array')

      // First batch should only trigger one build
      const firstBatchBuildCount = readFileStub.callCount
      expect(firstBatchBuildCount).to.equal(1)

      // Simulate file modification
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-02-01'), // Changed mtime
            path: '/test/.brv/context-tree/test/file.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      // Second batch - should rebuild due to changed mtime
      const secondBatch = await Promise.all([tool.execute({query: 'test'}), tool.execute({query: 'test'})])

      expect((secondBatch[0] as SearchKnowledgeOutput).results).to.be.an('array')
      expect((secondBatch[1] as SearchKnowledgeOutput).results).to.be.an('array')

      // Second batch triggers one more build (not two) + one readFile from access-hit flush = 3 total
      expect(readFileStub.callCount).to.equal(3)
    })

    it('should not deadlock when multiple tools execute concurrently', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Simulate varying response times
      let callIndex = 0
      readFileStub.callsFake(async () => {
        const delay = [10, 50, 30, 20, 40][callIndex++ % 5]
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay)
        })
        return {
          content: '# Test\n\nContent.',
          encoding: 'utf8',
          lines: 3,
          size: 30,
          totalLines: 3,
          truncated: false,
        }
      })

      // Run many concurrent executions - should complete without deadlock
      const manyPromises = Array.from({length: 10}, (_, i) => tool.execute({query: `query${i}`}))

      // Should complete within reasonable time (not hang)
      const results = await Promise.race([
        Promise.all(manyPromises),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Timeout - possible deadlock'))
          }, 5000)
        }),
      ])

      expect(results).to.have.length(10)
    })

    it('should handle errors gracefully during parallel builds', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock, {cacheTtlMs: 0})

      // Make readFile fail
      readFileStub.rejects(new Error('Simulated I/O error'))

      // Execute in parallel - all should handle the error gracefully
      const results = await Promise.all([
        tool.execute({query: 'test'}),
        tool.execute({query: 'test'}),
        tool.execute({query: 'test'}),
      ])

      // All calls should return valid (empty) results, not throw
      for (const result of results) {
        expect(result).to.have.property('results')
        expect((result as SearchKnowledgeOutput).results).to.deep.equal([])
        expect((result as SearchKnowledgeOutput).message).to.include('empty')
      }
    })
  })

  describe('OOD Detection', () => {
    it('should fall back to file mtime when updatedAt is invalid', async () => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {
            isDirectory: false,
            modified: new Date('2024-01-01'),
            path: '/test/.brv/context-tree/test/invalid-updated-at.md',
            size: 100,
          },
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })
      readFileStub.resolves({
        content: [
          '---',
          'title: "Invalid UpdatedAt"',
          'tags: []',
          'keywords: []',
          'importance: 70',
          'recency: 1',
          'maturity: validated',
          'updatedAt: "not-a-real-date"',
          '---',
          '',
          '# Invalid UpdatedAt',
          '',
          'authentication token refresh flow',
        ].join('\n'),
        encoding: 'utf8',
        lines: 12,
        size: 160,
        totalLines: 12,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'authentication'})) as SearchKnowledgeOutput

      expect(result.results).to.have.length.greaterThan(0)
      expect(Number.isFinite(result.results[0].score)).to.equal(true)
    })

    it('should use the highest BM25 candidate instead of the top compound-ranked result', () => {
      const service = new SearchKnowledgeService(fileSystemMock)
      const now = new Date().toISOString()
      const documentMap = new Map<string, {
        content: string
        id: string
        mtime: number
        path: string
        scoring: {
          importance: number
          maturity: 'draft'
          recency: number
          updatedAt: string
        }
        title: string
      }>()

      documentMap.set('weak-compound-top', {
        content: '# Weak lexical match\n\nneedle',
        id: 'weak-compound-top',
        mtime: Date.now(),
        path: 'test/weak-compound-top.md',
        scoring: {importance: 100, maturity: 'draft', recency: 1, updatedAt: now},
        title: 'Weak lexical match',
      })
      documentMap.set('strong-bm25', {
        content: '# Strong lexical match\n\nneedle needle needle',
        id: 'strong-bm25',
        mtime: Date.now(),
        path: 'test/strong-bm25.md',
        scoring: {importance: 0, maturity: 'draft', recency: 0, updatedAt: now},
        title: 'Strong lexical match',
      })

      for (let i = 0; i < 48; i++) {
        documentMap.set(`filler-${i}`, {
          content: `# Filler ${i}\n\nunrelated content`,
          id: `filler-${i}`,
          mtime: Date.now(),
          path: `test/filler-${i}.md`,
          scoring: {importance: 50, maturity: 'draft', recency: 1, updatedAt: now},
          title: `Filler ${i}`,
        })
      }

      const fakeIndex = {
        search: sandbox.stub().returns([
          {id: 'weak-compound-top', queryTerms: ['needle'], score: 1},
          {id: 'strong-bm25', queryTerms: ['needle'], score: 1.6},
        ]),
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).runTextSearch(
        'needle',
        documentMap,
        fakeIndex,
        10,
        undefined,
        {root: [], symbolMap: new Map()},
        {backlinks: new Map(), forwardLinks: new Map()},
      ) as SearchKnowledgeOutput

      expect(result.totalFound).to.equal(2)
      expect(result.results).to.have.length.greaterThan(0)
      expect(result.message).to.not.include('No matching knowledge found for this query')
    })
  })

  // ── Summary hotness ranking ────────────────────────────────────────────────

  describe('Summary hotness ranking', () => {
    it('surfaces context.md hits as summary results for folder searches', async () => {
      listDirectoryStub.resolves({count: 1, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/architecture/authentication/context.md', size: 100},
        ],
        ignoredCount: 0,
        message: 'Found 1 file',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: '# Topic: authentication\n\nAuth topic summary.',
        encoding: 'utf8',
        lines: 3,
        size: 100,
        totalLines: 3,
        truncated: false,
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({query: 'auth'})) as {
        results: Array<{path: string; symbolKind?: string}>
      }

      expect(result.results[0]?.path).to.equal('architecture/authentication')
      expect(result.results[0]?.symbolKind).to.equal('summary')
    })

    it('falls back to context.md as a summary source for exact folder-like queries', async () => {
      listDirectoryStub.resolves({count: 2, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/architecture/authentication/context.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/architecture/authentication/auth_module_overview.md', size: 100},
        ],
        ignoredCount: 0,
        message: 'Found 2 files',
        totalFound: 2,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        if (filePath.endsWith('/architecture/authentication/context.md')) {
          return Promise.resolve({
            content: '# Topic: authentication\n\nTop-level auth module overview and boundaries.',
            encoding: 'utf8',
            lines: 3,
            size: 100,
            totalLines: 3,
            truncated: false,
          })
        }

        return Promise.resolve({
          content: '# Auth Module Overview\n\nJWT and session handling for the authentication module.',
          encoding: 'utf8',
          lines: 3,
          size: 100,
          totalLines: 3,
          truncated: false,
        })
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({limit: 3, query: 'auth'})) as {
        results: Array<{path: string; symbolKind?: string}>
      }

      expect(result.results.some((r) => r.path === 'architecture/authentication' && r.symbolKind === 'summary')).to.equal(true)
      expect(result.results.some((r) => r.path === 'architecture/authentication/auth_module_overview.md')).to.equal(true)
    })

    it('returns the folder summary first for an exact folder query', async () => {
      listDirectoryStub.resolves({count: 3, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/context.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/login.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/_index.md', size: 140},
        ],
        ignoredCount: 0,
        message: 'Found 3 files',
        totalFound: 3,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        if (filePath.endsWith('/auth/_index.md')) {
          return Promise.resolve({
            content:
              '---\ncondensation_order: 1\nimportance: 75\nmaturity: core\nrecency: 0.9\ntoken_count: 80\ntype: summary\n---\nAuthentication summary.',
            encoding: 'utf8',
            lines: 3,
            size: 140,
            totalLines: 3,
            truncated: false,
          })
        }

        if (filePath.endsWith('/auth/context.md')) {
          return Promise.resolve({
            content: '# Authentication\n\nTop-level auth module overview.',
            encoding: 'utf8',
            lines: 3,
            size: 100,
            totalLines: 3,
            truncated: false,
          })
        }

        return Promise.resolve({
          content: '# Login Flow\n\nHandles user login and session issuance.',
          encoding: 'utf8',
          lines: 3,
          size: 100,
          totalLines: 3,
          truncated: false,
        })
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({limit: 3, query: 'auth'})) as {
        results: Array<{path: string; symbolKind?: string}>
      }

      expect(result.results[0]?.path).to.equal('auth')
      expect(result.results[0]?.symbolKind).to.equal('summary')
      expect(result.results.some((r) => r.path === 'auth/login.md')).to.equal(true)
    })

    it('_index.md frontmatter scoring elevates core domain summary above draft domain', async () => {
      // Two domains with identical BM25 content so scores differ only due to _index.md scoring
      listDirectoryStub.resolves({count: 4, entries: [], tree: '', truncated: false})

      // baseDirectory='/test' → contextTreePath='/test/.brv/context-tree' → glob paths strip correctly
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/jwt.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/_index.md', size: 150},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/api/design.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/api/_index.md', size: 100},
        ],
        ignoredCount: 0,
        message: 'Found 4 files',
        totalFound: 4,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        // auth _index.md: high importance + core maturity
        if (filePath.includes('auth') && filePath.includes('_index')) {
          return Promise.resolve({
            content:
              '---\ncondensation_order: 1\nimportance: 90\nmaturity: core\nrecency: 0.9\ntoken_count: 100\ntype: summary\n---\nAuth domain summary.',
            encoding: 'utf8',
            lines: 3,
            size: 150,
            totalLines: 3,
            truncated: false,
          })
        }

        // api _index.md: low importance + draft maturity
        if (filePath.includes('api') && filePath.includes('_index')) {
          return Promise.resolve({
            content:
              '---\ncondensation_order: 1\nimportance: 60\nmaturity: validated\nrecency: 0.7\ntoken_count: 50\ntype: summary\n---\nApi domain summary.',
            encoding: 'utf8',
            lines: 3,
            size: 100,
            totalLines: 3,
            truncated: false,
          })
        }

        // Both leaf documents have identical content to equalise base BM25 scores
        return Promise.resolve({
          content: '# Security Module\n\nHandles security token validation and renewal.',
          encoding: 'utf8',
          lines: 3,
          size: 80,
          totalLines: 3,
          truncated: false,
        })
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({query: 'security token'})) as {
        message: string
        results: Array<{excerpt: string; path: string; score: number; symbolKind?: string; title: string}>
        totalFound: number
      }

      const summaryResults = result.results.filter((r) => r.symbolKind === 'summary')
      expect(summaryResults.length).to.be.greaterThanOrEqual(2)

      const authSummary = summaryResults.find((r) => r.path === 'auth')
      const apiSummary = summaryResults.find((r) => r.path === 'api')

      expect(authSummary).to.exist
      expect(apiSummary).to.exist
      // core/high-importance domain must outscore the draft/low-importance domain
      expect(authSummary!.score).to.be.greaterThan(apiSummary!.score)
    })

    it('filters propagated summary results by minMaturity', async () => {
      listDirectoryStub.resolves({count: 2, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/jwt.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/_index.md', size: 120},
        ],
        ignoredCount: 0,
        message: 'Found 2 files',
        totalFound: 2,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        if (filePath.includes('_index')) {
          return Promise.resolve({
            content:
              '---\ncondensation_order: 1\nimportance: 70\nmaturity: draft\nrecency: 0.9\ntoken_count: 100\ntype: summary\n---\nAuth domain summary.',
            encoding: 'utf8',
            lines: 3,
            size: 120,
            totalLines: 3,
            truncated: false,
          })
        }

        return Promise.resolve({
          content: '---\nimportance: 90\nmaturity: core\n---\n# JWT\n\nSecurity token handling.',
          encoding: 'utf8',
          lines: 4,
          size: 100,
          totalLines: 4,
          truncated: false,
        })
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({minMaturity: 'core', query: 'security token'})) as {
        results: Array<{path: string; symbolKind?: string}>
      }

      expect(result.results.some((r) => r.path === 'auth' && r.symbolKind === 'summary')).to.equal(false)
      expect(result.results.some((r) => r.path === 'auth/jwt.md')).to.equal(true)
    })

    it('filters weak propagated summary results by the score gap ratio', async () => {
      listDirectoryStub.resolves({count: 2, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/jwt.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/auth/_index.md', size: 120},
        ],
        ignoredCount: 0,
        message: 'Found 2 files',
        totalFound: 2,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        if (filePath.includes('_index')) {
          return Promise.resolve({
            content:
              '---\ncondensation_order: 1\nimportance: 5\nmaturity: draft\nrecency: 0.1\ntoken_count: 100\ntype: summary\n---\nWeak auth domain summary.',
            encoding: 'utf8',
            lines: 3,
            size: 120,
            totalLines: 3,
            truncated: false,
          })
        }

        return Promise.resolve({
          content: '---\nimportance: 95\nmaturity: core\nrecency: 1\n---\n# JWT\n\nSecurity token handling and renewal.',
          encoding: 'utf8',
          lines: 4,
          size: 100,
          totalLines: 4,
          truncated: false,
        })
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({query: 'security token'})) as {
        results: Array<{path: string; symbolKind?: string}>
      }

      expect(result.results.some((r) => r.path === 'auth/jwt.md')).to.equal(true)
      expect(result.results.some((r) => r.path === 'auth' && r.symbolKind === 'summary')).to.equal(false)
    })

    it('propagates parent summary hits from context.md when _index.md is absent', async () => {
      listDirectoryStub.resolves({count: 2, entries: [], tree: '', truncated: false})
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/architecture/authentication/context.md', size: 100},
          {isDirectory: false, modified: new Date('2024-01-01'), path: '/test/.brv/context-tree/architecture/authentication/jwt.md', size: 100},
        ],
        ignoredCount: 0,
        message: 'Found 2 files',
        totalFound: 2,
        truncated: false,
      })

      readFileStub.callsFake((filePath: string) => {
        if (filePath.endsWith('/architecture/authentication/context.md')) {
          return Promise.resolve({
            content: '---\nimportance: 70\nmaturity: core\nrecency: 0.8\n---\n# Topic: authentication\n\nAuth topic summary.',
            encoding: 'utf8',
            lines: 5,
            size: 100,
            totalLines: 5,
            truncated: false,
          })
        }

        return Promise.resolve({
          content: '---\nimportance: 90\nmaturity: core\nrecency: 1\n---\n# JWT\n\nAuth token handling.',
          encoding: 'utf8',
          lines: 5,
          size: 100,
          totalLines: 5,
          truncated: false,
        })
      })

      const tool = createSearchKnowledgeTool(fileSystemMock, {baseDirectory: '/test', cacheTtlMs: 0})
      const result = (await tool.execute({query: 'auth token'})) as {
        results: Array<{path: string; symbolKind?: string}>
      }

      expect(result.results.some((r) => r.path === 'architecture/authentication' && r.symbolKind === 'summary')).to.equal(true)
    })
  })
})
