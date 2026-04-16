/* eslint-disable camelcase -- GBrain API uses snake_case field names */
import {expect} from 'chai'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sinon from 'sinon'

import {GBrainAdapter, type GBrainAdapterOptions} from '../../../../../src/agent/infra/swarm/adapters/gbrain-adapter.js'

/**
 * Create adapter with a mock executor to avoid real subprocess calls.
 */
function createTestAdapter(
  mockResults: unknown = [],
  options?: Partial<GBrainAdapterOptions>
): {adapter: GBrainAdapter; executor: sinon.SinonStub} {
  const executor = sinon.stub().resolves(mockResults)
  const adapter = new GBrainAdapter({
    repoPath: '/tmp/test-brain',
    searchMode: 'hybrid',
    ...options,
  }, executor)

  return {adapter, executor}
}

const SAMPLE_GBRAIN_RESULTS = [
  {
    chunk_source: 'compiled_truth',
    chunk_text: 'Authentication tokens verify user identity. JWT with refresh rotation.',
    page_id: 1,
    score: 0.85,
    slug: 'concept/auth-tokens',
    stale: false,
    title: 'Auth Tokens',
    type: 'concept',
  },
  {
    chunk_source: 'compiled_truth',
    chunk_text: 'The refresh flow uses rotating tokens to minimize exposure.',
    page_id: 2,
    score: 0.72,
    slug: 'concept/jwt-refresh',
    stale: false,
    title: 'JWT Refresh',
    type: 'concept',
  },
]

describe('GBrainAdapter', () => {
  afterEach(() => sinon.restore())

  it('has correct id and type', () => {
    const {adapter} = createTestAdapter()
    expect(adapter.id).to.equal('gbrain')
    expect(adapter.type).to.equal('gbrain')
  })

  it('reports correct capabilities', () => {
    const {adapter} = createTestAdapter()
    expect(adapter.capabilities.keywordSearch).to.be.true
    expect(adapter.capabilities.semanticSearch).to.be.true
    expect(adapter.capabilities.localOnly).to.be.false
    expect(adapter.capabilities.writeSupported).to.be.true
  })

  describe('query()', () => {
    it('maps GBrain search results to QueryResult format', async () => {
      const {adapter} = createTestAdapter(SAMPLE_GBRAIN_RESULTS)
      const results = await adapter.query({query: 'auth tokens'})

      expect(results).to.have.length(2)
      expect(results[0].provider).to.equal('gbrain')
      expect(results[0].content).to.equal(SAMPLE_GBRAIN_RESULTS[0].chunk_text)
      expect(results[0].id).to.equal('concept/auth-tokens')
      expect(results[0].metadata.source).to.equal('concept/auth-tokens')
      expect(results[0].metadata.matchType).to.equal('semantic')
      expect(results[0].score).to.be.a('number')
      expect(results[0].score).to.be.at.least(0)
      expect(results[0].score).to.be.at.most(1)
    })

    it('uses hybrid search (query operation) by default', async () => {
      const {adapter, executor} = createTestAdapter([])
      await adapter.query({query: 'test'})

      expect(executor.calledOnce).to.be.true
      const [operation, params] = executor.firstCall.args
      expect(operation).to.equal('query')
      expect(params.expand).to.be.true
    })

    it('uses keyword search when searchMode is keyword', async () => {
      const {adapter, executor} = createTestAdapter([], {searchMode: 'keyword'})
      await adapter.query({query: 'test'})

      const [operation] = executor.firstCall.args
      expect(operation).to.equal('search')
    })

    it('uses vector search without expansion when searchMode is vector', async () => {
      const {adapter, executor} = createTestAdapter([], {searchMode: 'vector'})
      await adapter.query({query: 'test'})

      const [operation, params] = executor.firstCall.args
      expect(operation).to.equal('query')
      expect(params.expand).to.be.false
    })

    it('passes maxResults as limit', async () => {
      const {adapter, executor} = createTestAdapter([])
      await adapter.query({maxResults: 5, query: 'test'})

      const [, params] = executor.firstCall.args
      expect(params.limit).to.equal(5)
    })

    it('normalizes keyword scores to 0-1 range', async () => {
      const highScoreResult = [{
        ...SAMPLE_GBRAIN_RESULTS[0],
        score: 5.5, // Raw ts_rank can exceed 1
      }]
      const {adapter} = createTestAdapter(highScoreResult, {searchMode: 'keyword'})
      const results = await adapter.query({query: 'test'})

      expect(results[0].score).to.be.lessThan(1)
      expect(results[0].score).to.be.greaterThan(0)
    })
  })

  describe('healthCheck()', () => {
    /** Real directory — healthCheck() requires repoPath to exist before invoking the executor. */
    let tempRepoPath: string

    beforeEach(() => {
      tempRepoPath = mkdtempSync(join(tmpdir(), 'gbrain-adapter-test-'))
    })

    afterEach(() => {
      try {
        rmSync(tempRepoPath, {recursive: true})
      } catch {
        // ignore
      }
    })

    it('returns available when gbrain responds', async () => {
      const executor = sinon.stub().resolves({chunk_count: 50, page_count: 10})
      const adapter = new GBrainAdapter({repoPath: tempRepoPath, searchMode: 'hybrid'}, executor)
      const status = await adapter.healthCheck()
      expect(status.available).to.be.true
    })

    it('returns unavailable when gbrain fails', async () => {
      const executor = sinon.stub().rejects(new Error('Command failed'))
      const adapter = new GBrainAdapter({repoPath: tempRepoPath, searchMode: 'hybrid'}, executor)
      const status = await adapter.healthCheck()
      expect(status.available).to.be.false
      expect(status.error).to.include('Command failed')
    })

    it('returns unavailable when repo path does not exist', async () => {
      const executor = sinon.stub().resolves({page_count: 1})
      const adapter = new GBrainAdapter({repoPath: '/nonexistent/gbrain/repo', searchMode: 'hybrid'}, executor)
      const status = await adapter.healthCheck()
      expect(status.available).to.be.false
      expect(status.error).to.include('GBrain repo not found')
      expect(executor.called).to.be.false
    })
  })

  describe('store()', () => {
    it('calls put_page with derived slug', async () => {
      const {adapter, executor} = createTestAdapter({chunks: 1, slug: 'concept/test', status: 'created_or_updated'})
      const result = await adapter.store({
        content: '# Test Topic\nSome content about testing.',
        metadata: {source: 'agent', timestamp: Date.now()},
      })

      expect(executor.calledOnce).to.be.true
      const [operation, params] = executor.firstCall.args
      expect(operation).to.equal('put_page')
      expect(params.slug).to.be.a('string')
      expect(params.content).to.include('Test Topic')
      expect(result.success).to.be.true
      expect(result.provider).to.equal('gbrain')
    })
  })

  describe('estimateCost()', () => {
    it('returns small cost for hybrid mode', () => {
      const {adapter} = createTestAdapter()
      const cost = adapter.estimateCost({query: 'test'})
      expect(cost.estimatedCostCents).to.be.greaterThan(0)
      expect(cost.estimatedLatencyMs).to.be.a('number')
    })

    it('returns zero cost for keyword mode', () => {
      const {adapter} = createTestAdapter([], {searchMode: 'keyword'})
      const cost = adapter.estimateCost({query: 'test'})
      expect(cost.estimatedCostCents).to.equal(0)
    })
  })
})
