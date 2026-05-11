/**
 * Regression: cache-invalidation race between `save()` and a concurrent
 * `firePrune()` pass.
 *
 * Without the fix, the following sequence reaches a stale `indexCache`:
 *   1. save N appends its index line, sets `indexCache = undefined`,
 *      schedules `firePrune()` (timer 0).
 *   2. The prune timer fires and starts `readIndexDedup` → reads file →
 *      hangs on the readFile I/O macrotask.
 *   3. save N+1 starts. Its `appendFile` lands BEFORE the prune's readFile
 *      resolves, but its cache invalidation runs AFTER the prune's
 *      `doReadIndexDedup` finishes and sets `indexCache = mapWithoutNPlus1`.
 *   4. A subsequent `list()` reads `indexCache` and sees N entries instead
 *      of N+1 — the just-saved row is silently absent.
 *
 * The user-visible symptoms are flaky failures of `clear`/`deleteMany` and
 * `task:list` paths in the wider test suite (e.g.
 * `prune + compaction > clear with default statuses`,
 * `handleTaskDeleteBulk > N3 — batches store.deleteMany per project`,
 * `handleTaskClearCompleted > unions in-memory completedTasks + store.clear results`).
 * Those tests assume `await save() × N` followed by `list()` returns N rows.
 *
 * This file isolates the race in a tight loop so it manifests reliably:
 * 30 iterations × 10 sequential saves ≈ 300 race-window openings, far
 * above the ~10–20% per-cycle flake rate observed on production code.
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {TaskHistoryEntry} from '../../../../src/server/core/domain/entities/task-history-entry.js'

import {FileTaskHistoryStore} from '../../../../src/server/infra/storage/file-task-history-store.js'

type EntryOverrides = Partial<TaskHistoryEntry> & {taskId: string}

function makeEntry(overrides: EntryOverrides): TaskHistoryEntry {
  const base = {
    content: `prompt for ${overrides.taskId}`,
    createdAt: 1_745_432_000_000,
    id: `tsk-${overrides.taskId}`,
    projectPath: '/p',
    schemaVersion: 1 as const,
    status: 'created' as const,
    taskId: overrides.taskId,
    type: 'curate',
  }
  return {...base, ...overrides} as TaskHistoryEntry
}

describe('FileTaskHistoryStore — cache invalidation race (Category B regression)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-cache-race-${Date.now()}-${randomUUID()}`)
    await mkdir(tempDir, {recursive: true})
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  it('list() after N sequential saves must reflect all N entries (race regression)', async function () {
    this.timeout(30_000)

    const ITERATIONS = 30
    const SAVES_PER_ITER = 10

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const iterDir = join(tempDir, `iter-${iter}`)
      // eslint-disable-next-line no-await-in-loop
      await mkdir(iterDir, {recursive: true})

      const store = new FileTaskHistoryStore({
        baseDir: iterDir,
        maxAgeDays: 0,
        maxEntries: Number.POSITIVE_INFINITY,
        maxIndexBloatRatio: Number.POSITIVE_INFINITY,
        staleThresholdMs: Number.POSITIVE_INFINITY,
      })

      for (let i = 0; i < SAVES_PER_ITER; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.save(makeEntry({taskId: `iter-${iter}-i-${i}`}))
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await store.list()
      const got = new Set(result.map((r) => r.taskId))
      const missing: string[] = []
      for (let i = 0; i < SAVES_PER_ITER; i++) {
        const id = `iter-${iter}-i-${i}`
        if (!got.has(id)) missing.push(id)
      }

      expect(missing, `iter ${iter}: missing taskIds after save→list cycle`).to.deep.equal([])
    }
  })
})
