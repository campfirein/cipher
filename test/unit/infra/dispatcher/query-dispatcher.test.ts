/**
 * QueryDispatcher tests (Phase 5 Task 5.1).
 *
 * The dispatcher owns tier 0/1/2 logic extracted from QueryExecutor so both
 * brv_query (legacy CLI / MCP) and brv_search (new MCP) can consume the same
 * deterministic, LLM-free path.
 *
 * Contract — discriminated union:
 *   tier 0 / 1 → status: 'cached_answer'  (cachedAnswer field)
 *   tier 2     → status: 'direct_passages' (passages + directAnswer fields)
 *              | 'needs_synthesis'         (passages field; agent synthesizes)
 *              | 'no_results'              (empty passages)
 *
 * Critical invariant: dispatcher writes to cache ONLY on direct_passages.
 * The legacy not-found cache write (formatNotFoundResponse) stays in the
 * executor — it's a human-facing response shape, not the dispatcher's concern.
 */

import {expect} from 'chai'
import {stub} from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

import {QueryDispatcher, toBrvSearchResult} from '../../../../src/server/infra/dispatcher/query-dispatcher.js'
import {QueryResultCache} from '../../../../src/server/infra/executor/query-result-cache.js'

const FINGERPRINT = 'fp-test-001'
const QUERY = 'how does authentication work'

function makeSearchService(result: SearchKnowledgeResult): ISearchKnowledgeService {
  return {search: stub().resolves(result)} as unknown as ISearchKnowledgeService
}

function makeFileSystem(content = '# Auth\n\nFull document content.'): IFileSystem {
  return {
    readFile: stub().resolves({content, encoding: 'utf8'}),
  } as unknown as IFileSystem
}

function makeResults(overrides: Partial<SearchKnowledgeResult['results'][0]>[] = []): SearchKnowledgeResult {
  const results = overrides.map((o, i) => ({
    excerpt: 'excerpt',
    path: `topics/doc-${i}.md`,
    score: 0.9,
    title: `Doc ${i}`,
    ...o,
  }))
  return {message: '', results, totalFound: results.length}
}

describe('QueryDispatcher', () => {
  describe('Tier 0: exact cache hit', () => {
    it('returns tier 0 cached_answer when cache.get hits', async () => {
      const cache = new QueryResultCache()
      cache.set(QUERY, 'cached response', FINGERPRINT)
      const dispatcher = new QueryDispatcher({cache})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(0)
      expect(result.status).to.equal('cached_answer')
      if (result.status !== 'cached_answer') throw new Error('narrowing')
      expect(result.cachedAnswer).to.equal('cached response')
      expect(result.totalFound).to.equal(0)
      expect(result.timingMs).to.be.at.least(0)
    })

    it('skips Tier 0 when fingerprint missing (no key to look up)', async () => {
      const cache = new QueryResultCache()
      cache.set(QUERY, 'cached', FINGERPRINT)
      const searchService = makeSearchService(makeResults([]))
      const dispatcher = new QueryDispatcher({cache, searchService})

      const result = await dispatcher.dispatch({query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('no_results')
    })

    it('skips Tier 0 when no cache configured', async () => {
      const searchService = makeSearchService(makeResults([]))
      const dispatcher = new QueryDispatcher({searchService})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('no_results')
    })
  })

  describe('Tier 1: fuzzy cache hit', () => {
    it('returns tier 1 cached_answer when fuzzy match hits after exact miss', async () => {
      const cache = new QueryResultCache()
      cache.set('authentication security guide overview', 'fuzzy cached response', FINGERPRINT)
      const dispatcher = new QueryDispatcher({cache})

      // Different query, but high token overlap (Jaccard >= threshold)
      const result = await dispatcher.dispatch({
        fingerprint: FINGERPRINT,
        query: 'authentication security guide detailed',
      })

      expect(result.tier).to.equal(1)
      expect(result.status).to.equal('cached_answer')
      if (result.status !== 'cached_answer') throw new Error('narrowing')
      expect(result.cachedAnswer).to.equal('fuzzy cached response')
    })
  })

  describe('Tier 2: BM25 search', () => {
    it('returns no_results when BM25 returns empty', async () => {
      const searchService = makeSearchService(makeResults([]))
      const dispatcher = new QueryDispatcher({searchService})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('no_results')
      if (result.status !== 'no_results') throw new Error('narrowing')
      expect(result.passages).to.deep.equal([])
      expect(result.totalFound).to.equal(0)
    })

    it('returns direct_passages when high-confidence direct response succeeds', async () => {
      // Two results: one very high (0.95), second much lower (0.4) → dominant gap
      const searchResult = makeResults([{score: 0.95}, {score: 0.4}])
      const searchService = makeSearchService(searchResult)
      const fileSystem = makeFileSystem()
      const dispatcher = new QueryDispatcher({fileSystem, searchService})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('direct_passages')
      if (result.status !== 'direct_passages') throw new Error('narrowing')
      expect(result.directAnswer).to.be.a('string').and.not.empty
      expect(result.passages).to.have.length(2)
      expect(result.totalFound).to.equal(2)
    })

    it('returns needs_synthesis when BM25 has results but no direct response (low scores)', async () => {
      // All results below direct-response score threshold (0.85)
      const searchResult = makeResults([{score: 0.3}, {score: 0.25}, {score: 0.2}])
      const searchService = makeSearchService(searchResult)
      const fileSystem = makeFileSystem()
      const dispatcher = new QueryDispatcher({fileSystem, searchService})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('needs_synthesis')
      if (result.status !== 'needs_synthesis') throw new Error('narrowing')
      expect(result.passages).to.have.length(3)
      expect(result.totalFound).to.equal(3)
    })

    it('writes to cache on direct_passages', async () => {
      const cache = new QueryResultCache()
      const setSpy = stub(cache, 'set').callThrough()
      const searchResult = makeResults([{score: 0.95}, {score: 0.4}])
      const dispatcher = new QueryDispatcher({
        cache,
        fileSystem: makeFileSystem(),
        searchService: makeSearchService(searchResult),
      })

      await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(setSpy.calledOnce).to.equal(true)
      expect(setSpy.firstCall.args[0]).to.equal(QUERY)
      expect(setSpy.firstCall.args[2]).to.equal(FINGERPRINT)
    })

    it('does NOT write to cache on needs_synthesis', async () => {
      const cache = new QueryResultCache()
      const setSpy = stub(cache, 'set').callThrough()
      const searchResult = makeResults([{score: 0.3}, {score: 0.2}, {score: 0.1}])
      const dispatcher = new QueryDispatcher({
        cache,
        fileSystem: makeFileSystem(),
        searchService: makeSearchService(searchResult),
      })

      await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(setSpy.called).to.equal(false)
    })

    it('does NOT write to cache on no_results', async () => {
      const cache = new QueryResultCache()
      const setSpy = stub(cache, 'set').callThrough()
      const dispatcher = new QueryDispatcher({
        cache,
        searchService: makeSearchService(makeResults([])),
      })

      await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(setSpy.called).to.equal(false)
    })

    it('returns no_results when searchService throws (graceful degradation)', async () => {
      const searchService = {search: stub().rejects(new Error('search down'))} as unknown as ISearchKnowledgeService
      const dispatcher = new QueryDispatcher({searchService})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('no_results')
    })

    it('returns no_results when no searchService configured', async () => {
      const dispatcher = new QueryDispatcher({})

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('no_results')
    })
  })

  describe('Passage shape', () => {
    it('exposes only {path, excerpt, score} — strips internal SearchKnowledgeResult fields', async () => {
      const searchResult = makeResults([{excerpt: 'foo', path: 'p.md', score: 0.5, title: 'Title'}])
      const dispatcher = new QueryDispatcher({
        fileSystem: makeFileSystem(),
        searchService: makeSearchService(searchResult),
      })

      const result = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      if (result.status !== 'needs_synthesis') throw new Error(`expected needs_synthesis, got ${result.status}`)
      expect(result.passages).to.have.length(1)
      const passage = result.passages[0]
      expect(Object.keys(passage).sort()).to.deep.equal(['excerpt', 'path', 'score'])
      expect(passage.path).to.equal('p.md')
      expect(passage.excerpt).to.equal('foo')
      expect(passage.score).to.equal(0.5)
    })
  })

  describe('Pre-computed searchPromise (parallel-search optimization)', () => {
    it('uses caller-supplied searchPromise instead of calling searchService.search', async () => {
      const searchService = {search: stub().rejects(new Error('should not be called'))} as unknown as ISearchKnowledgeService
      const dispatcher = new QueryDispatcher({searchService})

      const preComputed = Promise.resolve(makeResults([{score: 0.3}]))
      const result = await dispatcher.dispatch({
        fingerprint: FINGERPRINT,
        query: QUERY,
        searchPromise: preComputed,
      })

      expect(result.tier).to.equal(2)
      expect(result.status).to.equal('needs_synthesis')
      // Stub's .called would have raised if dispatcher had called search()
      // (the rejection would've propagated as no_results — assert needs_synthesis instead)
    })
  })

   
  describe('toBrvSearchResult — public DTO mapping (PHASE-5-CODE-REVIEW.md F4)', () => {
    it('maps cached_answer (tier 0/1) to snake_case + drops internal fields', async () => {
      const cache = new QueryResultCache()
      cache.set(QUERY, 'cached response', FINGERPRINT)
      const dispatcher = new QueryDispatcher({cache})
      const dispatchResult = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      const dto = toBrvSearchResult(dispatchResult)

      expect(dto.tier).to.equal(0)
      expect(dto.status).to.equal('cached_answer')
      expect(dto.cached_answer).to.equal('cached response')
      expect(dto.fingerprint).to.equal(FINGERPRINT)
      expect(dto).to.have.property('total_found', 0)
      expect(dto).to.have.property('timing_ms').that.is.a('number')
      // Public DTO must NOT contain internal camelCase fields
      expect(dto).to.not.have.property('cachedAnswer')
      expect(dto).to.not.have.property('totalFound')
      expect(dto).to.not.have.property('timingMs')
      expect(dto).to.not.have.property('searchResult')
    })

    it('maps direct_passages: passages exposed; internal searchResult and directAnswer dropped', async () => {
      const dispatcher = new QueryDispatcher({
        fileSystem: makeFileSystem(),
        searchService: makeSearchService(makeResults([{score: 0.95}, {score: 0.4}])),
      })
      const dispatchResult = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      const dto = toBrvSearchResult(dispatchResult)

      expect(dto.tier).to.equal(2)
      expect(dto.status).to.equal('direct_passages')
      expect(dto.passages).to.have.length(2)
      // directAnswer was the legacy formatter output — NOT in DESIGN §6.1
      expect(dto).to.not.have.property('direct_answer')
      expect(dto).to.not.have.property('directAnswer')
      expect(dto).to.not.have.property('searchResult')
      expect(dto.total_found).to.equal(2)
    })

    it('maps needs_synthesis: passages exposed; internal searchResult dropped', async () => {
      const dispatcher = new QueryDispatcher({
        fileSystem: makeFileSystem(),
        searchService: makeSearchService(makeResults([{score: 0.3}, {score: 0.2}, {score: 0.1}])),
      })
      const dispatchResult = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      const dto = toBrvSearchResult(dispatchResult)

      expect(dto.status).to.equal('needs_synthesis')
      expect(dto.passages).to.have.length(3)
      expect(dto).to.not.have.property('searchResult')
    })

    it('maps no_results: empty passages, no cached_answer', async () => {
      const dispatcher = new QueryDispatcher({searchService: makeSearchService(makeResults([]))})
      const dispatchResult = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})

      const dto = toBrvSearchResult(dispatchResult)

      expect(dto.status).to.equal('no_results')
      expect(dto.passages).to.deep.equal([])
      expect(dto.cached_answer).to.be.undefined
    })

    it('omits fingerprint key when undefined (DESIGN §6.1 documents it as always-present, but graceful when caching disabled)', async () => {
      const dispatcher = new QueryDispatcher({searchService: makeSearchService(makeResults([{score: 0.3}]))})
      const dispatchResult = await dispatcher.dispatch({query: QUERY})

      const dto = toBrvSearchResult(dispatchResult)

      expect(dto.fingerprint).to.be.undefined
    })
  })
   
})
