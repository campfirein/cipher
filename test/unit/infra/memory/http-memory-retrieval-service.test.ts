/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {HttpMemoryRetrievalService} from '../../../../src/infra/memory/http-memory-retrieval-service.js'

describe('HttpMemoryRetrievalService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const sessionKey = 'test-session-key'
  const spaceId = 'a0000000-b001-0000-0000-000000000000'
  const query = 'what is the best practices applied to this project?'

  let service: HttpMemoryRetrievalService

  beforeEach(() => {
    service = new HttpMemoryRetrievalService({apiBaseUrl})
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('retrieve', () => {
    it('should retrieve memories successfully with all parameters', async () => {
      const mockResponse = {
        memories: [
          {
            bullet_id: 'lessons-00001',
            children_ids: [],
            content: 'First memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            metadata_type: 'experience',
            node_keys: ['path1', 'path2'],
            parent_ids: ['parent1'],
            score: 0.85,
            section: 'Lessons Learned',
            tags: ['typescript', 'testing'],
            timestamp: '2025-10-26T15:59:01.191Z',
            title: 'First Memory',
          },
        ],
        related_memories: [
          {
            bullet_id: 'common-00001',
            children_ids: ['child1'],
            content: 'Related memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
            metadata_type: 'knowledge',
            node_keys: ['path3'],
            parent_ids: [],
            score: 0.5,
            section: 'Common Errors',
            tags: ['error'],
            timestamp: '2025-10-26T16:00:00.000Z',
            title: 'Related Memory',
          },
        ],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          node_keys: 'path1,path2',
          project_id: spaceId,
          query,
        })
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        nodeKeys: ['path1', 'path2'],
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(1)

      // Verify first memory
      expect(result.memories[0].id).to.equal(mockResponse.memories[0].id)
      expect(result.memories[0].bulletId).to.equal(mockResponse.memories[0].bullet_id)
      expect(result.memories[0].title).to.equal(mockResponse.memories[0].title)
      expect(result.memories[0].content).to.equal(mockResponse.memories[0].content)
      expect(result.memories[0].score).to.equal(mockResponse.memories[0].score)
      expect(result.memories[0].section).to.equal(mockResponse.memories[0].section)
      expect(result.memories[0].metadataType).to.equal(mockResponse.memories[0].metadata_type)
      expect(result.memories[0].timestamp).to.equal(mockResponse.memories[0].timestamp)
      expect(result.memories[0].nodeKeys).to.deep.equal(mockResponse.memories[0].node_keys)
      expect(result.memories[0].parentIds).to.deep.equal(mockResponse.memories[0].parent_ids)
      expect(result.memories[0].childrenIds).to.deep.equal(mockResponse.memories[0].children_ids)
      expect(result.memories[0].tags).to.deep.equal(mockResponse.memories[0].tags)

      // Verify related memory
      expect(result.relatedMemories[0].id).to.equal(mockResponse.related_memories[0].id)
      expect(result.relatedMemories[0].bulletId).to.equal(mockResponse.related_memories[0].bullet_id)
      expect(result.relatedMemories[0].title).to.equal(mockResponse.related_memories[0].title)
      expect(result.relatedMemories[0].section).to.equal(mockResponse.related_memories[0].section)
      expect(result.relatedMemories[0].metadataType).to.equal(mockResponse.related_memories[0].metadata_type)
      expect(result.relatedMemories[0].timestamp).to.equal(mockResponse.related_memories[0].timestamp)
      expect(result.relatedMemories[0].childrenIds).to.deep.equal(mockResponse.related_memories[0].children_ids)
      expect(result.relatedMemories[0].tags).to.deep.equal(mockResponse.related_memories[0].tags)
    })

    it('should handle related_memories without score, parent_ids, and children_ids', async () => {
      const mockResponse = {
        memories: [
          {
            bullet_id: 'lessons-00001',
            children_ids: [],
            content: 'Primary memory with score',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            metadata_type: 'experience',
            node_keys: ['path1'],
            parent_ids: ['parent1'],
            score: 0.85,
            section: 'Lessons Learned',
            tags: ['typescript'],
            timestamp: '2025-10-26T15:59:01.191Z',
            title: 'Primary Memory',
          },
        ],
        related_memories: [
          {
            bullet_id: 'common-00001',
            content: 'Related memory without score/parent_ids/children_ids',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
            metadata_type: 'knowledge',
            node_keys: ['path2'],
            section: 'Common Errors',
            tags: ['error'],
            timestamp: '2025-10-26T16:00:00.000Z',
            title: 'Related Memory',
          },
        ],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(1)

      // Verify primary memory has all fields
      expect(result.memories[0].score).to.equal(0.85)
      expect(result.memories[0].parentIds).to.deep.equal(['parent1'])
      expect(result.memories[0].childrenIds).to.deep.equal([])

      // Verify related memory has undefined for optional fields
      expect(result.relatedMemories[0].id).to.equal(mockResponse.related_memories[0].id)
      expect(result.relatedMemories[0].bulletId).to.equal(mockResponse.related_memories[0].bullet_id)
      expect(result.relatedMemories[0].title).to.equal(mockResponse.related_memories[0].title)
      expect(result.relatedMemories[0].content).to.equal(mockResponse.related_memories[0].content)
      expect(result.relatedMemories[0].section).to.equal(mockResponse.related_memories[0].section)
      expect(result.relatedMemories[0].nodeKeys).to.deep.equal(['path2'])
      expect(result.relatedMemories[0].tags).to.deep.equal(['error'])
      // These should be undefined for related memories
      expect(result.relatedMemories[0].score).to.be.undefined
      expect(result.relatedMemories[0].parentIds).to.be.undefined
      expect(result.relatedMemories[0].childrenIds).to.be.undefined
    })

    it('should retrieve memories successfully without node-keys (broad search)', async () => {
      const mockResponse = {
        memories: [
          {
            bullet_id: 'lessons-00002',
            children_ids: [],
            content: 'Memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            metadata_type: 'experience',
            node_keys: [],
            parent_ids: [],
            score: 0.75,
            section: 'Lessons Learned',
            tags: ['javascript'],
            timestamp: '2025-10-26T17:00:00.000Z',
            title: 'Memory Title',
          },
        ],
        related_memories: [],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(0)
    })

    it('should return empty results when no memories found', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.deep.equal([])
      expect(result.relatedMemories).to.deep.equal([])
    })

    it('should handle only related_memories without primary memories', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [
          {
            bullet_id: 'common-00001',
            content: 'Related memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
            metadata_type: 'knowledge',
            node_keys: ['path1'],
            section: 'Common Errors',
            tags: ['error'],
            timestamp: '2025-10-26T16:00:00.000Z',
            title: 'Related Memory',
          },
          {
            bullet_id: 'common-00002',
            content: 'Another related memory',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b69',
            metadata_type: 'knowledge',
            node_keys: [],
            section: 'Common Errors',
            tags: ['tip'],
            timestamp: '2025-10-26T17:00:00.000Z',
            title: 'Another Related',
          },
        ],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(0)
      expect(result.relatedMemories).to.have.lengthOf(2)
      expect(result.relatedMemories[0].score).to.be.undefined
      expect(result.relatedMemories[1].score).to.be.undefined
    })

    it('should handle toJson and fromJson roundtrip with optional fields', async () => {
      const mockResponse = {
        memories: [
          {
            bullet_id: 'lessons-00001',
            children_ids: [],
            content: 'Primary memory',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            metadata_type: 'experience',
            node_keys: ['path1'],
            parent_ids: ['parent1'],
            score: 0.85,
            section: 'Lessons Learned',
            tags: ['typescript'],
            timestamp: '2025-10-26T15:59:01.191Z',
            title: 'Primary Memory',
          },
        ],
        related_memories: [
          {
            bullet_id: 'common-00001',
            content: 'Related memory',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
            metadata_type: 'knowledge',
            node_keys: [],
            section: 'Common Errors',
            tags: ['error'],
            timestamp: '2025-10-26T16:00:00.000Z',
            title: 'Related Memory',
          },
        ],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      // Test toJson/fromJson roundtrip for primary memory
      const primaryJson = result.memories[0].toJson()
      expect(primaryJson.score).to.equal(0.85)
      expect(primaryJson.parentIds).to.deep.equal(['parent1'])
      expect(primaryJson.childrenIds).to.deep.equal([])

      // Test toJson/fromJson roundtrip for related memory
      const relatedJson = result.relatedMemories[0].toJson()
      expect(relatedJson.score).to.be.undefined
      expect(relatedJson.parentIds).to.be.undefined
      expect(relatedJson.childrenIds).to.be.undefined
    })

    it('should map spaceId to project_id query parameter', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      const scope = nock(apiBaseUrl)
        .get('/retrieve')
        .query((actualQuery) => {
          // Verify that spaceId is sent as project_id
          expect(actualQuery.project_id).to.equal(spaceId)
          return true
        })
        .reply(200, mockResponse)

      await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      expect(scope.isDone()).to.be.true
    })

    it('should convert nodeKeys array to comma-separated node_keys query parameter', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      const scope = nock(apiBaseUrl)
        .get('/retrieve')
        .query((actualQuery) => {
          // Verify that nodeKeys array is converted to comma-separated string
          expect(actualQuery.node_keys).to.equal('path1,path2,path3')
          return true
        })
        .reply(200, mockResponse)

      await service.retrieve({
        nodeKeys: ['path1', 'path2', 'path3'],
        query,
        sessionKey,
        spaceId,
      })

      expect(scope.isDone()).to.be.true
    })

    it('should omit node_keys parameter when nodeKeys not provided', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      const scope = nock(apiBaseUrl)
        .get('/retrieve')
        .query((actualQuery) => {
          // Verify that node_keys is NOT present in query
          expect(actualQuery.node_keys).to.be.undefined
          return true
        })
        .reply(200, mockResponse)

      await service.retrieve({
        query,
        sessionKey,
        spaceId,
      })

      expect(scope.isDone()).to.be.true
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(apiBaseUrl)
        .get('/retrieve')
        .query(true)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.retrieve({
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('401')
      }
    })

    it('should throw error on HTTP 404 Not Found', async () => {
      nock(apiBaseUrl)
        .get('/retrieve')
        .query(true)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(404, {error: 'Not found'})

      try {
        await service.retrieve({
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('404')
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(apiBaseUrl)
        .get('/retrieve')
        .query(true)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.retrieve({
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('500')
      }
    })

    it('should throw error on network failure', async () => {
      nock(apiBaseUrl).get('/retrieve').query(true).replyWithError('Network error')

      try {
        await service.retrieve({
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('Network error')
      }
    })

    it('should throw error on request timeout', async () => {
      nock(apiBaseUrl).get('/retrieve').query(true).delay(35_000).reply(200, {})

      const timeoutService = new HttpMemoryRetrievalService({apiBaseUrl, timeout: 25})

      try {
        await timeoutService.retrieve({
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
      }
    })
  })
})
