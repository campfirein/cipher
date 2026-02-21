import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {CurateLogEntry} from '../../../../src/server/core/domain/entities/curate-log-entry.js'

import {FileCurateLogStore} from '../../../../src/server/infra/storage/file-curate-log-store.js'

function makeEntry(overrides: Partial<CurateLogEntry> & {id: string}): CurateLogEntry {
  return {
    input: {},
    operations: [],
    startedAt: Date.now(),
    status: 'processing',
    summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    taskId: `task-${overrides.id}`,
    ...overrides,
  } as CurateLogEntry
}

describe('FileCurateLogStore', () => {
  let tempDir: string
  let store: FileCurateLogStore

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-curate-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    store = new FileCurateLogStore({baseDir: tempDir})
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  // ==========================================================================
  // getNextId
  // ==========================================================================

  describe('getNextId', () => {
    it('should return a cur-{timestamp} formatted ID', async () => {
      const id = await store.getNextId()
      expect(id).to.match(/^cur-\d+$/)
    })

    it('should return monotonically increasing IDs in the same millisecond', async () => {
      // Get several IDs rapidly (sequential, not parallel, to test monotonic guarantee)
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
      const entry: CurateLogEntry = {
        completedAt: Date.now(),
        id,
        input: {context: 'test context', files: ['src/auth.ts']},
        operations: [{path: '/a.md', status: 'success', type: 'ADD'}],
        response: 'Done!',
        startedAt: Date.now() - 1000,
        status: 'completed',
        summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-1',
      }

      await store.save(entry)
      const retrieved = await store.getById(id)

      expect(retrieved).to.deep.equal(entry)
      expect(retrieved?.status).to.equal('completed')
    })

    it('should save an error entry', async () => {
      const id = await store.getNextId()
      const entry: CurateLogEntry = {
        completedAt: Date.now(),
        error: 'Something went wrong',
        id,
        input: {},
        operations: [],
        startedAt: Date.now() - 500,
        status: 'error',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-err',
      }

      await store.save(entry)
      const retrieved = await store.getById(id)

      expect(retrieved?.status).to.equal('error')
      const errorEntry = retrieved as null | {error?: string; status: string}
      expect(errorEntry?.error).to.equal('Something went wrong')
    })

    it('should return null for non-existent ID', async () => {
      const id = await store.getNextId()
      const result = await store.getById(id)
      expect(result).to.be.null
    })

    it('should return null for corrupted file', async () => {
      const id = await store.getNextId()
      const entry = makeEntry({id})
      await store.save(entry)

      // Corrupt the file
      const logDir = join(tempDir, 'curate-log')
      await writeFile(join(logDir, `${id}.json`), 'not valid json {{{')

      const result = await store.getById(id)
      expect(result).to.be.null
    })

    it('should return null for Zod-invalid file content', async () => {
      const id = await store.getNextId()
      const logDir = join(tempDir, 'curate-log')
      await mkdir(logDir, {recursive: true})

      // Valid JSON but missing required fields
      await writeFile(join(logDir, `${id}.json`), JSON.stringify({id, status: 'unknown_status'}))

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
      const e1 = makeEntry({id: id1, startedAt: now - 3000})
      const e2 = makeEntry({id: id2, startedAt: now - 2000})
      const e3 = makeEntry({id: id3, startedAt: now - 1000})

      await store.save(e1)
      await store.save(e2)
      await store.save(e3)

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

    it('should skip corrupted entries silently', async () => {
      const id1 = await store.getNextId()
      const id2 = await store.getNextId()

      await store.save(makeEntry({id: id1}))
      await store.save(makeEntry({id: id2}))

      // Corrupt first entry
      const logDir = join(tempDir, 'curate-log')
      await writeFile(join(logDir, `${id1}.json`), 'corrupted')

      const entries = await store.list()
      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal(id2)
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
        input: {},
        operations: [],
        response: 'ok',
        startedAt: now - 2000,
        status: 'completed',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-c',
      })
      await store.save({
        completedAt: now - 500,
        error: 'oops',
        id: idError,
        input: {},
        operations: [],
        startedAt: now - 1500,
        status: 'error',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-e',
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

      // Save 3 completed entries (sequential to get monotonic IDs)
      const completedIds = await Promise.all([store.getNextId(), store.getNextId(), store.getNextId()])
      await Promise.all(
        completedIds.map((id, i) =>
          store.save({
            completedAt: now - i * 1000,
            id,
            input: {},
            operations: [],
            startedAt: now - i * 1000 - 500,
            status: 'completed',
            summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
            taskId: `task-${i}`,
          }),
        ),
      )

      // Also save 1 processing entry
      const processingId = await store.getNextId()
      await store.save(makeEntry({id: processingId, startedAt: now - 10_000, status: 'processing'}))

      // Filter by completed, limit 2
      const entries = await store.list({limit: 2, status: ['completed']})
      expect(entries).to.have.lengthOf(2)
      for (const e of entries) {
        expect(e.status).to.equal('completed')
      }
    })
  })

  // ==========================================================================
  // pruning
  // ==========================================================================

  describe('pruning', () => {
    it('should prune oldest entries when maxEntries is exceeded', async () => {
      const storeWithLimit = new FileCurateLogStore({baseDir: tempDir, maxEntries: 3})

      const saveEntry = async (): Promise<string> => {
        const id = await storeWithLimit.getNextId()
        await storeWithLimit.save(makeEntry({id}))
        return id
      }

      const ids = [await saveEntry(), await saveEntry(), await saveEntry(), await saveEntry(), await saveEntry()]

      // Allow prune to settle
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      // Only the 3 newest should remain
      const newest = ids.slice(2) // ids[2], ids[3], ids[4]
      const oldest = ids.slice(0, 2) // ids[0], ids[1]

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

      const logDir = join(tempDir, 'curate-log')
      const dirContents = await import('node:fs/promises').then((fs) => fs.readdir(logDir))
      const tmpFiles = dirContents.filter((f: string) => f.endsWith('.tmp'))
      expect(tmpFiles).to.have.lengthOf(0)
    })

    it('should overwrite existing entry (idempotent save)', async () => {
      const id = await store.getNextId()
      const first = makeEntry({id, status: 'processing'})
      await store.save(first)

      const updated: CurateLogEntry = {
        completedAt: Date.now(),
        id,
        input: {},
        operations: [],
        response: 'Final answer',
        startedAt: first.startedAt,
        status: 'completed',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: first.taskId,
      }
      await store.save(updated)

      const retrieved = await store.getById(id)
      expect(retrieved?.status).to.equal('completed')
      const completedEntry = retrieved as null | {response?: string; status: string}
      expect(completedEntry?.response).to.equal('Final answer')
    })
  })
})
