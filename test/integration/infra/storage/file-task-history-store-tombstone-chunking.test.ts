/**
 * Regression: large `clear()` / `deleteMany()` batches must not produce a
 * single >4KB `appendFile` call. Concurrent unlocked `save()` calls can
 * interleave content into a multi-line tombstone write on platforms that
 * don't serialize regular-file appends per inode (POSIX guarantees nothing
 * for regular files; only PIPE_BUF for pipes/FIFOs/sockets).
 *
 * The chunked implementation breaks the batch into small (<4KB) appends
 * under the existing `withOperationLock`, so every individual append is
 * atomic on common filesystems and concurrent saves can only land BETWEEN
 * chunks, never WITHIN one.
 *
 * Failure-mode this test guards against: a corrupted tombstone JSON line
 * silently skipped by `IndexLineSchema.safeParse` → tombstone missing from
 * the dedup map → entry remains live in index. But `tombstoneAndUnlink`
 * unlinks the data file anyway → `list()` returns a "ghost" entry whose
 * `getById()` returns `undefined`.
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {mkdir, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {TaskHistoryEntry} from '../../../../src/server/core/domain/entities/task-history-entry.js'

import {FileTaskHistoryStore} from '../../../../src/server/infra/storage/file-task-history-store.js'

function makeEntry(taskId: string, status: 'completed' | 'created' = 'completed'): TaskHistoryEntry {
  if (status === 'completed') {
    return {
      completedAt: 1_745_432_002_000,
      content: `prompt for ${taskId}`,
      createdAt: 1_745_432_000_000,
      id: `tsk-${taskId}`,
      projectPath: '/p',
      result: 'done',
      schemaVersion: 1 as const,
      startedAt: 1_745_432_001_000,
      status: 'completed',
      taskId,
      type: 'curate',
    }
  }

  return {
    content: `prompt for ${taskId}`,
    createdAt: 1_745_432_000_000,
    id: `tsk-${taskId}`,
    projectPath: '/p',
    schemaVersion: 1 as const,
    status: 'created',
    taskId,
    type: 'curate',
  }
}

describe('FileTaskHistoryStore — tombstone chunking (N1 regression)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-tombstone-chunk-${Date.now()}-${randomUUID()}`)
    await mkdir(tempDir, {recursive: true})
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  it('clear() with 200 terminal entries removes every tombstone + every data file', async function () {
    this.timeout(30_000)

    const store = new FileTaskHistoryStore({
      baseDir: tempDir,
      maxAgeDays: 0,
      maxEntries: Number.POSITIVE_INFINITY,
      maxIndexBloatRatio: Number.POSITIVE_INFINITY,
      staleThresholdMs: Number.POSITIVE_INFINITY,
    })

    const ids = Array.from({length: 200}, (_, i) => `task-${String(i).padStart(3, '0')}`)

    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await store.save(makeEntry(id))
    }

    await store.flushPendingOperations()

    const result = await store.clear({projectPath: '/p'})
    expect(result.deletedCount, 'all 200 ids should be reported as deleted').to.equal(200)
    expect(new Set(result.taskIds), 'returned taskIds should match input').to.deep.equal(new Set(ids))

    const live = await store.list({projectPath: '/p'})
    expect(live, 'list should be empty after clear').to.deep.equal([])

    const dataDir = join(tempDir, 'task-history', 'data')
    let remaining: string[]
    try {
      remaining = await readdir(dataDir)
    } catch {
      remaining = []
    }

    expect(
      remaining.filter((f) => f.startsWith('tsk-')),
      'no orphan tsk-*.json data files should remain',
    ).to.deep.equal([])
  })

  it('every appendFile chunk in the index file is well-formed JSON (no interleave corruption)', async function () {
    this.timeout(30_000)

    const store = new FileTaskHistoryStore({
      baseDir: tempDir,
      maxAgeDays: 0,
      maxEntries: Number.POSITIVE_INFINITY,
      maxIndexBloatRatio: Number.POSITIVE_INFINITY,
      staleThresholdMs: Number.POSITIVE_INFINITY,
    })

    const ids = Array.from({length: 200}, (_, i) => `t${i}`)
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await store.save(makeEntry(id))
    }

    await store.flushPendingOperations()
    await store.clear({projectPath: '/p'})
    await store.flushPendingOperations()

    const indexPath = join(tempDir, 'task-history', '_index.jsonl')
    const raw = await readFile(indexPath, 'utf8')

    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const corrupted: string[] = []
    let tombstoneCount = 0
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line)
        if (parsed !== null && typeof parsed === 'object' && '_deleted' in parsed) tombstoneCount++
      } catch {
        corrupted.push(line)
      }
    }

    expect(corrupted, 'no corrupted JSON lines should remain in the index').to.deep.equal([])
    expect(tombstoneCount, 'all 200 tombstones should be present').to.equal(200)
  })

  it('clear() interleaved with concurrent saves leaves the index parseable', async function () {
    this.timeout(30_000)

    const store = new FileTaskHistoryStore({
      baseDir: tempDir,
      maxAgeDays: 0,
      maxEntries: Number.POSITIVE_INFINITY,
      maxIndexBloatRatio: Number.POSITIVE_INFINITY,
      staleThresholdMs: Number.POSITIVE_INFINITY,
    })

    // Seed 150 terminal tasks for the clear pass to chew through.
    const seedIds = Array.from({length: 150}, (_, i) => `seed-${i}`)
    for (const id of seedIds) {
      // eslint-disable-next-line no-await-in-loop
      await store.save(makeEntry(id))
    }

    await store.flushPendingOperations()

    // Fire clear() and 50 concurrent fresh saves.
    const concurrentIds = Array.from({length: 50}, (_, i) => `concurrent-${i}`)
    const clearPromise = store.clear({projectPath: '/p'})
    const savePromises = concurrentIds.map((id) => store.save(makeEntry(id, 'created')))

    await Promise.all([clearPromise, ...savePromises])
    await store.flushPendingOperations()

    const indexPath = join(tempDir, 'task-history', '_index.jsonl')
    const raw = await readFile(indexPath, 'utf8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)

    const corrupted: string[] = []
    for (const line of lines) {
      try {
        JSON.parse(line)
      } catch {
        corrupted.push(line)
      }
    }

    expect(corrupted, 'no corrupted JSON lines after concurrent save+clear').to.deep.equal([])
  })
})
