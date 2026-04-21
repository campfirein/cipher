import {expect} from 'chai'
import {mkdir, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {QueryLogEntry} from '../../../../src/server/core/domain/entities/query-log-entry.js'

import {FileQueryLogStore} from '../../../../src/server/infra/storage/file-query-log-store.js'

type ProcessingEntry = Extract<QueryLogEntry, {status: 'processing'}>

function makeEntry(overrides: Partial<ProcessingEntry> & {id: string}): ProcessingEntry {
  return {
    matchedDocs: [],
    query: 'test query',
    startedAt: Date.now(),
    status: 'processing',
    taskId: `task-${overrides.id}`,
    ...overrides,
  }
}

async function saveEntries(
  s: FileQueryLogStore,
  count: number,
  overrides?: (i: number) => Partial<ProcessingEntry>,
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    const id = await s.getNextId()
    // eslint-disable-next-line no-await-in-loop
    await s.save(makeEntry({id, ...overrides?.(i)}))
    ids.push(id)
  }

  return ids
}

async function generateIds(s: FileQueryLogStore, count: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    ids.push(await s.getNextId())
  }

  return ids
}

/**
 * Poll until the .json file count in dir stabilises. Requires 5 consecutive
 * stable readings (25ms of no change) to avoid a race under slow CI where the
 * async prune hasn't started yet — two consecutive identical pre-prune counts
 * would otherwise declare "settled" before any work happened.
 */
async function waitForPruneToSettle(dir: string): Promise<void> {
  const count = async (): Promise<number> => {
    try {
      const files = await readdir(dir)
      return files.filter((f) => f.endsWith('.json')).length
    } catch {
      return 0
    }
  }

  let stable = 0
  let prev = await count()
  for (let i = 0; i < 200; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => {
      setTimeout(r, 5)
    })
    // eslint-disable-next-line no-await-in-loop
    const cur = await count()
    if (cur === prev) {
      stable++
      if (stable >= 5) return
    } else {
      stable = 0
    }

    prev = cur
  }
}

describe('FileQueryLogStore', () => {
  let store: FileQueryLogStore
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-query-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    store = new FileQueryLogStore({baseDir: tempDir})
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  // ==========================================================================
  // getNextId
  // ==========================================================================

  describe('getNextId', () => {
    // Test 1
    it('should return a qry-{timestamp} formatted ID', async () => {
      const id = await store.getNextId()
      expect(id).to.match(/^qry-\d+$/)
    })

    // Test 2
    it('should return monotonically increasing IDs in the same millisecond', async () => {
      const ids = await generateIds(store, 5)

      for (let i = 1; i < ids.length; i++) {
        const prev = Number(ids[i - 1].slice(4))
        const curr = Number(ids[i].slice(4))
        expect(curr).to.be.greaterThan(prev)
      }
    })
  })

  // ==========================================================================
  // save + getById
  // ==========================================================================

  describe('save + getById', () => {
    // Test 3
    it('should round-trip a processing entry', async () => {
      const id = await store.getNextId()
      const entry = makeEntry({id})

      await store.save(entry)
      const retrieved = await store.getById(id)

      expect(retrieved).to.deep.equal(entry)
    })

    // Test 4
    it('should round-trip a completed entry with all fields', async () => {
      const id = await store.getNextId()
      const entry: QueryLogEntry = {
        completedAt: Date.now(),
        id,
        matchedDocs: [
          {path: 'auth/oauth.md', score: 0.92, title: 'OAuth Flow'},
          {path: 'auth/tokens.md', score: 0.87, title: 'Token Storage'},
        ],
        query: 'How is auth implemented?',
        response: 'Auth uses OAuth2 with JWT.',
        searchMetadata: {
          cacheFingerprint: 'abc123',
          resultCount: 2,
          topScore: 0.92,
          totalFound: 5,
        },
        startedAt: Date.now() - 1000,
        status: 'completed',
        taskId: 'task-1',
        tier: 0,
        timing: {durationMs: 12},
      }

      await store.save(entry)
      const retrieved = await store.getById(id)

      expect(retrieved).to.deep.equal(entry)
      expect(retrieved?.status).to.equal('completed')
    })

    // Test 5
    it('should return undefined for invalid ID format (path traversal)', async () => {
      expect(await store.getById('../../../etc/passwd')).to.be.undefined
      expect(await store.getById('bad-12345')).to.be.undefined
    })

    // Test 6
    it('should return undefined for corrupt JSON file', async () => {
      const id = await store.getNextId()
      await store.save(makeEntry({id}))

      const logDir = join(tempDir, 'query-log')
      await writeFile(join(logDir, `${id}.json`), 'not valid json {{{')

      expect(await store.getById(id)).to.be.undefined
    })

    // Test 6b (Zod validation branch)
    it('should return undefined for valid JSON that fails Zod schema', async () => {
      const id = await store.getNextId()
      await store.save(makeEntry({id}))

      const logDir = join(tempDir, 'query-log')
      // Valid JSON, but status is not in the discriminated union
      await writeFile(join(logDir, `${id}.json`), JSON.stringify({id, status: 'unknown_status'}))

      expect(await store.getById(id)).to.be.undefined
    })

    // Test 7
    it('should return undefined for non-existent ID', async () => {
      const id = await store.getNextId()
      expect(await store.getById(id)).to.be.undefined
    })

    // Test 17
    it('should create directory if it does not exist', async () => {
      const freshDir = join(tmpdir(), `brv-query-log-fresh-${Date.now()}`)
      const freshStore = new FileQueryLogStore({baseDir: freshDir})

      try {
        const id = await freshStore.getNextId()
        await freshStore.save(makeEntry({id}))
        const retrieved = await freshStore.getById(id)
        expect(retrieved).to.not.be.undefined
      } finally {
        await rm(freshDir, {force: true, recursive: true})
      }
    })
  })

  // ==========================================================================
  // list
  // ==========================================================================

  describe('list', () => {
    // Test 8
    it('should return entries newest-first', async () => {
      const id1 = await store.getNextId()
      const id2 = await store.getNextId()
      const id3 = await store.getNextId()

      const now = Date.now()
      await store.save(makeEntry({id: id1, startedAt: now - 3000}))
      await store.save(makeEntry({id: id2, startedAt: now - 2000}))
      await store.save(makeEntry({id: id3, startedAt: now - 1000}))

      const entries = await store.list()

      expect(entries).to.have.lengthOf(3)
      expect(entries[0].id).to.equal(id3)
      expect(entries[1].id).to.equal(id2)
      expect(entries[2].id).to.equal(id1)
    })

    // Test 9
    it('should filter by status (single and multiple)', async () => {
      const now = Date.now()
      const idProc = await store.getNextId()
      const idComp = await store.getNextId()
      const idErr = await store.getNextId()

      await store.save(makeEntry({id: idProc, startedAt: now - 3000}))
      await store.save({
        completedAt: now,
        id: idComp,
        matchedDocs: [],
        query: 'q',
        startedAt: now - 2000,
        status: 'completed',
        taskId: 'task-c',
      })
      await store.save({
        completedAt: now,
        error: 'oops',
        id: idErr,
        matchedDocs: [],
        query: 'q',
        startedAt: now - 1000,
        status: 'error',
        taskId: 'task-e',
      })

      const completedOnly = await store.list({status: ['completed']})
      expect(completedOnly).to.have.lengthOf(1)
      expect(completedOnly[0].id).to.equal(idComp)

      const both = await store.list({status: ['completed', 'error']})
      expect(both).to.have.lengthOf(2)
    })

    // Test 10
    it('should filter by tier', async () => {
      const now = Date.now()
      const idT0 = await store.getNextId()
      const idT2 = await store.getNextId()
      const idNone = await store.getNextId()

      await store.save(makeEntry({id: idT0, startedAt: now - 3000, tier: 0}))
      await store.save(makeEntry({id: idT2, startedAt: now - 2000, tier: 2}))
      await store.save(makeEntry({id: idNone, startedAt: now - 1000})) // no tier

      const tier0 = await store.list({tier: [0]})
      expect(tier0).to.have.lengthOf(1)
      expect(tier0[0].id).to.equal(idT0)

      const tier02 = await store.list({tier: [0, 2]})
      expect(tier02).to.have.lengthOf(2)
    })

    // Test 11
    it('should filter by after/before time', async () => {
      const base = Date.now()
      const idOld = await store.getNextId()
      const idNew = await store.getNextId()

      await store.save(makeEntry({id: idOld, startedAt: base - 5000}))
      await store.save(makeEntry({id: idNew, startedAt: base - 1000}))

      const afterEntries = await store.list({after: base - 3000})
      expect(afterEntries).to.have.lengthOf(1)
      expect(afterEntries[0].id).to.equal(idNew)

      const beforeEntries = await store.list({before: base - 3000})
      expect(beforeEntries).to.have.lengthOf(1)
      expect(beforeEntries[0].id).to.equal(idOld)
    })

    // Test 12
    it('should respect limit', async () => {
      await saveEntries(store, 5)

      const entries = await store.list({limit: 3})
      expect(entries).to.have.lengthOf(3)
    })

    // Test 13
    it('should apply combined filters', async () => {
      const now = Date.now()
      const ids = await generateIds(store, 4)

      await store.save(makeEntry({id: ids[0], startedAt: now - 5000, tier: 0}))
      await store.save(makeEntry({id: ids[1], startedAt: now - 3000, tier: 0}))
      await store.save(makeEntry({id: ids[2], startedAt: now - 1000, tier: 2}))
      await store.save(makeEntry({id: ids[3], startedAt: now - 500, tier: 0}))

      // tier=0, after=now-4000, limit=1
      const entries = await store.list({after: now - 4000, limit: 1, tier: [0]})
      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal(ids[3])
    })
  })

  // ==========================================================================
  // pruning
  // ==========================================================================

  describe('pruning', () => {
    // Test 14
    it('should prune oldest entries beyond maxEntries', async () => {
      const storeWithLimit = new FileQueryLogStore({baseDir: tempDir, maxEntries: 3})
      const ids = await saveEntries(storeWithLimit, 5)

      await waitForPruneToSettle(join(tempDir, 'query-log'))

      const newest = ids.slice(2)
      const oldest = ids.slice(0, 2)

      const newestResults = await Promise.all(newest.map((id) => storeWithLimit.getById(id)))
      const oldestResults = await Promise.all(oldest.map((id) => storeWithLimit.getById(id)))

      for (const result of newestResults) {
        expect(result).to.not.be.undefined
      }

      for (const result of oldestResults) {
        expect(result).to.be.undefined
      }
    })

    // Test 18
    it('should delete entries older than maxAgeDays', async () => {
      const storeWithAge = new FileQueryLogStore({baseDir: tempDir, maxAgeDays: 7})

      // IDs are constructed directly (not via getNextId) to control filename timestamps.
      // Age-based pruning extracts the timestamp from the filename (qry-{ts}.json),
      // not from entry.startedAt. Bypassing getNextId is intentional here — it's the only
      // way to test pruning of "old" entries without waiting actual days.
      const oldTs = Date.now() - 10 * 86_400_000
      const recentTs = Date.now() - 1 * 86_400_000
      const idOld = `qry-${oldTs}`
      const idRecent = `qry-${recentTs}`

      await storeWithAge.save(makeEntry({id: idOld, startedAt: oldTs}))
      await storeWithAge.save(makeEntry({id: idRecent, startedAt: recentTs}))

      await waitForPruneToSettle(join(tempDir, 'query-log'))

      expect(await storeWithAge.getById(idOld)).to.be.undefined
      expect(await storeWithAge.getById(idRecent)).to.not.be.undefined
    })

    // Test 19
    it('should apply count limit after age-based pruning', async () => {
      const storeWithBoth = new FileQueryLogStore({baseDir: tempDir, maxAgeDays: 30, maxEntries: 2})
      const now = Date.now()
      // Note: count-based pruning is FILENAME-order, not startedAt-order.
      // ids[0] is generated first → smallest filename timestamp → pruned first.
      // The startedAt overrides are not used by the pruning logic; they only affect entry data.
      // All 4 entries are within 30 days, so age pruning is a no-op; count pruning keeps newest 2 by filename.
      const ids = await saveEntries(storeWithBoth, 4, (i) => ({startedAt: now - i * 1000}))

      await waitForPruneToSettle(join(tempDir, 'query-log'))

      // Oldest 2 by filename (ids[0], ids[1]) are pruned; newest 2 by filename (ids[2], ids[3]) kept.
      expect(await storeWithBoth.getById(ids[0])).to.be.undefined
      expect(await storeWithBoth.getById(ids[1])).to.be.undefined
      expect(await storeWithBoth.getById(ids[2])).to.not.be.undefined
      expect(await storeWithBoth.getById(ids[3])).to.not.be.undefined
    })

    // Test 20
    it('should disable age-based pruning when maxAgeDays is 0', async () => {
      const storeNoAge = new FileQueryLogStore({baseDir: tempDir, maxAgeDays: 0, maxEntries: 100})

      const oldTs = Date.now() - 60 * 86_400_000
      const idOld = `qry-${oldTs}`
      await storeNoAge.save(makeEntry({id: idOld, startedAt: oldTs}))

      await waitForPruneToSettle(join(tempDir, 'query-log'))

      expect(await storeNoAge.getById(idOld)).to.not.be.undefined
    })

    // Test 21
    it('should not prune at old limit (200) and should prune at new limit (1000)', async function () {
      this.timeout(30_000)

      const logDir = join(tempDir, 'query-log')
      await mkdir(logDir, {recursive: true})

      // Helper: seed N files directly on disk (parallel writes, no store overhead)
      const seedFiles = async (startTs: number, count: number): Promise<void> => {
        const writes: Promise<void>[] = []
        for (let i = 0; i < count; i++) {
          const ts = startTs + i
          const id = `qry-${ts}`
          const entry = {
            completedAt: ts + 1,
            id,
            matchedDocs: [],
            query: 'test query',
            startedAt: ts,
            status: 'completed',
            taskId: `task-${id}`,
          }

          writes.push(writeFile(join(logDir, `${id}.json`), JSON.stringify(entry)))
        }

        await Promise.all(writes)
      }

      const countFiles = async (): Promise<number> => {
        const files = await readdir(logDir)
        return files.filter((f: string) => f.endsWith('.json')).length
      }

      // Use recent timestamps to avoid age-based pruning (DEFAULT_MAX_AGE_DAYS = 30)
      const baseTs = Date.now() - 500_000

      // Phase 1: Seed 199 files on disk, then save entry #200 via store
      // Old limit was 200 — must NOT prune
      await seedFiles(baseTs, 199)
      const store200 = new FileQueryLogStore({baseDir: tempDir})
      const id200 = `qry-${baseTs + 199}`
      await store200.save(makeEntry({id: id200, startedAt: baseTs + 199}))
      await waitForPruneToSettle(logDir)

      expect(await countFiles()).to.equal(200)
      expect(await store200.getById(`qry-${baseTs}`)).to.not.be.undefined // oldest survives

      // Phase 2: Seed up to 999 files, then save entry #1000 via store
      // New limit is 1000 — must NOT prune at boundary
      await seedFiles(baseTs + 200, 799)
      const store1000 = new FileQueryLogStore({baseDir: tempDir})
      const id1000 = `qry-${baseTs + 999}`
      await store1000.save(makeEntry({id: id1000, startedAt: baseTs + 999}))
      await waitForPruneToSettle(logDir)

      expect(await countFiles()).to.equal(1000)
      expect(await store1000.getById(`qry-${baseTs}`)).to.not.be.undefined // oldest still survives

      // Phase 3: Save entry #1001 via store — exceeds new limit, oldest must be pruned
      const store1001 = new FileQueryLogStore({baseDir: tempDir})
      const id1001 = `qry-${baseTs + 1000}`
      await store1001.save(makeEntry({id: id1001, startedAt: baseTs + 1000}))
      await waitForPruneToSettle(logDir)

      expect(await countFiles()).to.equal(1000)
      expect(await store1001.getById(`qry-${baseTs}`)).to.be.undefined // oldest pruned
      expect(await store1001.getById(`qry-${baseTs + 1}`)).to.not.be.undefined // second oldest survives
      expect(await store1001.getById(id1001)).to.not.be.undefined // newest survives
    })
  })

  // ==========================================================================
  // stale processing recovery
  // ==========================================================================

  describe('stale processing recovery', () => {
    // Test 15
    it('should resolve stale processing entries to error after 10 minutes', async () => {
      const id = await store.getNextId()
      const staleEntry = makeEntry({id, startedAt: Date.now() - 11 * 60 * 1000})

      await store.save(staleEntry)
      const retrieved = await store.getById(id)

      expect(retrieved?.status).to.equal('error')
      if (retrieved?.status === 'error') {
        expect(retrieved.error).to.include('Interrupted')
      }

      // Verify on-disk persistence: fresh store instance should read the recovered entry
      await waitForPruneToSettle(join(tempDir, 'query-log'))
      const freshStore = new FileQueryLogStore({baseDir: tempDir})
      const persisted = await freshStore.getById(id)
      expect(persisted?.status).to.equal('error')
    })
  })

  // ==========================================================================
  // atomic write
  // ==========================================================================

  describe('atomic write', () => {
    // Test 16
    it('should not leave tmp files after successful save', async () => {
      const id = await store.getNextId()
      await store.save(makeEntry({id}))

      const logDir = join(tempDir, 'query-log')
      const contents = await readdir(logDir)
      const tmpFiles = contents.filter((f) => f.endsWith('.tmp'))
      expect(tmpFiles).to.have.lengthOf(0)
    })
  })
})
