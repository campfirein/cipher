import {expect} from 'chai'
import {createSandbox, SinonStub} from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

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

  beforeEach(() => {
    globFilesStub = sandbox.stub()
    listDirectoryStub = sandbox.stub()
    readFileStub = sandbox.stub()

    fileSystemMock = {
      editFile: sandbox.stub(),
      globFiles: globFilesStub,
      initialize: sandbox.stub(),
      listDirectory: listDirectoryStub,
      readFile: readFileStub,
      searchContent: sandbox.stub(),
      writeFile: sandbox.stub(),
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

    it('should include normalized score in [0, 1) range', async () => {
      const tool = createSearchKnowledgeTool(fileSystemMock)
      const result = (await tool.execute({query: 'authentication'})) as SearchKnowledgeOutput

      for (const r of result.results) {
        expect(r.score).to.be.a('number')
        expect(r.score).to.be.greaterThan(0)
        expect(r.score).to.be.lessThan(1)
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
      const firstCallCount = readFileStub.callCount

      // Second search should use cached index
      await tool.execute({query: 'test'})
      const secondCallCount = readFileStub.callCount

      // readFile should not be called again for the same files
      expect(secondCallCount).to.equal(firstCallCount)
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

  // ── Summary hotness ranking ────────────────────────────────────────────────

  describe('Summary hotness ranking', () => {
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
              '---\ncondensation_order: 1\nimportance: 20\nmaturity: draft\nrecency: 0.2\ntoken_count: 50\ntype: summary\n---\nApi domain summary.',
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
  })
})
