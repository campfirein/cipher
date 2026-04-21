import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {QueryLogEntry} from '../../../../src/server/core/domain/entities/query-log-entry.js'
import type {IQueryLogStore} from '../../../../src/server/core/interfaces/storage/i-query-log-store.js'

import {QueryLogSummaryUseCase} from '../../../../src/server/infra/usecase/query-log-summary-use-case.js'

// ============================================================================
// Test harness
// ============================================================================

type MockTerminal = {log: SinonStub}
type MockStore = IQueryLogStore & {
  getById: SinonStub
  getNextId: SinonStub
  list: SinonStub
  save: SinonStub
}

function makeStore(sandbox: SinonSandbox, entries: QueryLogEntry[] = []): MockStore {
  return {
    getById: sandbox.stub().resolves(),
    getNextId: sandbox.stub().resolves('qry-9999'),
    list: sandbox.stub().resolves(entries),
    save: sandbox.stub().resolves(),
  }
}

function makeUseCase(
  sandbox: SinonSandbox,
  entries: QueryLogEntry[] = [],
): {store: MockStore; terminal: MockTerminal; useCase: QueryLogSummaryUseCase} {
  const store = makeStore(sandbox, entries)
  const terminal: MockTerminal = {log: sandbox.stub()}
  const useCase = new QueryLogSummaryUseCase({queryLogStore: store, terminal})
  return {store, terminal, useCase}
}

function loggedOutput(terminal: MockTerminal): string {
  return terminal.log
    .getCalls()
    .map((c) => String(c.args[0] ?? ''))
    .join('\n')
}

// ── Entity factories ────────────────────────────────────────────────────────

type CompletedEntry = Extract<QueryLogEntry, {status: 'completed'}>
type ErrorEntry = Extract<QueryLogEntry, {status: 'error'}>
type CancelledEntry = Extract<QueryLogEntry, {status: 'cancelled'}>
type ProcessingEntry = Extract<QueryLogEntry, {status: 'processing'}>

const T0 = 1_700_000_000_000

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `qry-${T0 + idCounter}`
}

function makeCompleted(overrides: Partial<CompletedEntry> = {}): CompletedEntry {
  return {
    completedAt: T0 + 100,
    id: nextId(),
    matchedDocs: [],
    query: 'how is auth implemented?',
    response: 'answer',
    startedAt: T0,
    status: 'completed',
    taskId: 'task-1',
    tier: 0,
    timing: {durationMs: 100},
    ...overrides,
  }
}

function makeError(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    completedAt: T0 + 50,
    error: 'boom',
    id: nextId(),
    matchedDocs: [],
    query: 'failing query',
    startedAt: T0,
    status: 'error',
    taskId: 'task-1',
    timing: {durationMs: 50},
    ...overrides,
  }
}

function makeCancelled(overrides: Partial<CancelledEntry> = {}): CancelledEntry {
  return {
    completedAt: T0 + 10,
    id: nextId(),
    matchedDocs: [],
    query: 'cancelled query',
    startedAt: T0,
    status: 'cancelled',
    taskId: 'task-1',
    ...overrides,
  }
}

function makeProcessing(overrides: Partial<ProcessingEntry> = {}): ProcessingEntry {
  return {
    id: nextId(),
    matchedDocs: [],
    query: 'in-flight query',
    startedAt: T0,
    status: 'processing',
    taskId: 'task-1',
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('QueryLogSummaryUseCase', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
    idCounter = 0
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ── 1. Empty entries ──────────────────────────────────────────────────────
  describe('empty entries', () => {
    it('returns a zero summary for json format with no entries', async () => {
      const {terminal, useCase} = makeUseCase(sandbox, [])

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.totalQueries).to.equal(0)
      expect(parsed.byStatus).to.deep.equal({cancelled: 0, completed: 0, error: 0})
      expect(parsed.byTier).to.deep.equal({tier0: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, unknown: 0})
      expect(parsed.cacheHitRate).to.equal(0)
      expect(parsed.coverageRate).to.equal(0)
      expect(parsed.responseTime).to.deep.equal({avgMs: 0, p50Ms: 0, p95Ms: 0})
      expect(parsed.topTopics).to.deep.equal([])
      expect(parsed.topRecalledDocs).to.deep.equal([])
      expect(parsed.knowledgeGaps).to.deep.equal([])
      expect(parsed.totalMatchedDocs).to.equal(0)
      expect(parsed.queriesWithoutMatches).to.equal(0)
    })
  })

  // ── 2-4, 17. Tier counts and cache hit rate ───────────────────────────────
  describe('byTier and cacheHitRate', () => {
    it('single completed tier-0 entry yields cacheHitRate = 1.0', async () => {
      const {terminal, useCase} = makeUseCase(sandbox, [makeCompleted({tier: 0})])

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.cacheHitRate).to.equal(1)
      expect(parsed.byTier.tier0).to.equal(1)
    })

    it('counts byTier across mixed completed entries', async () => {
      const entries = [
        makeCompleted({tier: 0}),
        makeCompleted({tier: 1}),
        makeCompleted({tier: 1}),
        makeCompleted({tier: 2}),
        makeCompleted({tier: 3}),
        makeCompleted({tier: 4}),
        makeCompleted({tier: undefined}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.byTier).to.deep.equal({
        tier0: 1,
        tier1: 2,
        tier2: 1,
        tier3: 1,
        tier4: 1,
        unknown: 1,
      })
    })

    it('cacheHitRate equals (tier0 + tier1) / totalCompleted', async () => {
      const entries = [
        makeCompleted({tier: 0}),
        makeCompleted({tier: 0}),
        makeCompleted({tier: 1}),
        makeCompleted({tier: 2}),
        makeCompleted({tier: 3}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.cacheHitRate).to.be.closeTo(0.6, 1e-9) // 3/5
    })

    it('excludes processing entries from rate calculations and byStatus', async () => {
      const entries = [makeCompleted({tier: 0}), makeCompleted({tier: 1}), makeProcessing(), makeProcessing()]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.totalQueries).to.equal(2)
      expect(parsed.byStatus).to.deep.equal({cancelled: 0, completed: 2, error: 0})
      expect(parsed.cacheHitRate).to.equal(1) // 2/2
    })
  })

  // ── 5-9. Response time percentiles ────────────────────────────────────────
  describe('responseTime percentiles', () => {
    it('computes p50 with odd number of entries', async () => {
      // 5 entries → floor(5*0.5) = index 2
      const entries = [100, 200, 300, 400, 500].map((ms) => makeCompleted({timing: {durationMs: ms}}))
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.responseTime.p50Ms).to.equal(300)
    })

    it('computes p50 with even number of entries', async () => {
      // 4 entries → ceil(4*0.5) - 1 = index 1
      const entries = [100, 200, 300, 400].map((ms) => makeCompleted({timing: {durationMs: ms}}))
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.responseTime.p50Ms).to.equal(200)
    })

    it('computes p95 with 20+ entries', async () => {
      // 20 entries [100..2000] → ceil(20*0.95) - 1 = index 18 → 1900
      const entries = Array.from({length: 20}, (_, i) => makeCompleted({timing: {durationMs: (i + 1) * 100}}))
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.responseTime.p95Ms).to.equal(1900)
    })

    it('with one entry, avg = p50 = p95 = that value', async () => {
      const {terminal, useCase} = makeUseCase(sandbox, [makeCompleted({timing: {durationMs: 750}})])

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.responseTime).to.deep.equal({avgMs: 750, p50Ms: 750, p95Ms: 750})
    })

    it('excludes error and cancelled entries from response time', async () => {
      const entries = [
        makeCompleted({timing: {durationMs: 200}}),
        makeError({timing: {durationMs: 9000}}),
        makeCancelled(),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.responseTime.avgMs).to.equal(200)
      expect(parsed.responseTime.p50Ms).to.equal(200)
    })

    it('excludes entries missing timing from calculation', async () => {
      const entries = [
        makeCompleted({timing: {durationMs: 100}}),
        makeCompleted({timing: undefined}),
        makeCompleted({timing: {durationMs: 300}}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.responseTime.avgMs).to.equal(200) // (100+300)/2
    })
  })

  // ── 10-11. topTopics ──────────────────────────────────────────────────────
  describe('topTopics', () => {
    it('extracts first path segment and counts occurrences', async () => {
      const entries = [
        makeCompleted({
          matchedDocs: [
            {path: 'authentication/oauth_flow.md', score: 0.9, title: 'oauth'},
            {path: 'authentication/token_storage.md', score: 0.8, title: 'tokens'},
          ],
        }),
        makeCompleted({
          matchedDocs: [{path: 'tool_system/registry.md', score: 0.7, title: 'registry'}],
        }),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.topTopics).to.deep.equal([
        {count: 2, topic: 'authentication'},
        {count: 1, topic: 'tool_system'},
      ])
    })

    it('sorts topTopics alphabetically when counts are equal', async () => {
      const entries = [
        makeCompleted({matchedDocs: [{path: 'zebra/a.md', score: 1, title: 'z'}]}),
        makeCompleted({matchedDocs: [{path: 'alpha/a.md', score: 1, title: 'a'}]}),
        makeCompleted({matchedDocs: [{path: 'mango/a.md', score: 1, title: 'm'}]}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      const topics = parsed.topTopics.map((t: {topic: string}) => t.topic)
      expect(topics).to.deep.equal(['alpha', 'mango', 'zebra'])
    })

    it('sorts topTopics by count descending and limits to top 10', async () => {
      const entries = Array.from({length: 12}, (_, i) =>
        makeCompleted({
          matchedDocs: [{path: `topic${i}/file.md`, score: 1, title: 'x'}],
        }),
      )
      // Boost topic5 so we can verify sort order
      entries.push(
        makeCompleted({
          matchedDocs: [
            {path: 'topic5/a.md', score: 1, title: 'a'},
            {path: 'topic5/b.md', score: 1, title: 'b'},
            {path: 'topic5/c.md', score: 1, title: 'c'},
          ],
        }),
      )
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.topTopics).to.have.lengthOf(10)
      expect(parsed.topTopics[0]).to.deep.equal({count: 4, topic: 'topic5'})
    })
  })

  // ── 12-13. coverageRate ───────────────────────────────────────────────────
  describe('coverageRate', () => {
    it('coverageRate = entriesWithMatchedDocs / totalCompleted', async () => {
      const entries = [
        makeCompleted({matchedDocs: [{path: 'a/b.md', score: 1, title: 't'}]}),
        makeCompleted({matchedDocs: [{path: 'a/c.md', score: 1, title: 't'}]}),
        makeCompleted({matchedDocs: []}),
        makeCompleted({matchedDocs: []}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.coverageRate).to.equal(0.5)
      expect(parsed.queriesWithoutMatches).to.equal(2)
    })

    it('coverageRate is 0 when no completed entry has matches', async () => {
      const entries = [makeCompleted({matchedDocs: []}), makeCompleted({matchedDocs: []})]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.coverageRate).to.equal(0)
    })
  })

  // ── 14. Time range filtering forwarded to store ───────────────────────────
  describe('time range filtering', () => {
    it('forwards after/before to store.list', async () => {
      const {store, useCase} = makeUseCase(sandbox, [])

      await useCase.run({after: 1000, before: 2000, format: 'json'})

      expect(store.list.calledOnce).to.be.true
      expect(store.list.firstCall.args[0]).to.deep.include({after: 1000, before: 2000})
    })
  })

  // ── 15. JSON output ───────────────────────────────────────────────────────
  describe('json output', () => {
    it('includes all numeric metric fields', async () => {
      const entries = [
        makeCompleted({
          matchedDocs: [{path: 'a/b.md', score: 1, title: 't'}],
          tier: 0,
          timing: {durationMs: 200},
        }),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed).to.have.all.keys([
        'byStatus',
        'byTier',
        'cacheHitRate',
        'coverageRate',
        'knowledgeGaps',
        'period',
        'queriesWithoutMatches',
        'responseTime',
        'topRecalledDocs',
        'topTopics',
        'totalMatchedDocs',
        'totalQueries',
      ])
    })
  })

  // ── 16. Text output sections ──────────────────────────────────────────────
  describe('text output', () => {
    it('includes all sections for a populated summary', async () => {
      const entries = [
        makeCompleted({
          matchedDocs: [{path: 'authentication/oauth.md', score: 1, title: 'oauth'}],
          query: 'how does deployment pipeline work',
          tier: 0,
          timing: {durationMs: 1200},
        }),
        makeCompleted({matchedDocs: [], query: 'rate limiting strategy'}),
        makeError({}),
        makeCancelled({}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'text'})

      const out = loggedOutput(terminal)
      expect(out).to.include('Query Recall Summary')
      expect(out).to.include('Total queries:')
      expect(out).to.include('Cache hit rate:')
      expect(out).to.include('Tier 0 (exact)')
      expect(out).to.include('Response time:')
      expect(out).to.include('Knowledge coverage:')
      expect(out).to.include('Top queried topics:')
      expect(out).to.include('Top recalled documents:')
      expect(out).to.include('Knowledge gaps')
      expect(out).to.include("Run 'brv curate'")
    })
  })

  // ── 18-20. topRecalledDocs ────────────────────────────────────────────────
  describe('topRecalledDocs', () => {
    it('tracks full doc paths, not just first segment', async () => {
      const entries = [
        makeCompleted({
          matchedDocs: [
            {path: 'authentication/oauth_flow.md', score: 1, title: 't'},
            {path: 'authentication/token_storage.md', score: 1, title: 't'},
          ],
        }),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.topRecalledDocs).to.deep.equal([
        {count: 1, path: 'authentication/oauth_flow.md'},
        {count: 1, path: 'authentication/token_storage.md'},
      ])
    })

    it('sorts by count descending and limits to top 10', async () => {
      const entries = Array.from({length: 12}, (_, i) =>
        makeCompleted({
          matchedDocs: [{path: `topic/doc${i}.md`, score: 1, title: 't'}],
        }),
      )
      // Boost doc5
      entries.push(
        makeCompleted({matchedDocs: [{path: 'topic/doc5.md', score: 1, title: 't'}]}),
        makeCompleted({matchedDocs: [{path: 'topic/doc5.md', score: 1, title: 't'}]}),
      )
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.topRecalledDocs).to.have.lengthOf(10)
      expect(parsed.topRecalledDocs[0]).to.deep.equal({count: 3, path: 'topic/doc5.md'})
    })

    it('deduplicates the same path across multiple entries', async () => {
      const sharedPath = 'authentication/oauth_flow.md'
      const entries = [
        makeCompleted({matchedDocs: [{path: sharedPath, score: 1, title: 't'}]}),
        makeCompleted({matchedDocs: [{path: sharedPath, score: 1, title: 't'}]}),
        makeCompleted({matchedDocs: [{path: sharedPath, score: 1, title: 't'}]}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.topRecalledDocs).to.have.lengthOf(1)
      expect(parsed.topRecalledDocs[0]).to.deep.equal({count: 3, path: sharedPath})
    })
  })

  // ── 21-25. knowledgeGaps ──────────────────────────────────────────────────
  describe('knowledgeGaps', () => {
    it('filters completed entries with zero matched docs', async () => {
      const entries = [
        makeCompleted({matchedDocs: [], query: 'deployment pipeline question'}),
        makeCompleted({
          matchedDocs: [{path: 'a/b.md', score: 1, title: 't'}],
          query: 'auth question',
        }),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      const topics = parsed.knowledgeGaps.map((g: {topic: string}) => g.topic)
      expect(topics).to.include('deployment')
      expect(topics).to.not.include('auth')
    })

    it('extracts keywords and groups by frequency', async () => {
      const entries = [
        makeCompleted({matchedDocs: [], query: 'deployment pipeline'}),
        makeCompleted({matchedDocs: [], query: 'deployment scripts'}),
        makeCompleted({matchedDocs: [], query: 'deployment workflow'}),
        makeCompleted({matchedDocs: [], query: 'rate limiting'}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      const top = parsed.knowledgeGaps[0]
      expect(top.topic).to.equal('deployment')
      expect(top.count).to.equal(3)
    })

    it('caps exampleQueries at 3 per topic', async () => {
      const entries = [
        makeCompleted({matchedDocs: [], query: 'deployment one'}),
        makeCompleted({matchedDocs: [], query: 'deployment two'}),
        makeCompleted({matchedDocs: [], query: 'deployment three'}),
        makeCompleted({matchedDocs: [], query: 'deployment four'}),
        makeCompleted({matchedDocs: [], query: 'deployment five'}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      const top = parsed.knowledgeGaps.find((g: {topic: string}) => g.topic === 'deployment')
      expect(top.exampleQueries).to.have.lengthOf(3)
    })

    it('excludes error and cancelled entries from gaps', async () => {
      const entries = [
        makeError({matchedDocs: [], query: 'errored deployment'}),
        makeCancelled({matchedDocs: [], query: 'cancelled deployment'}),
        makeCompleted({
          matchedDocs: [{path: 'a/b.md', score: 1, title: 't'}],
          query: 'covered question',
        }),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.knowledgeGaps).to.deep.equal([])
    })

    it('returns empty array when there are no gaps', async () => {
      const entries = [
        makeCompleted({matchedDocs: [{path: 'a/b.md', score: 1, title: 't'}]}),
        makeCompleted({matchedDocs: [{path: 'a/c.md', score: 1, title: 't'}]}),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'json'})

      const parsed = JSON.parse(loggedOutput(terminal))
      expect(parsed.knowledgeGaps).to.deep.equal([])
    })
  })

  // ── 26-28. Format dispatch ────────────────────────────────────────────────
  describe('format dispatch', () => {
    it('format: "narrative" dispatches to formatQueryLogSummaryNarrative with computed summary', async () => {
      const entries = [
        makeCompleted({
          matchedDocs: [{path: 'authentication/oauth.md', score: 1, title: 'oauth'}],
          query: 'how does auth work',
          tier: 0,
          timing: {durationMs: 500},
        }),
      ]
      const {terminal, useCase} = makeUseCase(sandbox, entries)

      await useCase.run({format: 'narrative'})

      const out = loggedOutput(terminal)
      expect(out).to.include('1 question')
      expect(out).to.include('answered 1 from curated knowledge')
    })

    it('format: "narrative" with empty entries logs the empty-state message', async () => {
      const {terminal, useCase} = makeUseCase(sandbox, [])

      await useCase.run({format: 'narrative'})

      const out = loggedOutput(terminal)
      expect(out).to.include('No queries recorded')
      expect(out).to.include('knowledge base is ready')
    })

    it('defaults to text format when format is undefined', async () => {
      const {terminal, useCase} = makeUseCase(sandbox, [])

      await useCase.run({})

      const out = loggedOutput(terminal)
      expect(out).to.include('Query Recall Summary')
      expect(out).to.include('(no entries yet)')
    })
  })
})
