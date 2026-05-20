/**
 * TaskHistory startup audit tests — M2.07.
 *
 * Verifies the per-project audit comparing `_index.jsonl` ↔ `data/` files:
 * happy path, orphan-index detection, orphan-data detection, and the
 * once-per-project memoization in `getStore`.
 *
 * Uses a real tempDir as the projectPath. The store is constructed with
 * `staleThresholdMs: Number.POSITIVE_INFINITY` so test fixture timestamps
 * don't trigger M2.04 recovery during audit.
 */

import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {TaskHistoryEntry} from '../../../../src/server/core/domain/entities/task-history-entry.js'

import {
  _setTestLoggerForGetStore,
  auditTaskHistory,
  getStore,
  resetTaskHistoryStoreCache,
} from '../../../../src/server/infra/process/task-history-store-cache.js'
import {FileTaskHistoryStore} from '../../../../src/server/infra/storage/file-task-history-store.js'

function makeEntry(overrides: Partial<TaskHistoryEntry> & {taskId: string}): TaskHistoryEntry {
  const base = {
    completedAt: 1_745_432_001_000,
    content: `prompt for ${overrides.taskId}`,
    createdAt: 1_745_432_000_000,
    id: `tsk-${overrides.taskId}`,
    projectPath: '/p',
    result: 'done',
    schemaVersion: 1 as const,
    status: 'completed' as const,
    taskId: overrides.taskId,
    type: 'curate',
  }
  return {...base, ...overrides} as TaskHistoryEntry
}

describe('TaskHistory startup audit', () => {
  let sandbox: SinonSandbox
  let log: SinonStub
  let tempDir: string
  let projectPath: string
  let originalDataDir: string | undefined
  let store: FileTaskHistoryStore

  beforeEach(async () => {
    sandbox = createSandbox()
    log = sandbox.stub()

    tempDir = join(tmpdir(), `brv-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})

    // Redirect getProjectDataDir to point inside tempDir.
    originalDataDir = process.env.BRV_DATA_DIR
    process.env.BRV_DATA_DIR = tempDir

    // Use the tempDir itself as the projectPath so realpathSync (called inside
    // getProjectDataDir) resolves successfully. The data is then written to
    // <tempDir>/projects/<sanitized(tempDir)>/task-history/.
    projectPath = tempDir

    // Build a store directly against the same path resolution so audit's
    // `readdir(<resolved>/task-history/data)` finds files we save here.
    const {getProjectDataDir} = await import('../../../../src/server/utils/path-utils.js')
    store = new FileTaskHistoryStore({
      baseDir: getProjectDataDir(projectPath),
      maxAgeDays: 0,
      maxEntries: Number.POSITIVE_INFINITY,
      maxIndexBloatRatio: Number.POSITIVE_INFINITY,
      staleThresholdMs: Number.POSITIVE_INFINITY,
    })

    resetTaskHistoryStoreCache()
  })

  afterEach(async () => {
    sandbox.restore()
    _setTestLoggerForGetStore()
    if (originalDataDir === undefined) {
      delete process.env.BRV_DATA_DIR
    } else {
      process.env.BRV_DATA_DIR = originalDataDir
    }

    await rm(tempDir, {force: true, recursive: true})
  })

  it('Audit logs ok when index ↔ data are consistent', async () => {
    await store.save(makeEntry({taskId: 'a'}))
    await store.save(makeEntry({taskId: 'b'}))
    await store.save(makeEntry({taskId: 'c'}))

    await auditTaskHistory(projectPath, store, log)

    expect(log.calledOnce).to.equal(true)
    const msg = log.firstCall.args[0] as string
    expect(msg).to.include('[task-history] audit')
    expect(msg).to.include('3 live entries')
    expect(msg).to.include('3 data files')
    expect(msg).to.include('ok.')
  })

  it('Audit logs WARN orphan-index when a data file is missing', async () => {
    await store.save(makeEntry({taskId: 'a'}))
    await store.save(makeEntry({taskId: 'b'}))

    // Manually unlink one data file out-of-band.
    const {getProjectDataDir} = await import('../../../../src/server/utils/path-utils.js')
    const dataDir = join(getProjectDataDir(projectPath), 'task-history', 'data')
    await rm(join(dataDir, 'tsk-a.json'), {force: true})

    await auditTaskHistory(projectPath, store, log)

    expect(log.calledOnce).to.equal(true)
    const msg = log.firstCall.args[0] as string
    expect(msg).to.include('WARN')
    expect(msg).to.include('orphan-index')
    expect(msg).to.include('tsk-a')
  })

  it('Audit logs WARN orphan-data when an index entry is missing for a present file', async () => {
    await store.save(makeEntry({taskId: 'real'}))

    // Manually drop a data file with no corresponding index entry.
    const {getProjectDataDir} = await import('../../../../src/server/utils/path-utils.js')
    const dataDir = join(getProjectDataDir(projectPath), 'task-history', 'data')
    await writeFile(
      join(dataDir, 'tsk-orphan.json'),
      JSON.stringify({
        completedAt: 1,
        content: 'x',
        createdAt: 1,
        id: 'tsk-orphan',
        projectPath: '/p',
        result: 'done',
        schemaVersion: 1,
        status: 'completed',
        taskId: 'orphan',
        type: 'curate',
      }),
      'utf8',
    )

    await auditTaskHistory(projectPath, store, log)

    expect(log.calledOnce).to.equal(true)
    const msg = log.firstCall.args[0] as string
    expect(msg).to.include('WARN')
    expect(msg).to.include('orphan-data')
    expect(msg).to.include('tsk-orphan')
  })

  it('Audit runs once per project (not on every getStore call)', async () => {
    // Save one entry so audit has something to log.
    await store.save(makeEntry({taskId: 'once'}))

    // Inject the test logger BEFORE the first getStore() so the audit triggered
    // inside getStore uses our stub instead of processLog.
    _setTestLoggerForGetStore(log)

    // First call schedules a fire-and-forget audit.
    getStore(projectPath)
    // Second call must NOT schedule another audit.
    getStore(projectPath)

    // Wait for the fire-and-forget audit microtasks to settle.
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })

    const auditCalls = log.getCalls().filter((c) =>
      typeof c.args[0] === 'string' && (c.args[0] as string).includes('[task-history] audit'),
    )
    expect(auditCalls).to.have.lengthOf(1)
  })
})
