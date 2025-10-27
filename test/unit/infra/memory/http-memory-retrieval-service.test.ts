/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {HttpMemoryRetrievalService} from '../../../../src/infra/memory/http-memory-retrieval-service.js'

describe('HttpMemoryRetrievalService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const accessToken = 'test-access-token'
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
            children_ids: [],
            content: 'First memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            node_keys: ['path1', 'path2'],
            parent_ids: ['parent1'],
            score: 0.85,
            title: 'First Memory',
          },
        ],
        related_memories: [
          {
            children_ids: ['child1'],
            content: 'Related memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
            node_keys: ['path3'],
            parent_ids: [],
            score: 0.5,
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
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        accessToken,
        nodeKeys: ['path1', 'path2'],
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(1)

      // Verify first memory
      expect(result.memories[0].id).to.equal(mockResponse.memories[0].id)
      expect(result.memories[0].title).to.equal(mockResponse.memories[0].title)
      expect(result.memories[0].content).to.equal(mockResponse.memories[0].content)
      expect(result.memories[0].score).to.equal(mockResponse.memories[0].score)
      expect(result.memories[0].nodeKeys).to.deep.equal(mockResponse.memories[0].node_keys)
      expect(result.memories[0].parentIds).to.deep.equal(mockResponse.memories[0].parent_ids)
      expect(result.memories[0].childrenIds).to.deep.equal(mockResponse.memories[0].children_ids)

      // Verify related memory
      expect(result.relatedMemories[0].id).to.equal(mockResponse.related_memories[0].id)
      expect(result.relatedMemories[0].title).to.equal(mockResponse.related_memories[0].title)
      expect(result.relatedMemories[0].childrenIds).to.deep.equal(mockResponse.related_memories[0].children_ids)
    })

    it('should retrieve memories successfully without node-keys (broad search)', async () => {
      const mockResponse = {
        memories: [
          {
            children_ids: [],
            content: 'Memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            node_keys: [],
            parent_ids: [],
            score: 0.75,
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
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        accessToken,
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
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        accessToken,
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.deep.equal([])
      expect(result.relatedMemories).to.deep.equal([])
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
        accessToken,
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
        accessToken,
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
        accessToken,
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
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.retrieve({
          accessToken,
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
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(404, {error: 'Not found'})

      try {
        await service.retrieve({
          accessToken,
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
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.retrieve({
          accessToken,
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
          accessToken,
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

      const timeoutService = new HttpMemoryRetrievalService({apiBaseUrl, timeout: 100})

      try {
        await timeoutService.retrieve({
          accessToken,
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
