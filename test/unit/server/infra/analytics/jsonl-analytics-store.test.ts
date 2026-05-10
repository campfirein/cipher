/* eslint-disable camelcase */
import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {StoredAnalyticsRecord} from '../../../../../src/server/core/domain/analytics/stored-record.js'

import {MAX_ATTEMPTS, StoredAnalyticsRecordSchema} from '../../../../../src/server/core/domain/analytics/stored-record.js'
import {JsonlAnalyticsStore} from '../../../../../src/server/infra/analytics/jsonl-analytics-store.js'

const validIdentity = {
  device_id: '550e8400-e29b-41d4-a716-446655440000',
}

async function freshTempDir(): Promise<string> {
  const dir = join(tmpdir(), `jsonl-store-${randomUUID()}`)
  await mkdir(dir, {recursive: true})
  return dir
}

function makeRecord(overrides: Partial<StoredAnalyticsRecord> = {}): StoredAnalyticsRecord {
  return {
    attempts: 0,
    id: randomUUID(),
    identity: validIdentity,
    name: 'cli_invocation',
    properties: {},
    status: 'pending',
    timestamp: Date.now(),
    ...overrides,
  }
}

async function readJsonlRows(filePath: string): Promise<StoredAnalyticsRecord[]> {
  try {
    const content = await readFile(filePath, 'utf8')
    const records: StoredAnalyticsRecord[] = []
    for (const line of content.split('\n')) {
      if (line.length === 0) continue
      const parsed = StoredAnalyticsRecordSchema.parse(JSON.parse(line))
      records.push(parsed)
    }

    return records
  } catch {
    return []
  }
}

function findRow(rows: StoredAnalyticsRecord[], id: string): StoredAnalyticsRecord {
  const row = rows.find((r) => r.id === id)
  if (row === undefined) throw new Error(`expected row with id=${id}`)
  return row
}

describe('JsonlAnalyticsStore', () => {
  describe('append()', () => {
    it('should write one row plus newline to a fresh file', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      const record = makeRecord({id: 'rec-1', name: 'event-a'})

      await store.append(record)

      const filePath = join(baseDir, 'analytics-queue.jsonl')
      const content = await readFile(filePath, 'utf8')
      expect(content.endsWith('\n')).to.equal(true)
      expect(content.split('\n').filter((l) => l.length > 0)).to.have.lengthOf(1)
      const rows = await readJsonlRows(filePath)
      expect(rows[0].id).to.equal('rec-1')
      expect(rows[0].name).to.equal('event-a')
    })

    it('should append multiple rows in arrival order', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})

      await store.append(makeRecord({id: 'r1'}))
      await store.append(makeRecord({id: 'r2'}))
      await store.append(makeRecord({id: 'r3'}))

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows.map((r) => r.id)).to.deep.equal(['r1', 'r2', 'r3'])
    })

    it('should create the base directory if it does not exist', async () => {
      const parent = await freshTempDir()
      const baseDir = join(parent, 'nested', 'path')
      const store = new JsonlAnalyticsStore({baseDir})

      await store.append(makeRecord({id: 'r1'}))

      const stats = await stat(join(baseDir, 'analytics-queue.jsonl'))
      expect(stats.isFile()).to.equal(true)
    })
  })

  describe("updateStatus(ids, 'sent')", () => {
    it('should flip status to sent and leave attempts unchanged', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({attempts: 1, id: 'r1', status: 'pending'}))

      await store.updateStatus(['r1'], 'sent')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('sent')
      expect(rows[0].attempts).to.equal(1)
    })

    it('should leave other rows untouched', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))
      await store.append(makeRecord({id: 'r2'}))
      await store.append(makeRecord({id: 'r3'}))

      await store.updateStatus(['r2'], 'sent')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(findRow(rows, 'r1').status).to.equal('pending')
      expect(findRow(rows, 'r2').status).to.equal('sent')
      expect(findRow(rows, 'r3').status).to.equal('pending')
    })

    it('should be no-op for empty ids array', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))

      await store.updateStatus([], 'sent')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('pending')
    })

    it('should be no-op for non-matching ids', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))

      await store.updateStatus(['does-not-exist'], 'sent')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('pending')
    })
  })

  describe("updateStatus(ids, 'failed') retry-cap policy", () => {
    it('should keep status pending after first failure (attempts=1)', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({attempts: 0, id: 'r1', status: 'pending'}))

      await store.updateStatus(['r1'], 'failed')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('pending')
      expect(rows[0].attempts).to.equal(1)
    })

    it('should still be pending after second failure (attempts=2)', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({attempts: 0, id: 'r1', status: 'pending'}))

      await store.updateStatus(['r1'], 'failed')
      await store.updateStatus(['r1'], 'failed')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('pending')
      expect(rows[0].attempts).to.equal(2)
    })

    it(`should transition to terminal 'failed' at MAX_ATTEMPTS (${MAX_ATTEMPTS})`, async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({attempts: 0, id: 'r1', status: 'pending'}))

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.updateStatus(['r1'], 'failed')
      }

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('failed')
      expect(rows[0].attempts).to.equal(MAX_ATTEMPTS)
    })

    it("should be no-op on a row already at terminal 'failed' (no overshoot)", async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({attempts: 0, id: 'r1', status: 'pending'}))
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.updateStatus(['r1'], 'failed')
      }

      await store.updateStatus(['r1'], 'failed')

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      expect(rows[0].status).to.equal('failed')
      expect(rows[0].attempts).to.equal(MAX_ATTEMPTS)
    })
  })

  describe('list()', () => {
    it('should return empty result when file does not exist', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})

      const result = await store.list({limit: 10, offset: 0})

      expect(result.rows).to.deep.equal([])
      expect(result.total).to.equal(0)
    })

    it('should paginate via offset and limit', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.append(makeRecord({id: `r${i}`, timestamp: i}))
      }

      const page1 = await store.list({limit: 3, offset: 0})
      const page2 = await store.list({limit: 3, offset: 3})

      expect(page1.rows).to.have.lengthOf(3)
      expect(page2.rows).to.have.lengthOf(3)
      expect(page1.total).to.equal(10)
      expect(page2.total).to.equal(10)
      const ids = [...page1.rows.map((r) => r.id), ...page2.rows.map((r) => r.id)]
      expect(new Set(ids).size).to.equal(6) // no duplicates between pages
    })

    it('should filter by eventName', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1', name: 'event-a'}))
      await store.append(makeRecord({id: 'r2', name: 'event-b'}))
      await store.append(makeRecord({id: 'r3', name: 'event-a'}))

      const result = await store.list({eventName: 'event-a', limit: 10, offset: 0})

      expect(result.total).to.equal(2)
      expect(result.rows.map((r) => r.id).sort()).to.deep.equal(['r1', 'r3'])
    })

    it('should filter by status', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))
      await store.append(makeRecord({id: 'r2'}))
      await store.append(makeRecord({id: 'r3'}))
      await store.updateStatus(['r2'], 'sent')

      const pending = await store.list({limit: 10, offset: 0, status: 'pending'})
      const sent = await store.list({limit: 10, offset: 0, status: 'sent'})

      expect(pending.total).to.equal(2)
      expect(sent.total).to.equal(1)
      expect(sent.rows[0].id).to.equal('r2')
    })

    it('should filter by both eventName and status', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1', name: 'event-a'}))
      await store.append(makeRecord({id: 'r2', name: 'event-b'}))
      await store.append(makeRecord({id: 'r3', name: 'event-a'}))
      await store.updateStatus(['r1'], 'sent')

      const result = await store.list({eventName: 'event-a', limit: 10, offset: 0, status: 'sent'})

      expect(result.total).to.equal(1)
      expect(result.rows[0].id).to.equal('r1')
    })

    it('should sort by (timestamp DESC, id DESC) for stable ordering on same-timestamp', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'aaa', timestamp: 100}))
      await store.append(makeRecord({id: 'bbb', timestamp: 200}))
      await store.append(makeRecord({id: 'ccc', timestamp: 100}))

      const result = await store.list({limit: 10, offset: 0})

      // Newest timestamp first; same timestamp tie broken by id DESC
      expect(result.rows.map((r) => r.id)).to.deep.equal(['bbb', 'ccc', 'aaa'])
    })

    it('should return correct total post-filter when offset > total', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))

      const result = await store.list({limit: 10, offset: 100})

      expect(result.rows).to.deep.equal([])
      expect(result.total).to.equal(1)
    })
  })

  describe('loadPending()', () => {
    it('should return empty when file does not exist', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})

      const rows = await store.loadPending()

      expect(rows).to.deep.equal([])
    })

    it("should return only 'pending' rows", async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))
      await store.append(makeRecord({id: 'r2'}))
      await store.append(makeRecord({id: 'r3'}))
      await store.updateStatus(['r2'], 'sent')

      const rows = await store.loadPending()

      expect(rows.map((r) => r.id).sort()).to.deep.equal(['r1', 'r3'])
    })

    it('should include pending rows with attempts > 0 (in-flight retries)', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1', status: 'pending'}))
      await store.updateStatus(['r1'], 'failed') // attempts=1, still pending

      const rows = await store.loadPending()

      expect(rows).to.have.lengthOf(1)
      expect(rows[0].id).to.equal('r1')
      expect(rows[0].status).to.equal('pending')
      expect(rows[0].attempts).to.equal(1)
    })

    it("should exclude rows that reached terminal 'failed'", async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.updateStatus(['r1'], 'failed')
      }

      const rows = await store.loadPending()

      expect(rows).to.deep.equal([])
    })
  })

  describe('concurrency (write serialization)', () => {
    it('should not lose appends interleaved with updateStatus', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir})
      await store.append(makeRecord({id: 'r1'}))
      await store.append(makeRecord({id: 'r2'}))
      await store.append(makeRecord({id: 'r3'}))

      // Interleave: kick off updateStatus + a fresh append without awaiting; both go into writeChain.
      const updatePromise = store.updateStatus(['r1', 'r2'], 'sent')
      const appendPromise = store.append(makeRecord({id: 'r-NEW'}))

      await Promise.all([updatePromise, appendPromise])

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      const ids = rows.map((r) => r.id).sort()
      expect(ids).to.include('r-NEW') // append must NOT be lost by the rewrite
      expect(rows).to.have.lengthOf(4)
      expect(findRow(rows, 'r1').status).to.equal('sent')
      expect(findRow(rows, 'r2').status).to.equal('sent')
    })
  })

  describe('cap edge cases', () => {
    it('should drop oldest sent row when row cap exceeded', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir, maxRows: 3})
      await store.append(makeRecord({id: 'r1', timestamp: 100}))
      await store.append(makeRecord({id: 'r2', timestamp: 200}))
      await store.append(makeRecord({id: 'r3', timestamp: 300}))
      await store.updateStatus(['r1', 'r2'], 'sent') // r1 oldest sent; r2 newer sent

      await store.append(makeRecord({id: 'r4', timestamp: 400})) // triggers cap

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      const ids = rows.map((r) => r.id).sort()
      expect(ids).to.not.include('r1') // oldest sent dropped
      expect(ids).to.include('r2')
      expect(ids).to.include('r3')
      expect(ids).to.include('r4')
      expect(store.droppedSentCount()).to.equal(1)
    })

    it('should preserve pending and failed rows during compaction', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir, maxRows: 3})
      await store.append(makeRecord({id: 'r1', timestamp: 100})) // pending
      await store.append(makeRecord({id: 'r2', timestamp: 200})) // sent (will be dropped)
      await store.append(makeRecord({id: 'r3', timestamp: 300})) // pending
      await store.updateStatus(['r2'], 'sent')

      await store.append(makeRecord({id: 'r4', timestamp: 400})) // triggers cap

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      const ids = rows.map((r) => r.id).sort()
      expect(ids).to.include('r1') // pending preserved
      expect(ids).to.include('r3') // pending preserved
      expect(ids).to.not.include('r2') // sent dropped
    })

    it('should silently no-op append when cap full of pending+failed (no sent to drop)', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir, maxRows: 2})
      await store.append(makeRecord({id: 'r1', timestamp: 100}))
      await store.append(makeRecord({id: 'r2', timestamp: 200})) // both pending; no sent rows

      await store.append(makeRecord({id: 'r3', timestamp: 300})) // should silently drop NEW row

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      const ids = rows.map((r) => r.id).sort()
      expect(ids).to.not.include('r3')
      expect(ids).to.deep.equal(['r1', 'r2'])
      expect(store.droppedFullCount()).to.equal(1)
    })

    it('should track droppedFullCount cumulatively across multiple no-op appends', async () => {
      const baseDir = await freshTempDir()
      const store = new JsonlAnalyticsStore({baseDir, maxRows: 1})
      await store.append(makeRecord({id: 'r1'}))

      await store.append(makeRecord({id: 'r2'}))
      await store.append(makeRecord({id: 'r3'}))

      expect(store.droppedFullCount()).to.equal(2)
    })

    it('should silently skip malformed JSON lines on read', async () => {
      const baseDir = await freshTempDir()
      const filePath = join(baseDir, 'analytics-queue.jsonl')
      const good = makeRecord({id: 'good'})
      // Two bad lines (non-JSON garbage) sandwiching a good one.
      await writeFile(
        filePath,
        ['this is not json', JSON.stringify(good), 'partial-write-{'].join('\n') + '\n',
        'utf8',
      )
      const store = new JsonlAnalyticsStore({baseDir})

      const rows = await store.loadPending()

      expect(rows).to.have.lengthOf(1)
      expect(rows[0].id).to.equal('good')
    })

    it('should silently skip schema-invalid JSON objects on read', async () => {
      const baseDir = await freshTempDir()
      const filePath = join(baseDir, 'analytics-queue.jsonl')
      const good = makeRecord({id: 'good'})
      // First line parses as JSON but fails Zod (missing required fields).
      await writeFile(
        filePath,
        [JSON.stringify({notAValidRecord: true}), JSON.stringify(good)].join('\n') + '\n',
        'utf8',
      )
      const store = new JsonlAnalyticsStore({baseDir})

      const rows = await store.loadPending()

      expect(rows).to.have.lengthOf(1)
      expect(rows[0].id).to.equal('good')
    })

    it('should respect byte cap as well as row cap', async () => {
      const baseDir = await freshTempDir()
      // Tiny byte cap to force compaction quickly
      const store = new JsonlAnalyticsStore({baseDir, maxBytes: 500, maxRows: 10_000})
      const big = 'x'.repeat(200) // each row > 200 bytes serialized
      await store.append(makeRecord({id: 'r1', properties: {data: big}}))
      await store.append(makeRecord({id: 'r2', properties: {data: big}}))
      await store.updateStatus(['r1'], 'sent')

      await store.append(makeRecord({id: 'r3', properties: {data: big}})) // triggers byte-cap

      const rows = await readJsonlRows(join(baseDir, 'analytics-queue.jsonl'))
      const ids = rows.map((r) => r.id).sort()
      expect(ids).to.not.include('r1') // dropped (sent + oldest)
      expect(store.droppedSentCount()).to.be.greaterThanOrEqual(1)
    })
  })
})
