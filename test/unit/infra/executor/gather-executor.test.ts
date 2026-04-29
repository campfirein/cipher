/**
 * GatherExecutor tests (Phase 5 Task 5.3).
 *
 * GatherExecutor is the daemon-side handler for both `brv_gather` MCP and
 * `brv gather` CLI. It assembles a context bundle from BM25 + manifest with
 * NO LLM call. The agent (or human) synthesizes the answer from the bundle.
 *
 * Critical invariants (per DESIGN §6.2):
 *   - Never invokes the LLM. Stub agent must remain untouched.
 *   - Returns {prefetched_context, manifest_context?, total_tokens_estimated,
 *     search_metadata, follow_up_hints?}
 *   - follow_up_hints fire on low-result-count or low-top-score conditions
 *   - Token budget caps the bundle when set (default 4000 per DESIGN)
 */

import {expect} from 'chai'
import {stub} from 'sinon'

import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

import {GatherExecutor} from '../../../../src/server/infra/executor/gather-executor.js'

const QUERY = 'how does authentication work'

function makeSearchService(result: SearchKnowledgeResult): ISearchKnowledgeService {
  return {search: stub().resolves(result)} as unknown as ISearchKnowledgeService
}

function makeResults(overrides: Partial<SearchKnowledgeResult['results'][0]>[] = []): SearchKnowledgeResult {
  const results = overrides.map((o, i) => ({
    excerpt: `excerpt ${i}`,
    path: `topics/doc-${i}.md`,
    score: 0.9,
    title: `Doc ${i}`,
    ...o,
  }))
  return {message: '', results, totalFound: results.length}
}

describe('GatherExecutor', () => {
  describe('basic bundle assembly', () => {
    it('returns prefetched_context built from high-score results', async () => {
      const searchService = makeSearchService(
        makeResults([
          {excerpt: 'JWT tokens expire after 24h', score: 0.92, title: 'JWT'},
          {excerpt: 'Sessions stored in cookies', score: 0.85, title: 'Sessions'},
        ]),
      )
      const executor = new GatherExecutor({searchService})

      const result = await executor.execute({query: QUERY})

      expect(result.prefetched_context).to.be.a('string')
      expect(result.prefetched_context).to.include('JWT')
      expect(result.prefetched_context).to.include('Sessions')
    })

    it('returns search_metadata with result_count, top_score, total_found', async () => {
      const searchService = makeSearchService(
        makeResults([
          {score: 0.95},
          {score: 0.7},
          {score: 0.6},
        ]),
      )
      const executor = new GatherExecutor({searchService})

      const result = await executor.execute({query: QUERY})

      expect(result.search_metadata.result_count).to.equal(3)
      expect(result.search_metadata.top_score).to.equal(0.95)
      expect(result.search_metadata.total_found).to.equal(3)
    })

    it('returns total_tokens_estimated >= 0', async () => {
      const executor = new GatherExecutor({
        searchService: makeSearchService(makeResults([{excerpt: 'long body '.repeat(50), score: 0.9}])),
      })

      const result = await executor.execute({query: QUERY})

      expect(result.total_tokens_estimated).to.be.a('number').and.at.least(0)
    })

    it('returns no prefetched_context when no high-confidence results (all below threshold)', async () => {
      const searchService = makeSearchService(makeResults([{score: 0.3}, {score: 0.2}]))
      const executor = new GatherExecutor({searchService})

      const result = await executor.execute({query: QUERY})

      expect(result.prefetched_context).to.equal('')
      expect(result.search_metadata.result_count).to.equal(2)
    })

    it('handles empty BM25 results', async () => {
      const executor = new GatherExecutor({searchService: makeSearchService(makeResults([]))})

      const result = await executor.execute({query: QUERY})

      expect(result.prefetched_context).to.equal('')
      expect(result.search_metadata.result_count).to.equal(0)
      expect(result.search_metadata.total_found).to.equal(0)
    })

    it('handles searchService throwing — degrades to empty bundle', async () => {
      const searchService = {search: stub().rejects(new Error('BM25 down'))} as unknown as ISearchKnowledgeService
      const executor = new GatherExecutor({searchService})

      const result = await executor.execute({query: QUERY})

      expect(result.prefetched_context).to.equal('')
      expect(result.search_metadata.result_count).to.equal(0)
    })
  })

  describe('follow_up_hints', () => {
    it('emits a hint when result count is below threshold (≤2 results)', async () => {
      const executor = new GatherExecutor({searchService: makeSearchService(makeResults([{score: 0.95}]))})

      const result = await executor.execute({query: QUERY})

      expect(result.follow_up_hints).to.be.an('array').and.not.empty
      const joined = result.follow_up_hints!.join(' ')
      expect(joined.toLowerCase()).to.match(/few|expand|broaden|refine/)
    })

    it('emits a hint when top score is below 0.5 (low confidence)', async () => {
      const executor = new GatherExecutor({
        searchService: makeSearchService(makeResults([{score: 0.3}, {score: 0.25}, {score: 0.2}])),
      })

      const result = await executor.execute({query: QUERY})

      expect(result.follow_up_hints).to.be.an('array').and.not.empty
      const joined = result.follow_up_hints!.join(' ')
      expect(joined.toLowerCase()).to.match(/score|low confidence|rephras/)
    })

    it('emits no hints when results are abundant and high-confidence', async () => {
      const executor = new GatherExecutor({
        searchService: makeSearchService(
          makeResults([
            {score: 0.95},
            {score: 0.9},
            {score: 0.88},
            {score: 0.85},
            {score: 0.82},
          ]),
        ),
      })

      const result = await executor.execute({query: QUERY})

      // Either undefined (no hints) or empty array
      const hints = result.follow_up_hints ?? []
      expect(hints).to.have.length(0)
    })
  })

  describe('does not invoke LLM (DESIGN §4.2 invariant)', () => {
    it('GatherExecutor has no agent dependency — depends only on searchService', () => {
      // Compile-time + structural check: constructor accepts only {searchService}
      // (no agent, no taskSession). Future enhancement may add IFileSystem +
      // baseDirectory for manifest snippets — must NEVER add ICipherAgent.
      const executor = new GatherExecutor({searchService: makeSearchService(makeResults([]))})
      expect(executor).to.be.instanceOf(GatherExecutor)
    })
  })

  describe('input validation', () => {
    it('returns empty bundle when query is empty/whitespace', async () => {
      const executor = new GatherExecutor({searchService: makeSearchService(makeResults([{score: 0.95}]))})

      const result = await executor.execute({query: '   '})

      expect(result.search_metadata.result_count).to.equal(0)
      expect(result.prefetched_context).to.equal('')
    })

    it('passes scope to searchService when provided', async () => {
      const searchStub = stub().resolves(makeResults([]))
      const searchService = {search: searchStub} as unknown as ISearchKnowledgeService
      const executor = new GatherExecutor({searchService})

      await executor.execute({query: QUERY, scope: 'src/auth'})

      expect(searchStub.firstCall.args[1]).to.deep.include({scope: 'src/auth'})
    })

    it('caps limit at the SMART_ROUTING_MAX_DOCS default when not provided', async () => {
      const searchStub = stub().resolves(makeResults([]))
      const searchService = {search: searchStub} as unknown as ISearchKnowledgeService
      const executor = new GatherExecutor({searchService})

      await executor.execute({query: QUERY})

      const passedLimit = (searchStub.firstCall.args[1] as {limit?: number}).limit
      expect(passedLimit).to.be.a('number').and.at.most(50)
    })
  })
})
