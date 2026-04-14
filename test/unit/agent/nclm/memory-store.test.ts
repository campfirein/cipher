/* eslint-disable camelcase */
import {expect} from 'chai'
import {createHash} from 'node:crypto'

import type {MemoryEntry} from '../../../../src/agent/infra/nclm/memory-types.js'

import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'

describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  // ─── constructor ───────────────────────────────────────────

  describe('constructor', () => {
    it('creates with default config', () => {
      const s = new MemoryStore()
      const stats = s.stats()
      expect(stats.total_count).to.equal(0)
    })

    it('accepts custom config and merges with defaults', () => {
      const s = new MemoryStore({archive_importance_threshold: 20})
      // Should work — no throw. Config is consumed internally.
      const stats = s.stats()
      expect(stats.total_count).to.equal(0)
    })

    it('deep-merges nested config — partial scoring keeps other scoring defaults', () => {
      const s = new MemoryStore({scoring: {w_relevance: 0.5}})
      // The store should have w_relevance=0.5 but w_importance still at default 0.2
      // We verify indirectly: no throw on construction and store is functional
      s.write({content: 'hello', title: 'test'})
      expect(s.stats().active_count).to.equal(1)
    })
  })

  // ─── write ─────────────────────────────────────────────────

  describe('write', () => {
    it('creates entry with all required fields populated', () => {
      const entry = store.write({content: 'Tokens rotate every 24h', tags: ['auth', 'jwt'], title: 'JWT policy'})

      expect(entry.id).to.be.a('string').and.have.length.greaterThan(0)
      expect(entry.title).to.equal('JWT policy')
      expect(entry.content).to.equal('Tokens rotate every 24h')
      expect(entry.tags).to.deep.equal(['auth', 'jwt'])
      expect(entry.importance).to.equal(50)
      expect(entry.access_count).to.equal(0)
      expect(entry.update_count).to.equal(0)
      expect(entry.write_sequence).to.be.a('number')
      expect(entry.created_at).to.be.a('number')
      expect(entry.updated_at).to.be.a('number')
      expect(entry.content_hash).to.be.a('string')
      expect(entry.token_count).to.be.a('number')
      expect(entry.status).to.equal('active')
      expect(entry.entry_type).to.equal('raw')
      expect(entry.stub).to.be.null
    })

    it('assigns unique id', () => {
      const e1 = store.write({content: 'x', title: 'a'})
      const e2 = store.write({content: 'y', title: 'b'})
      expect(e1.id).to.not.equal(e2.id)
    })

    it('assigns monotonic write_sequence starting from 1', () => {
      const e1 = store.write({content: 'x', title: 'a'})
      const e2 = store.write({content: 'y', title: 'b'})
      const e3 = store.write({content: 'z', title: 'c'})
      expect(e1.write_sequence).to.equal(1)
      expect(e2.write_sequence).to.equal(2)
      expect(e3.write_sequence).to.equal(3)
    })

    it('sets default importance to 50', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      expect(entry.importance).to.equal(50)
    })

    it('sets default tags to empty array', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      expect(entry.tags).to.deep.equal([])
    })

    it('deduplicates tags', () => {
      const entry = store.write({content: 'hello', tags: ['auth', 'auth', 'jwt'], title: 'test'})
      expect(entry.tags).to.deep.equal(['auth', 'jwt'])
    })

    it('preserves first-occurrence tag order', () => {
      const entry = store.write({content: 'hello', tags: ['b', 'a', 'b'], title: 'test'})
      expect(entry.tags).to.deep.equal(['b', 'a'])
    })

    it('clamps importance to [0, 100]', () => {
      const e1 = store.write({content: 'x', importance: -10, title: 'low'})
      const e2 = store.write({content: 'y', importance: 150, title: 'high'})
      expect(e1.importance).to.equal(0)
      expect(e2.importance).to.equal(100)
    })

    it('computes content_hash as SHA-256 of content', () => {
      const content = 'Tokens rotate every 24h'
      const entry = store.write({content, title: 'test'})
      const expected = createHash('sha256').update(content).digest('hex')
      expect(entry.content_hash).to.equal(expected)
    })

    it('computes token_count as ceil(content.length / 4)', () => {
      const content = 'abcdefghij' // length 10
      const entry = store.write({content, title: 'test'})
      expect(entry.token_count).to.equal(Math.ceil(10 / 4)) // 3
    })

    it('sets status to active and entry_type to raw', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      expect(entry.status).to.equal('active')
      expect(entry.entry_type).to.equal('raw')
    })

    it('sets created_at and updated_at to current time', () => {
      const before = Date.now()
      const entry = store.write({content: 'hello', title: 'test'})
      const after = Date.now()
      expect(entry.created_at).to.be.at.least(before).and.at.most(after)
      expect(entry.updated_at).to.be.at.least(before).and.at.most(after)
    })

    it('sets stub to null', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      expect(entry.stub).to.be.null
    })

    it('sets access_count and update_count to 0', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      expect(entry.access_count).to.equal(0)
      expect(entry.update_count).to.equal(0)
    })

    it('throws on empty title', () => {
      expect(() => store.write({content: 'hello', title: ''})).to.throw()
    })

    it('allows empty content', () => {
      const entry = store.write({content: '', title: 'placeholder'})
      expect(entry.content).to.equal('')
      expect(entry.token_count).to.equal(0)
    })

    it('returns the same object stored in the Map — write() reference is live', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      const readEntry = store.read(entry.id)
      expect(entry).to.equal(readEntry) // Object.is identity
    })
  })

  // ─── read ──────────────────────────────────────────────────

  describe('read', () => {
    it('returns entry by id', () => {
      const written = store.write({content: 'hello', title: 'test'})
      const entry = store.read(written.id)
      expect(entry).to.not.be.null
      expect(entry!.title).to.equal('test')
    })

    it('returns null for non-existent id', () => {
      const entry = store.read('nonexistent-id')
      expect(entry).to.be.null
    })
  })

  // ─── update ────────────────────────────────────────────────

  describe('update', () => {
    let entry: MemoryEntry

    beforeEach(() => {
      entry = store.write({content: 'original content', importance: 50, tags: ['tag1'], title: 'original'})
    })

    it('updates title when provided', () => {
      store.update({id: entry.id, title: 'new title'})
      expect(entry.title).to.equal('new title')
    })

    it('updates content when provided', () => {
      store.update({content: 'new content', id: entry.id})
      expect(entry.content).to.equal('new content')
    })

    it('updates tags when provided (deduplicated)', () => {
      store.update({id: entry.id, tags: ['a', 'b', 'a']})
      expect(entry.tags).to.deep.equal(['a', 'b'])
    })

    it('replaces importance when explicitly provided (no +5)', () => {
      store.update({id: entry.id, importance: 90})
      expect(entry.importance).to.equal(90)
    })

    it('adds 5 to importance when importance not provided (capped at 100)', () => {
      // Starting importance is 50
      store.update({content: 'updated', id: entry.id})
      expect(entry.importance).to.equal(55)

      // Do it again
      store.update({content: 'updated again', id: entry.id})
      expect(entry.importance).to.equal(60)
    })

    it('caps implicit +5 at 100', () => {
      // Set importance to 98 explicitly
      store.update({id: entry.id, importance: 98})
      // Now update without importance — should add 5 but cap at 100
      store.update({content: 'cap test', id: entry.id})
      expect(entry.importance).to.equal(100)
    })

    it('does not change title, content, or tags when those fields are not provided', () => {
      store.update({id: entry.id}) // minimal update
      expect(entry.title).to.equal('original')
      expect(entry.content).to.equal('original content')
      expect(entry.tags).to.deep.equal(['tag1'])
    })

    it('increments update_count in both importance cases', () => {
      expect(entry.update_count).to.equal(0)

      store.update({id: entry.id, importance: 80})
      expect(entry.update_count).to.equal(1)

      store.update({content: 'change', id: entry.id})
      expect(entry.update_count).to.equal(2)
    })

    it('bumps write_sequence to new value', () => {
      const oldSeq = entry.write_sequence
      store.update({content: 'new', id: entry.id})
      expect(entry.write_sequence).to.be.greaterThan(oldSeq)
    })

    it('updates updated_at timestamp', () => {
      const oldTime = entry.updated_at
      // Small delay to ensure timestamp difference
      store.update({content: 'new', id: entry.id})
      expect(entry.updated_at).to.be.at.least(oldTime)
    })

    it('recomputes content_hash when content changes', () => {
      const oldHash = entry.content_hash
      store.update({content: 'completely different', id: entry.id})
      expect(entry.content_hash).to.not.equal(oldHash)
      const expected = createHash('sha256').update('completely different').digest('hex')
      expect(entry.content_hash).to.equal(expected)
    })

    it('recomputes token_count when content changes', () => {
      store.update({content: 'a'.repeat(100), id: entry.id})
      expect(entry.token_count).to.equal(Math.ceil(100 / 4))
    })

    it('clamps importance to [0, 100]', () => {
      store.update({id: entry.id, importance: 150})
      expect(entry.importance).to.equal(100)

      store.update({id: entry.id, importance: -10})
      expect(entry.importance).to.equal(0)
    })

    it('throws for non-existent id', () => {
      expect(() => store.update({id: 'nonexistent'})).to.throw()
    })

    it('throws on empty title when title is provided', () => {
      expect(() => store.update({id: entry.id, title: ''})).to.throw()
    })

    it('mutates the same in-memory entry — read() reference stays aliased after update', () => {
      const ref = store.read(entry.id)!
      store.update({id: entry.id, title: 'mutated'})
      expect(ref.title).to.equal('mutated')
      expect(ref).to.equal(entry) // Same object identity
    })
  })

  // ─── free ──────────────────────────────────────────────────

  describe('free', () => {
    it('removes entry from store', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      store.free(entry.id)
      expect(store.stats().total_count).to.equal(0)
    })

    it('read returns null after free', () => {
      const entry = store.write({content: 'hello', title: 'test'})
      store.free(entry.id)
      expect(store.read(entry.id)).to.be.null
    })

    it('stats reflects reduced count', () => {
      store.write({content: 'x', title: 'a'})
      const e2 = store.write({content: 'y', title: 'b'})
      expect(store.stats().active_count).to.equal(2)
      store.free(e2.id)
      expect(store.stats().active_count).to.equal(1)
    })

    it('no-op for non-existent id', () => {
      store.write({content: 'hello', title: 'test'})
      store.free('nonexistent')
      expect(store.stats().active_count).to.equal(1)
    })
  })

  // ─── stats ─────────────────────────────────────────────────

  describe('stats', () => {
    it('returns zero counts for empty store', () => {
      const stats = store.stats()
      expect(stats.total_count).to.equal(0)
      expect(stats.active_count).to.equal(0)
      expect(stats.archived_count).to.equal(0)
      expect(stats.summary_count).to.equal(0)
      expect(stats.total_tokens).to.equal(0)
      expect(stats.tags).to.deep.equal({})
    })

    it('counts total_count as active + archived', () => {
      const e1 = store.write({content: 'xx', title: 'a'})
      store.write({content: 'yy', title: 'b'})
      // Simulate archived (archive() is 1.3)
      e1.status = 'archived'
      const stats = store.stats()
      expect(stats.total_count).to.equal(2)
    })

    it('counts active_count as active only', () => {
      const e1 = store.write({content: 'xx', title: 'a'})
      store.write({content: 'yy', title: 'b'})
      e1.status = 'archived'
      expect(store.stats().active_count).to.equal(1)
    })

    it('counts archived_count correctly — mutate entry.status since archive() is 1.3', () => {
      const e1 = store.write({content: 'xx', title: 'a'})
      const e2 = store.write({content: 'yy', title: 'b'})
      e1.status = 'archived'
      e2.status = 'archived'
      expect(store.stats().archived_count).to.equal(2)
    })

    it('counts total_tokens from active entries only', () => {
      const e1 = store.write({content: 'a'.repeat(40), title: 'a'}) // 10 tokens
      store.write({content: 'b'.repeat(20), title: 'b'}) // 5 tokens
      const totalBefore = store.stats().total_tokens
      expect(totalBefore).to.equal(10 + 5)

      e1.status = 'archived'
      expect(store.stats().total_tokens).to.equal(5)
    })

    it('counts entries per tag from active entries only', () => {
      const e1 = store.write({content: 'x', tags: ['auth', 'jwt'], title: 'a'})
      store.write({content: 'y', tags: ['auth'], title: 'b'})
      expect(store.stats().tags).to.deep.equal({auth: 2, jwt: 1})

      e1.status = 'archived'
      expect(store.stats().tags).to.deep.equal({auth: 1})
    })

    it('counts one entry with multiple tags once per tag', () => {
      store.write({content: 'x', tags: ['a', 'b', 'c'], title: 'multi'})
      const stats = store.stats()
      expect(stats.tags).to.deep.equal({a: 1, b: 1, c: 1})
      expect(stats.active_count).to.equal(1) // One entry, not three
    })

    it('excludes archived entries from total_tokens and tags', () => {
      const e = store.write({content: 'a'.repeat(100), tags: ['secret'], title: 'archived'})
      e.status = 'archived'
      const stats = store.stats()
      expect(stats.total_tokens).to.equal(0)
      expect(stats.tags).to.deep.equal({})
      expect(stats.archived_count).to.equal(1)
    })

    it('summary_count is 0 when all entries are raw', () => {
      store.write({content: 'x', title: 'a'})
      store.write({content: 'y', title: 'b'})
      expect(store.stats().summary_count).to.equal(0)
    })
  })

  // ─── search (Phase 1.2) ────────────────────────────────────

  describe('search', () => {
    beforeEach(() => {
      store.write({content: 'Refresh tokens rotate every 24 hours with sliding window pattern', tags: ['auth', 'jwt'], title: 'JWT refresh token rotation'})
      store.write({content: 'LRU eviction with 300 second TTL for session data', tags: ['cache', 'redis'], title: 'Redis caching strategy'})
      store.write({content: 'Handles OAuth2 authorization code flow for third party providers', tags: ['auth', 'oauth'], title: 'OAuth callback handler'})
    })

    it('returns ScoredEntry array with score and bm25Score', () => {
      const results = store.search({query: 'JWT token'})
      expect(results).to.be.an('array')
      expect(results.length).to.be.greaterThan(0)
      expect(results[0]).to.have.property('entry')
      expect(results[0]).to.have.property('score').that.is.a('number')
      expect(results[0]).to.have.property('bm25Score').that.is.a('number')
    })

    it('returns results sorted by compound score descending', () => {
      const results = store.search({query: 'auth'})
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).to.be.at.most(results[i - 1].score)
      }
    })

    it('respects top_k limit', () => {
      const results = store.search({query: 'auth', top_k: 1})
      expect(results.length).to.equal(1)
    })

    it('defaults top_k to 5', () => {
      // Add more entries
      for (let i = 0; i < 8; i++) {
        store.write({content: `Authentication detail ${i}`, tags: ['auth'], title: `Auth note ${i}`})
      }

      const results = store.search({query: 'auth'})
      expect(results.length).to.be.at.most(5)
    })

    it('returns empty array for no matches', () => {
      const results = store.search({query: 'xyznonexistent'})
      expect(results).to.deep.equal([])
    })

    it('title matches rank higher than content-only matches', () => {
      store.write({content: 'Handles schema changes', title: 'Database migration'})
      store.write({content: 'Database migration process details', title: 'Schema overview'})

      const results = store.search({query: 'database migration'})
      expect(results.length).to.be.greaterThan(0)
      // Entry with "database migration" in title should rank first
      expect(results[0].entry.title).to.equal('Database migration')
    })

    it('filters by tags when provided', () => {
      const results = store.search({query: 'auth', tags: ['jwt']})
      for (const r of results) {
        expect(r.entry.tags).to.include('jwt')
      }
    })

    it('excludes archived entries by default', () => {
      const entry = store.write({content: 'Old authentication pattern', tags: ['auth'], title: 'Archived auth note'})
      entry.status = 'archived'

      const results = store.search({query: 'auth'})
      const ids = results.map((r) => r.entry.id)
      expect(ids).to.not.include(entry.id)
    })

    it('includes archived entries when include_archived is true', () => {
      const entry = store.write({content: 'Old authentication pattern', tags: ['auth'], title: 'Archived auth note'})
      entry.status = 'archived'

      const results = store.search({include_archived: true, query: 'auth'})
      const ids = results.map((r) => r.entry.id)
      expect(ids).to.include(entry.id)
    })

    it('bm25Score is normalized to [0, 1) via score/(1+score)', () => {
      const results = store.search({query: 'JWT token rotation'})
      for (const r of results) {
        expect(r.bm25Score).to.be.at.least(0)
        expect(r.bm25Score).to.be.lessThan(1)
      }
    })

    it('compound score includes importance component', () => {
      // Write two entries with same content relevance but different importance
      const low = store.write({content: 'Login verification flow', importance: 10, title: 'Auth pattern alpha'})
      const high = store.write({content: 'Login verification flow', importance: 90, title: 'Auth pattern beta'})

      const results = store.search({query: 'login verification flow'})
      expect(results.length).to.be.greaterThanOrEqual(2)

      const highResult = results.find((r) => r.entry.id === high.id)
      const lowResult = results.find((r) => r.entry.id === low.id)
      expect(highResult).to.not.be.undefined
      expect(lowResult).to.not.be.undefined
      expect(highResult!.score).to.be.greaterThan(lowResult!.score)
    })

    it('access feedback: increments importance by 3 for each returned entry', () => {
      const entry = store.write({content: 'Testing access feedback loop', title: 'Access test'})
      const originalImportance = entry.importance

      store.search({query: 'access feedback'})
      expect(entry.importance).to.equal(originalImportance + 3)
      expect(entry.access_count).to.equal(1)
    })

    it('access feedback: increments access_count for each returned entry', () => {
      store.write({content: 'Testing counter increments on search', title: 'Counter test'})

      store.search({query: 'counter test'})
      store.search({query: 'counter test'})

      const {entry} = store.search({query: 'counter test'})[0]
      expect(entry.access_count).to.equal(3)
    })

    it('access feedback: does not increment for entries not in results', () => {
      const unrelated = store.write({content: 'Nothing about caching', title: 'Unrelated stuff'})
      store.search({query: 'JWT token rotation'})
      expect(unrelated.importance).to.equal(50)
      expect(unrelated.access_count).to.equal(0)
    })

    it('access feedback: caps importance at 100', () => {
      const entry = store.write({content: 'Capping importance at max', importance: 99, title: 'Cap test entry'})
      store.search({query: 'cap test'})
      expect(entry.importance).to.equal(100)
    })

    it('score-gap filtering: removes results below 0.7 * top score', () => {
      // Create one very relevant and one barely relevant entry
      store.write({content: 'Xylophone details xylophone xylophone', title: 'Exact unique keyword xylophone'})
      store.write({content: 'Barely mentions xylophone once', title: 'Something else entirely'})

      const results = store.search({query: 'xylophone'})
      if (results.length > 1) {
        const topScore = results[0].score
        for (const r of results) {
          expect(r.score).to.be.at.least(topScore * 0.7)
        }
      }
    })

    it('finds entries after write — BM25 index is updated on write', () => {
      const entry = store.write({content: 'Brand new content about kubernetes', title: 'Freshly written entry'})
      const results = store.search({query: 'kubernetes'})
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].entry.id).to.equal(entry.id)
    })

    it('finds updated content after update — BM25 index is updated on update', () => {
      const entry = store.write({content: 'Original content about nothing', title: 'Updatable entry'})
      store.update({content: 'Now talks about prometheus monitoring', id: entry.id})

      const results = store.search({query: 'prometheus monitoring'})
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].entry.id).to.equal(entry.id)
    })

    it('does not find freed entries — BM25 index is updated on free', () => {
      const entry = store.write({content: 'Ephemeral content about grafana dashboards', title: 'Soon deleted'})
      store.free(entry.id)

      const results = store.search({query: 'grafana dashboards'})
      expect(results).to.deep.equal([])
    })

    it('fuzzy matching: finds entries with minor typos', () => {
      store.write({content: 'Validates tokens on each request', title: 'Authentication middleware'})
      const results = store.search({query: 'authentcation'}) // typo: missing 'i'
      expect(results.length).to.be.greaterThan(0)
    })

    it('prefix matching: finds entries with partial terms', () => {
      store.write({content: 'Rolling update strategy for pods', title: 'Kubernetes deployment'})
      const results = store.search({query: 'kube deploy'})
      expect(results.length).to.be.greaterThan(0)
    })

    it('returns empty array for empty query string', () => {
      expect(store.search({query: ''})).to.deep.equal([])
    })

    it('returns empty array for whitespace-only query', () => {
      expect(store.search({query: '   '})).to.deep.equal([])
    })

    it('OOD floor: returns empty when best score is below min_relevance', () => {
      // Use a very high min_relevance so all results are below floor
      const strictStore = new MemoryStore({scoring: {min_relevance: 0.99}})
      strictStore.write({content: 'Some content here', title: 'Some entry'})
      const results = strictStore.search({query: 'entry'})
      expect(results).to.deep.equal([])
    })

    it('OOD floor: returns results when best score meets min_relevance', () => {
      // Default min_relevance is 0.45 — normal searches should pass
      const results = store.search({query: 'JWT refresh token rotation'})
      expect(results.length).to.be.greaterThan(0)
    })
  })

  // ─── list (Phase 1.3) ─────────────────────────────────────

  describe('list', () => {
    beforeEach(() => {
      store.write({content: 'aaa', tags: ['auth'], title: 'First'})
      store.write({content: 'bbb', tags: ['cache'], title: 'Second'})
      store.write({content: 'ccc', tags: ['auth', 'cache'], title: 'Third'})
    })

    it('returns all active entries by default', () => {
      const entries = store.list()
      expect(entries).to.have.length(3)
    })

    it('sorts by write_sequence descending by default', () => {
      const entries = store.list()
      expect(entries[0].title).to.equal('Third')
      expect(entries[2].title).to.equal('First')
    })

    it('sorts by write_sequence ascending', () => {
      const entries = store.list({sort_by: 'write_sequence', sort_dir: 'asc'})
      expect(entries[0].title).to.equal('First')
      expect(entries[2].title).to.equal('Third')
    })

    it('sorts by importance descending', () => {
      const e1 = store.read(store.list({sort_by: 'write_sequence', sort_dir: 'asc'})[0].id)!
      e1.importance = 90
      const entries = store.list({sort_by: 'importance'})
      expect(entries[0].importance).to.equal(90)
    })

    it('sorts by updated_at descending', () => {
      const entries = store.list({sort_by: 'updated_at'})
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].updated_at).to.be.at.most(entries[i - 1].updated_at)
      }
    })

    it('filters by tags (OR semantics)', () => {
      const entries = store.list({tags: ['cache']})
      expect(entries.length).to.be.greaterThanOrEqual(2) // Second + Third
      for (const e of entries) {
        expect(e.tags).to.include('cache')
      }
    })

    it('filters by status active', () => {
      const first = store.list({sort_by: 'write_sequence', sort_dir: 'asc'})[0]
      first.status = 'archived'
      const entries = store.list({status: 'active'})
      expect(entries).to.have.length(2)
    })

    it('filters by status archived', () => {
      const first = store.list({sort_by: 'write_sequence', sort_dir: 'asc'})[0]
      first.status = 'archived'
      const entries = store.list({status: 'archived'})
      expect(entries).to.have.length(1)
    })

    it('returns all statuses when status is all', () => {
      const first = store.list({sort_by: 'write_sequence', sort_dir: 'asc'})[0]
      first.status = 'archived'
      const entries = store.list({status: 'all'})
      expect(entries).to.have.length(3)
    })

    it('filters by after_sequence — forward temporal query', () => {
      const entries = store.list({after_sequence: 1, sort_by: 'write_sequence', sort_dir: 'asc'})
      expect(entries.length).to.equal(2) // Second(2) + Third(3)
      expect(entries[0].title).to.equal('Second')
    })

    it('filters by before_sequence — backward temporal query', () => {
      const entries = store.list({before_sequence: 3, sort_by: 'write_sequence', sort_dir: 'desc'})
      expect(entries.length).to.equal(2) // First(1) + Second(2)
      expect(entries[0].title).to.equal('Second')
    })

    it('combines after_sequence and before_sequence for range query', () => {
      const entries = store.list({after_sequence: 1, before_sequence: 3})
      expect(entries.length).to.equal(1) // Only Second(2)
      expect(entries[0].title).to.equal('Second')
    })

    it('respects limit', () => {
      const entries = store.list({limit: 2})
      expect(entries).to.have.length(2)
    })

    it('defaults limit to 20', () => {
      // Add many entries
      for (let i = 0; i < 25; i++) {
        store.write({content: `content ${i}`, title: `Entry ${i}`})
      }

      const entries = store.list()
      expect(entries).to.have.length(20)
    })

    it('filters by entry_type', () => {
      const first = store.list({sort_by: 'write_sequence', sort_dir: 'asc'})[0]
      first.entry_type = 'summary'
      const entries = store.list({entry_type: 'summary'})
      expect(entries).to.have.length(1)
    })
  })

  // ─── latest (Phase 1.3) ───────────────────────────────────

  describe('latest', () => {
    it('returns the most recently written active entry', () => {
      store.write({content: 'aaa', title: 'Old'})
      store.write({content: 'bbb', title: 'New'})
      const entry = store.latest()
      expect(entry).to.not.be.null
      expect(entry!.title).to.equal('New')
    })

    it('returns null for empty store', () => {
      expect(store.latest()).to.be.null
    })

    it('filters by tag when provided', () => {
      store.write({content: 'aaa', tags: ['auth'], title: 'Auth entry'})
      store.write({content: 'bbb', tags: ['cache'], title: 'Cache entry'})
      const entry = store.latest('auth')
      expect(entry).to.not.be.null
      expect(entry!.title).to.equal('Auth entry')
    })

    it('returns null when no entries match the tag', () => {
      store.write({content: 'aaa', tags: ['other'], title: 'Unrelated'})
      expect(store.latest('auth')).to.be.null
    })

    it('skips archived entries', () => {
      const old = store.write({content: 'aaa', title: 'Active'})
      const newer = store.write({content: 'bbb', title: 'Archived'})
      newer.status = 'archived'
      expect(store.latest()!.id).to.equal(old.id)
    })
  })

  // ─── archive (Phase 1.3) ──────────────────────────────────

  describe('archive', () => {
    it('sets status to archived', () => {
      const entry = store.write({content: 'Important content that should be preserved', title: 'To archive'})
      store.archive(entry.id)
      expect(entry.status).to.equal('archived')
    })

    it('generates a stub (ghost cue) from content', () => {
      const entry = store.write({content: 'Detailed knowledge about authentication patterns and JWT tokens', title: 'Ghost test'})
      store.archive(entry.id)
      expect(entry.stub).to.be.a('string')
      expect(entry.stub!.length).to.be.greaterThan(0)
    })

    it('preserves original content', () => {
      const originalContent = 'This is the full original content of the entry'
      const entry = store.write({content: originalContent, title: 'Preserved'})
      store.archive(entry.id)
      expect(entry.content).to.equal(originalContent)
    })

    it('re-indexes with stub content so archived entry is still searchable', () => {
      const entry = store.write({content: 'Unique xylophone content', title: 'Searchable archived'})
      store.archive(entry.id)

      const results = store.search({include_archived: true, query: 'xylophone'})
      expect(results.length).to.be.greaterThan(0)
    })

    it('excluded from stats active_count and total_tokens', () => {
      const entry = store.write({content: 'a'.repeat(100), title: 'Stats test'})
      const tokensBefore = store.stats().total_tokens
      store.archive(entry.id)
      expect(store.stats().active_count).to.equal(0)
      expect(store.stats().total_tokens).to.be.lessThan(tokensBefore)
      expect(store.stats().archived_count).to.equal(1)
    })

    it('no-op for non-existent id', () => {
      store.archive('nonexistent')
      expect(store.stats().archived_count).to.equal(0)
    })

    it('no-op if already archived', () => {
      const entry = store.write({content: 'Content', title: 'Double archive'})
      store.archive(entry.id)
      const {stub} = entry
      store.archive(entry.id) // Should not change anything
      expect(entry.stub).to.equal(stub)
    })

    it('re-indexes with stub content, not full content', () => {
      const freshStore = new MemoryStore()
      // Content has a unique single-token term beyond the 200-char stub truncation point.
      // "xylophonecraft" is a single token (no underscores/spaces) that won't appear in the stub.
      const entry = freshStore.write({
        content: 'Beginning text here. ' + 'z'.repeat(300) + ' xylophonecraft',
        title: 'Archival reindex test',
      })
      freshStore.archive(entry.id)

      // The stub is "Archival reindex test: Beginning text here. zzz..." (truncated at 200 chars)
      // "xylophonecraft" is beyond the stub — should NOT match
      const noResults = freshStore.search({include_archived: true, query: 'xylophonecraft'})
      expect(noResults).to.deep.equal([])

      // "Archival" IS in the stub (title) — should match
      const stubResults = freshStore.search({include_archived: true, query: 'archival reindex'})
      expect(stubResults.length).to.be.greaterThan(0)
    })
  })

  // ─── compact (Phase 1.3) ──────────────────────────────────

  describe('compact', () => {
    beforeEach(() => {
      // Create 5 entries with same tag, varying importance
      for (let i = 0; i < 5; i++) {
        store.write({
          content: `Detail ${i}: information about authentication mechanism number ${i}`,
          importance: 20 + i * 10, // 20, 30, 40, 50, 60
          tags: ['auth'],
          title: `Auth note ${i}`,
        })
      }
    })

    it('creates a summary entry from low-importance entries', () => {
      const result = store.compact('auth')
      expect(result.summaryEntry).to.exist
      expect(result.summaryEntry.entry_type).to.equal('summary')
      expect(result.summaryEntry.tags).to.include('auth')
    })

    it('archives the condensed entries', () => {
      const result = store.compact('auth')
      expect(result.archivedIds.length).to.be.greaterThan(0)
      for (const id of result.archivedIds) {
        const entry = store.read(id)
        expect(entry).to.not.be.null
        expect(entry!.status).to.equal('archived')
      }
    })

    it('reports tokens freed', () => {
      const result = store.compact('auth')
      expect(result.tokensFreed).to.be.a('number')
    })

    it('summary content includes information from condensed entries', () => {
      const result = store.compact('auth')
      // Deterministic summary: concatenation of condensed entry titles + content
      expect(result.summaryEntry.content.length).to.be.greaterThan(0)
    })

    it('keeps highest-importance entries active', () => {
      const beforeIds = store.list({sort_by: 'importance', tags: ['auth']}).map((e) => e.importance)
      store.compact('auth')
      const activeAfter = store.list({sort_by: 'importance', status: 'active', tags: ['auth']})
      // Highest importance entries should still be active
      for (const e of activeAfter) {
        if (e.entry_type === 'raw') {
          expect(e.importance).to.be.at.least(beforeIds[Math.floor(beforeIds.length / 2)])
        }
      }
    })

    it('throws when not enough entries to condense', () => {
      const smallStore = new MemoryStore({min_entries_to_condense: 3})
      smallStore.write({content: 'Only one entry', tags: ['lonely'], title: 'Solo'})
      expect(() => smallStore.compact('lonely')).to.throw()
    })

    it('compact without tag compacts all entries', () => {
      store.write({content: 'Some cache info', tags: ['cache'], title: 'Untagged 1'})
      store.write({content: 'More cache info', tags: ['cache'], title: 'Untagged 2'})
      const result = store.compact()
      expect(result.archivedIds.length).to.be.greaterThan(0)
    })
  })

  // ─── buildInjection (Phase 1.4) ───────────────────────────

  describe('buildInjection', () => {
    it('returns empty-ish string for empty store', () => {
      const injection = store.buildInjection()
      expect(injection).to.be.a('string')
      expect(injection).to.include('0 active')
    })

    it('includes summary entries in summaries lane', () => {
      const entry = store.write({content: 'Summary of auth patterns', tags: ['auth'], title: 'Auth summary'})
      entry.entry_type = 'summary'
      const injection = store.buildInjection()
      expect(injection).to.include('Auth summary')
    })

    it('includes active raw entries in entries lane', () => {
      store.write({content: 'Token rotation info', tags: ['auth'], title: 'JWT details'})
      const injection = store.buildInjection()
      expect(injection).to.include('JWT details')
    })

    it('includes archived stubs in stubs lane', () => {
      const entry = store.write({content: 'Legacy authentication info', title: 'Old auth note'})
      store.archive(entry.id)
      const injection = store.buildInjection()
      expect(injection).to.include('Old auth note')
    })

    it('respects summaries token budget', () => {
      // Create large summary entries
      for (let i = 0; i < 10; i++) {
        const entry = store.write({content: 'x'.repeat(2000), tags: ['test'], title: `Summary ${i}`})
        entry.entry_type = 'summary'
      }

      // With small summaries budget, not all should appear
      const injection = store.buildInjection({entries: 4000, stubs: 500, summaries: 500})
      // Should not include all 10 summaries (each ~500 tokens)
      const summaryCount = (injection.match(/Summary \d/g) ?? []).length
      expect(summaryCount).to.be.lessThan(10)
    })

    it('respects entries token budget', () => {
      // Create large entries
      for (let i = 0; i < 10; i++) {
        store.write({content: 'y'.repeat(2000), title: `Entry ${i}`})
      }

      const injection = store.buildInjection({entries: 500, stubs: 500, summaries: 2000})
      const entryCount = (injection.match(/Entry \d/g) ?? []).length
      expect(entryCount).to.be.lessThan(10)
    })

    it('respects stubs token budget', () => {
      for (let i = 0; i < 10; i++) {
        const entry = store.write({content: 'z'.repeat(500), title: `Archived ${i}`})
        store.archive(entry.id)
      }

      const injection = store.buildInjection({entries: 4000, stubs: 100, summaries: 2000})
      const stubCount = (injection.match(/Archived \d/g) ?? []).length
      expect(stubCount).to.be.lessThan(10)
    })

    it('uses default budgets when none provided', () => {
      store.write({content: 'Content here', title: 'Default test'})
      // Should not throw
      const injection = store.buildInjection()
      expect(injection).to.include('Default test')
    })

    it('orders summaries by importance descending', () => {
      const low = store.write({content: 'Low', importance: 20, title: 'Low summary'})
      const high = store.write({content: 'High', importance: 80, title: 'High summary'})
      low.entry_type = 'summary'
      high.entry_type = 'summary'

      const injection = store.buildInjection()
      const highPos = injection.indexOf('High summary')
      const lowPos = injection.indexOf('Low summary')
      expect(highPos).to.be.lessThan(lowPos)
    })

    it('includes stats footer', () => {
      store.write({content: 'Content', title: 'Stats test'})
      const injection = store.buildInjection()
      expect(injection).to.include('1 active')
    })
  })

  // ─── serialize / deserialize (Phase 1.4) ──────────────────

  describe('serialize', () => {
    it('returns all entries and sequence counter', () => {
      store.write({content: 'Content 1', tags: ['auth'], title: 'Entry 1'})
      store.write({content: 'Content 2', tags: ['cache'], title: 'Entry 2'})
      const serialized = store.serialize()
      expect(serialized.entries).to.have.length(2)
      expect(serialized.sequenceCounter).to.equal(2)
    })

    it('includes archived entries', () => {
      const entry = store.write({content: 'Content', title: 'To archive'})
      store.archive(entry.id)
      const serialized = store.serialize()
      expect(serialized.entries).to.have.length(1)
      expect(serialized.entries[0].status).to.equal('archived')
    })

    it('produces valid JSON', () => {
      store.write({content: 'Content with "quotes" and \nnewlines', title: 'JSON test'})
      const serialized = store.serialize()
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)
      expect(parsed.entries).to.have.length(1)
    })

    it('preserves user config so restored store uses same scoring/bm25 settings', () => {
      const customStore = new MemoryStore({archive_importance_threshold: 20, scoring: {w_relevance: 0.8}})
      customStore.write({content: 'Content', title: 'Config test'})
      const serialized = customStore.serialize()
      expect(serialized.config).to.deep.include({archive_importance_threshold: 20})
      expect(serialized.config.scoring).to.deep.include({w_relevance: 0.8})
    })
  })

  describe('deserialize', () => {
    it('restores entries from serialized state', () => {
      store.write({content: 'Survived restart', tags: ['auth'], title: 'Persisted'})
      const serialized = store.serialize()

      const restored = new MemoryStore()
      restored.deserialize(serialized)
      expect(restored.stats().total_count).to.equal(1)
      expect(restored.read(serialized.entries[0].id)!.title).to.equal('Persisted')
    })

    it('restores sequence counter so new writes continue monotonically', () => {
      store.write({content: 'First', title: 'Before'})
      store.write({content: 'Second', title: 'Before 2'})
      const serialized = store.serialize()

      const restored = new MemoryStore()
      restored.deserialize(serialized)
      const newEntry = restored.write({content: 'Third', title: 'After'})
      expect(newEntry.write_sequence).to.equal(3)
    })

    it('restores BM25 index — search works after deserialize', () => {
      store.write({content: 'Unique xylophone content', title: 'Searchable entry'})
      const serialized = store.serialize()

      const restored = new MemoryStore()
      restored.deserialize(serialized)
      const results = restored.search({query: 'xylophone'})
      expect(results.length).to.be.greaterThan(0)
    })

    it('restores archived entries with stubs', () => {
      const entry = store.write({content: 'Full content here', title: 'Archived entry'})
      store.archive(entry.id)
      const serialized = store.serialize()

      const restored = new MemoryStore()
      restored.deserialize(serialized)
      const restoredEntry = restored.read(entry.id)
      expect(restoredEntry!.status).to.equal('archived')
      expect(restoredEntry!.stub).to.be.a('string')
    })

    it('clears existing state before restoring', () => {
      store.write({content: 'Should be gone', title: 'Old'})
      const otherStore = new MemoryStore()
      otherStore.write({content: 'Should remain', title: 'New'})
      const serialized = otherStore.serialize()

      store.deserialize(serialized)
      expect(store.stats().total_count).to.equal(1)
      expect(store.list()[0].title).to.equal('New')
    })

    it('roundtrip: serialize then deserialize preserves all fields', () => {
      const original = store.write({content: 'All fields', importance: 75, tags: ['test'], title: 'Full roundtrip'})
      store.update({content: 'Updated content', id: original.id})

      const serialized = store.serialize()
      const restored = new MemoryStore()
      restored.deserialize(serialized)

      const entry = restored.read(original.id)!
      expect(entry.title).to.equal('Full roundtrip')
      expect(entry.content).to.equal('Updated content')
      expect(entry.tags).to.deep.equal(['test'])
      expect(entry.importance).to.equal(80) // 75 + 5 from update
      expect(entry.update_count).to.equal(1)
      expect(entry.write_sequence).to.equal(2) // bumped by update
      expect(entry.status).to.equal('active')
      expect(entry.entry_type).to.equal('raw')
    })

    it('deserialized store uses restored config for search behavior', () => {
      // Create a store with a very high min_relevance that blocks all results
      const strictStore = new MemoryStore({scoring: {min_relevance: 0.99}})
      strictStore.write({content: 'This should be blocked by OOD floor', title: 'Blocked entry'})

      // Verify the strict config blocks search
      expect(strictStore.search({query: 'blocked entry'})).to.deep.equal([])

      // Serialize and deserialize into a default store
      const serialized = strictStore.serialize()
      const restored = new MemoryStore() // default min_relevance = 0.45
      restored.deserialize(serialized)

      // The restored store should use the strict config (0.99), not the default (0.45)
      expect(restored.search({query: 'blocked entry'})).to.deep.equal([])
    })
  })
})
