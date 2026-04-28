/**
 * Phase 5 round-trip integration test (PHASE-5-IMPLEMENTATION.md §2 #8).
 *
 * Drives the full LLM-free pipeline end-to-end on the daemon-side executors:
 *
 *   1. brv_search "query" with fingerprint   → status: 'no_results' OR 'needs_synthesis'
 *   2. brv_gather "query"                    → context bundle (no LLM)
 *   3. (agent synthesizes locally)
 *   4. brv_record_answer({query, answer, fp})→ {recorded: true, fingerprint: fp}
 *   5. brv_search "query" with same fp       → tier: 0, status: 'cached_answer'
 *
 * Bypasses the MCP transport layer: instantiates the real executors with a
 * shared QueryResultCache and asserts the cache loop closes correctly. This
 * is the regression net Codex flagged in F7 — unit tests alone don't catch
 * cache-instance mismatches between dispatch and record-answer paths.
 *
 * If this test breaks, the search→gather→record→cached-search contract is
 * broken — whether by cache-instance forking, fingerprint scope drift, or
 * dispatch-mapper omissions.
 */

import {expect} from 'chai'
import {stub} from 'sinon'

import type {IFileSystem} from '../../../src/agent/core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../src/agent/infra/sandbox/tools-sdk.js'

import {QueryDispatcher, toBrvSearchResult} from '../../../src/server/infra/dispatcher/query-dispatcher.js'
import {GatherExecutor} from '../../../src/server/infra/executor/gather-executor.js'
import {QueryResultCache} from '../../../src/server/infra/executor/query-result-cache.js'
import {RecordAnswerExecutor} from '../../../src/server/infra/executor/record-answer-executor.js'

const QUERY = 'how does authentication work'
const FINGERPRINT = 'integration-fp-001'
const SYNTHESIZED_ANSWER = 'Auth uses JWTs with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts.'

function makeSearchService(result: SearchKnowledgeResult): ISearchKnowledgeService {
  return {search: stub().resolves(result)} as unknown as ISearchKnowledgeService
}

function makeFileSystem(): IFileSystem {
  return {
    readFile: stub().resolves({content: 'doc body', encoding: 'utf8'}),
  } as unknown as IFileSystem
}

function makeResults(scores: number[]): SearchKnowledgeResult {
  const results = scores.map((score, i) => ({
    excerpt: `excerpt ${i}`,
    path: `topics/doc-${i}.md`,
    score,
    title: `Doc ${i}`,
  }))
  return {message: '', results, totalFound: results.length}
}

describe('Phase 5 round-trip — search → gather → record → cached-search', () => {
  it('agent synthesizes after needs_synthesis, records answer, and re-search hits tier 0', async () => {
     
    // Daemon-side singletons (mirrors how agent-process.ts wires them — one
    // cache shared between dispatcher + record-answer; if this fork were ever
    // re-introduced, F7 would catch it).
    const cache = new QueryResultCache()
    const searchService = makeSearchService(makeResults([0.3, 0.25, 0.2])) // low-score → needs_synthesis
    const fileSystem = makeFileSystem()

    const dispatcher = new QueryDispatcher({cache, fileSystem, searchService})
    const gatherExecutor = new GatherExecutor({searchService})
    const recordAnswerExecutor = new RecordAnswerExecutor({cache})

    // Step 1: agent calls brv_search — no cache entry yet, low scores → needs_synthesis
    const search1 = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})
    const search1Public = toBrvSearchResult(search1)

    expect(search1Public.status).to.equal('needs_synthesis')
    expect(search1Public.tier).to.equal(2)
    expect(search1Public.fingerprint).to.equal(FINGERPRINT)
    expect(search1Public.passages).to.have.length(3)

    // Step 2: agent calls brv_gather to assemble a context bundle (no LLM)
    const gather = await gatherExecutor.execute({query: QUERY})

    // Bundle is for human/agent inspection. Even with low scores, search_metadata reflects what was found.
    expect(gather.search_metadata.result_count).to.equal(3)
    expect(gather.search_metadata.top_score).to.be.closeTo(0.3, 0.01)

    // Step 3: agent runs its own LLM with the bundle (simulated — we just have an answer string)
    // No daemon involvement here.

    // Step 4: agent calls brv_record_answer to close the cache loop
    const record = await recordAnswerExecutor.execute({
      answer: SYNTHESIZED_ANSWER,
      fingerprint: FINGERPRINT,
      query: QUERY,
    })

    expect(record.recorded).to.equal(true)
    expect(record.fingerprint).to.equal(FINGERPRINT)

    // Step 5: agent calls brv_search again with the same query+fingerprint — tier 0 hit
    const search2 = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})
    const search2Public = toBrvSearchResult(search2)

    expect(search2Public.status).to.equal('cached_answer')
    expect(search2Public.tier).to.equal(0)
    expect(search2Public.cached_answer).to.equal(SYNTHESIZED_ANSWER)
    expect(search2Public.fingerprint).to.equal(FINGERPRINT)
     
  })

  it('fuzzy-similar query hits tier 1 after recording (proves Jaccard fallback works for the loop)', async () => {
     
    const cache = new QueryResultCache()
    const dispatcher = new QueryDispatcher({
      cache,
      fileSystem: makeFileSystem(),
      searchService: makeSearchService(makeResults([0.3])),
    })
    const recordAnswerExecutor = new RecordAnswerExecutor({cache})

    // Record answer for the original query
    await recordAnswerExecutor.execute({
      answer: SYNTHESIZED_ANSWER,
      fingerprint: FINGERPRINT,
      query: 'authentication security guide overview',
    })

    // Different query, but high token overlap (Jaccard >= threshold)
    const search = await dispatcher.dispatch({
      fingerprint: FINGERPRINT,
      query: 'authentication security guide detailed',
    })
    const publicResult = toBrvSearchResult(search)

    expect(publicResult.status).to.equal('cached_answer')
    expect(publicResult.tier).to.equal(1)
    expect(publicResult.cached_answer).to.equal(SYNTHESIZED_ANSWER)
     
  })

  it('different fingerprint after recording → cache miss (fingerprint isolation holds across the loop)', async () => {
    const cache = new QueryResultCache()
    const dispatcher = new QueryDispatcher({
      cache,
      fileSystem: makeFileSystem(),
      searchService: makeSearchService(makeResults([])),
    })
    const recordAnswerExecutor = new RecordAnswerExecutor({cache})

    await recordAnswerExecutor.execute({
      answer: SYNTHESIZED_ANSWER,
      fingerprint: FINGERPRINT,
      query: QUERY,
    })

    // Different fingerprint — cache key changes; the prior entry is invisible
    const search = await dispatcher.dispatch({fingerprint: 'different-fp', query: QUERY})
    const publicResult = toBrvSearchResult(search)

    expect(publicResult.status).to.equal('no_results')
    expect(publicResult.tier).to.equal(2)
  })

  it('record-answer is graceful when cache is disabled (no daemon error)', async () => {
    // Daemon started without cache (enableCache: false on QueryExecutor)
    const dispatcher = new QueryDispatcher({
      fileSystem: makeFileSystem(),
      searchService: makeSearchService(makeResults([])),
    })
    // RecordAnswerExecutor without cache must still resolve, just with recorded: false
    const recordAnswerExecutor = new RecordAnswerExecutor({})

    const record = await recordAnswerExecutor.execute({
      answer: SYNTHESIZED_ANSWER,
      fingerprint: FINGERPRINT,
      query: QUERY,
    })
    expect(record.recorded).to.equal(false)

    // Subsequent search still works (no cache, no error)
    const search = await dispatcher.dispatch({fingerprint: FINGERPRINT, query: QUERY})
    const publicResult = toBrvSearchResult(search)
    expect(publicResult.status).to.equal('no_results')
  })
})
