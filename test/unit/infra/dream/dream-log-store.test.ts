import {expect} from 'chai'
import {mkdir, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {DreamLogEntry} from '../../../../src/server/infra/dream/dream-log-schema.js'

import {DreamLogStore} from '../../../../src/server/infra/dream/dream-log-store.js'

function makeEntry(overrides: Partial<DreamLogEntry> & {id: string}): DreamLogEntry {
  return {
    operations: [],
    startedAt: Date.now(),
    status: 'processing',
    summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
    trigger: 'agent-idle',
    ...overrides,
  } as DreamLogEntry
}

describe('DreamLogStore', () => {
  let tempDir: string
  let store: DreamLogStore

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-dream-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    store = new DreamLogStore({baseDir: tempDir})
  })

  afterEach(async () => {
    // Allow async prune/resolveStale to settle before cleanup
    await new Promise(resolve => {
      setTimeout(resolve, 50)
    })
    await rm(tempDir, {force: true, recursive: true})
  })

  // ==========================================================================
  // getNextId
  // ==========================================================================

  describe('getNextId', () => {
    it('should return a drm-{timestamp} formatted ID', async () => {
      const id = await store.getNextId()
      expect(id).to.match(/^drm-\d+$/)
    })

    it('should return monotonically increasing IDs', async () => {
      const ids = [
        await store.getNextId(),
        await store.getNextId(),
        await store.getNextId(),
        await store.getNextId(),
        await store.getNextId(),
      ]

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
    it('should save and retrieve an entry', async () => {
      const id = await store.getNextId()
      const entry = makeEntry({id})

      await store.save(entry)
      const retrieved = await store.getById(id)
      expect(retrieved).to.deep.equal(entry)
    })

    it('should save a completed entry with all fields', async () => {
      const id = await store.getNextId()
      const entry: DreamLogEntry = {
        completedAt: Date.now(),
        id,
        operations: [
          {
            action: 'MERGE',
            inputFiles: ['a.md', 'b.md'],
            needsReview: true,
            outputFile: 'a.md',
            previousTexts: {'a.md': 'old a', 'b.md': 'old b'},
            reason: 'duplicate',
            type: 'CONSOLIDATE',
          },
        ],
        startedAt: Date.now() - 1000,
        status: 'completed',
        summary: {consolidated: 1, errors: 0, flaggedForReview: 1, pruned: 0, synthesized: 0},
        trigger: 'agent-idle',
      }

      await store.save(entry)
      const retrieved = await store.getById(id)
      expect(retrieved).to.deep.equal(entry)
      expect(retrieved?.status).to.equal('completed')
    })

    it('should save an error entry', async () => {
      const id = await store.getNextId()
      const entry: DreamLogEntry = {
        completedAt: Date.now(),
        error: 'Something went wrong',
        id,
        operations: [],
        startedAt: Date.now() - 500,
        status: 'error',
        summary: {consolidated: 0, errors: 1, flaggedForReview: 0, pruned: 0, synthesized: 0},
        trigger: 'cli',
      }

      await store.save(entry)
      const retrieved = await store.getById(id)
      expect(retrieved?.status).to.equal('error')
      expect((retrieved as {error?: string}).error).to.equal('Something went wrong')
    })

    it('should create log directory if missing', async () => {
      const id = await store.getNextId()
      await store.save(makeEntry({id}))

      const logDir = join(tempDir, 'dream-log')
      const files = await readdir(logDir)
      expect(files.some(f => f.includes(id))).to.be.true
    })

    it('should return null for non-existent ID', async () => {
      const result = await store.getById('drm-9999999999999')
      expect(result).to.be.null
    })

    it('should return null for corrupted file', async () => {
      const id = await store.getNextId()
      await store.save(makeEntry({id}))

      const logDir = join(tempDir, 'dream-log')
      await writeFile(join(logDir, `${id}.json`), 'not valid json {{{')

      const result = await store.getById(id)
      expect(result).to.be.null
    })

    it('should return null for Zod-invalid file content', async () => {
      const id = await store.getNextId()
      const logDir = join(tempDir, 'dream-log')
      await mkdir(logDir, {recursive: true})

      await writeFile(join(logDir, `${id}.json`), JSON.stringify({id, status: 'unknown'}))

      const result = await store.getById(id)
      expect(result).to.be.null
    })

    it('should return null for path traversal attempt', async () => {
      const result = await store.getById('../../../etc/passwd')
      expect(result).to.be.null
    })

    it('should return null for ID with wrong prefix', async () => {
      const result = await store.getById('bad-12345')
      expect(result).to.be.null
    })
  })

  // ==========================================================================
  // list
  // ==========================================================================

  describe('list', () => {
    it('should return empty array when no entries', async () => {
      const entries = await store.list()
      expect(entries).to.have.lengthOf(0)
    })

    it('should return entries sorted newest-first', async () => {
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

    it('should respect limit', async () => {
      const saveEntry = async (): Promise<void> => {
        const id = await store.getNextId()
        await store.save(makeEntry({id}))
      }

      await saveEntry()
      await saveEntry()
      await saveEntry()
      await saveEntry()
      await saveEntry()

      const entries = await store.list({limit: 3})
      expect(entries).to.have.lengthOf(3)
    })

    it('should filter by status', async () => {
      const now = Date.now()
      const idProcessing = await store.getNextId()
      const idCompleted = await store.getNextId()
      const idError = await store.getNextId()

      await store.save(makeEntry({id: idProcessing, startedAt: now - 3000, status: 'processing'}))
      await store.save({
        completedAt: now - 1000,
        id: idCompleted,
        operations: [],
        startedAt: now - 2000,
        status: 'completed',
        summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
        trigger: 'agent-idle',
      })
      await store.save({
        completedAt: now - 500,
        error: 'oops',
        id: idError,
        operations: [],
        startedAt: now - 1500,
        status: 'error',
        summary: {consolidated: 0, errors: 1, flaggedForReview: 0, pruned: 0, synthesized: 0},
        trigger: 'agent-idle',
      })

      const completedOnly = await store.list({status: ['completed']})
      expect(completedOnly).to.have.lengthOf(1)
      expect(completedOnly[0].id).to.equal(idCompleted)

      const both = await store.list({status: ['completed', 'error']})
      expect(both).to.have.lengthOf(2)
    })

    it('should filter by after (startedAt >= after)', async () => {
      const base = Date.now()
      const idOld = await store.getNextId()
      const idNew = await store.getNextId()

      await store.save(makeEntry({id: idOld, startedAt: base - 5000}))
      await store.save(makeEntry({id: idNew, startedAt: base - 1000}))

      const entries = await store.list({after: base - 3000})
      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal(idNew)
    })

    it('should filter by before (startedAt <= before)', async () => {
      const base = Date.now()
      const idOld = await store.getNextId()
      const idNew = await store.getNextId()

      await store.save(makeEntry({id: idOld, startedAt: base - 5000}))
      await store.save(makeEntry({id: idNew, startedAt: base - 1000}))

      const entries = await store.list({before: base - 3000})
      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal(idOld)
    })

    it('should apply limit after filtering', async () => {
      const now = Date.now()

      // Save 3 completed entries (sequential for monotonic IDs)
      const completedIds = [await store.getNextId(), await store.getNextId(), await store.getNextId()]
      await Promise.all(
        completedIds.map((id, i) =>
          store.save({
            completedAt: now - i * 1000,
            id,
            operations: [],
            startedAt: now - i * 1000 - 500,
            status: 'completed',
            summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
            trigger: 'agent-idle',
          }),
        ),
      )

      // Also save 1 processing entry
      const processingId = await store.getNextId()
      await store.save(makeEntry({id: processingId, startedAt: now - 10_000}))

      const entries = await store.list({limit: 2, status: ['completed']})
      expect(entries).to.have.lengthOf(2)
      for (const e of entries) {
        expect(e.status).to.equal('completed')
      }
    })

    it('should skip corrupted entries silently', async () => {
      const id1 = await store.getNextId()
      const id2 = await store.getNextId()

      await store.save(makeEntry({id: id1}))
      await store.save(makeEntry({id: id2}))

      const logDir = join(tempDir, 'dream-log')
      await writeFile(join(logDir, `${id1}.json`), 'corrupted')

      const entries = await store.list()
      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal(id2)
    })
  })

  // ==========================================================================
  // pruning
  // ==========================================================================

  describe('pruning', () => {
    it('should prune oldest entries when maxEntries is exceeded', async () => {
      const storeWithLimit = new DreamLogStore({baseDir: tempDir, maxEntries: 3})

      const saveEntry = async (): Promise<string> => {
        const id = await storeWithLimit.getNextId()
        await storeWithLimit.save(makeEntry({id}))
        return id
      }

      const ids = [await saveEntry(), await saveEntry(), await saveEntry(), await saveEntry(), await saveEntry()]

      // Allow async prune to settle
      await new Promise(resolve => {
        setTimeout(resolve, 50)
      })

      const newest = ids.slice(2)
      const oldest = ids.slice(0, 2)

      const newestResults = await Promise.all(newest.map((id) => storeWithLimit.getById(id)))
      const oldestResults = await Promise.all(oldest.map((id) => storeWithLimit.getById(id)))

      for (const result of newestResults) {
        expect(result).to.not.be.null
      }

      for (const result of oldestResults) {
        expect(result).to.be.null
      }
    })
  })

  // ==========================================================================
  // atomic write
  // ==========================================================================

  describe('atomic write', () => {
    it('should not leave tmp files after successful save', async () => {
      const id = await store.getNextId()
      await store.save(makeEntry({id}))

      const logDir = join(tempDir, 'dream-log')
      const files = await readdir(logDir)
      const tmpFiles = files.filter(f => f.endsWith('.tmp'))
      expect(tmpFiles).to.have.lengthOf(0)
    })

    it('should overwrite existing entry (idempotent save)', async () => {
      const id = await store.getNextId()
      const first = makeEntry({id, status: 'processing'})
      await store.save(first)

      const updated: DreamLogEntry = {
        completedAt: Date.now(),
        id,
        operations: [],
        startedAt: first.startedAt,
        status: 'completed',
        summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
        trigger: 'agent-idle',
      }
      await store.save(updated)

      const retrieved = await store.getById(id)
      expect(retrieved?.status).to.equal('completed')
    })
  })

  // ==========================================================================
  // stale processing resolution
  // ==========================================================================

  describe('stale processing resolution', () => {
    it('should resolve stale processing entry to error', async () => {
      const id = await store.getNextId()
      // startedAt 15 min ago — well past 10 min threshold
      const entry = makeEntry({id, startedAt: Date.now() - 15 * 60 * 1000, status: 'processing'})
      await store.save(entry)

      const retrieved = await store.getById(id)
      expect(retrieved?.status).to.equal('error')
      expect((retrieved as {error?: string}).error).to.include('Interrupted')
    })

    it('should not resolve fresh processing entry', async () => {
      const id = await store.getNextId()
      const entry = makeEntry({id, startedAt: Date.now(), status: 'processing'})
      await store.save(entry)

      const retrieved = await store.getById(id)
      expect(retrieved?.status).to.equal('processing')
    })
  })
})
