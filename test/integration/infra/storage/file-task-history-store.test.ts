import {expect} from 'chai'
import {appendFile, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
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
  // Cast through the union — TypeScript can't narrow from a partial overlay
  // across discriminated branches, but the parser will reject anything malformed.
  return {...base, ...overrides} as TaskHistoryEntry
}

describe('FileTaskHistoryStore', () => {
  let store: FileTaskHistoryStore
  let tempDir: string
  let storeDir: string
  let dataDir: string
  let indexPath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-task-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    // Disable stale recovery + prune + compaction by default — legacy fixtures
    // use ancient `createdAt` values + low entry counts that would otherwise
    // trigger M2.04 recovery / M2.03 prune / compaction during M2.02/M2.05 tests.
    // The 'stale recovery' and 'prune + compaction' sub-describes override per-test.
    store = new FileTaskHistoryStore({
      baseDir: tempDir,
      maxAgeDays: 0,
      maxEntries: Number.POSITIVE_INFINITY,
      maxIndexBloatRatio: Number.POSITIVE_INFINITY,
      staleThresholdMs: Number.POSITIVE_INFINITY,
    })
    storeDir = join(tempDir, 'task-history')
    dataDir = join(storeDir, 'data')
    indexPath = join(storeDir, '_index.jsonl')
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  describe('basic', () => {
  it('save writes data file then appends index line', async () => {
    const entry = makeEntry({taskId: 'abc'})
    await store.save(entry)

    const dataPath = join(dataDir, 'tsk-abc.json')
    const dataRaw = await readFile(dataPath, 'utf8')
    expect(JSON.parse(dataRaw)).to.deep.equal(entry)

    const indexRaw = await readFile(indexPath, 'utf8')
    const lines = indexRaw.split('\n').filter(Boolean)
    expect(lines).to.have.lengthOf(1)
    const parsedLine = JSON.parse(lines[0])
    expect(parsedLine).to.include({
      content: entry.content,
      createdAt: entry.createdAt,
      projectPath: '/p',
      schemaVersion: 1,
      status: 'created',
      taskId: 'abc',
      type: 'curate',
    })
  })

  it('save rejects entry that fails Zod validation', async () => {
    // status: 'completed' without completedAt — fails the discriminated union branch
    const invalid = {
      content: 'x',
      createdAt: 1,
      id: 'tsk-z',
      projectPath: '/p',
      result: 'done',
      schemaVersion: 1,
      status: 'completed',
      taskId: 'z',
      type: 'curate',
    } as unknown as TaskHistoryEntry

    let thrown: unknown
    try {
      await store.save(invalid)
    } catch (error) {
      thrown = error
    }

    expect(thrown).to.exist
    expect(thrown).to.be.an.instanceOf(Error)
  })

  it('getById returns full TaskHistoryEntry from data file', async () => {
    const entry = makeEntry({
      completedAt: 1_745_432_002_000,
      reasoningContents: [{content: 'hmm', isThinking: false, timestamp: 1}],
      responseContent: 'response text',
      result: 'done',
      sessionId: 'sess',
      startedAt: 1_745_432_001_000,
      status: 'completed',
      taskId: 'full',
      toolCalls: [
        {args: {x: 1}, callId: 'c1', sessionId: 'sess', status: 'completed', timestamp: 1, toolName: 'read'},
      ],
    })
    await store.save(entry)

    const fetched = await store.getById('full')
    expect(fetched).to.deep.equal(entry)
  })

  it('getById returns undefined for missing taskId', async () => {
    const result = await store.getById('never-saved')
    expect(result).to.equal(undefined)
  })

  it('getById returns undefined for corrupt data file', async () => {
    await mkdir(dataDir, {recursive: true})
    await writeFile(join(dataDir, 'tsk-bad.json'), '{not-valid-json', 'utf8')

    const result = await store.getById('bad')
    expect(result).to.equal(undefined)
  })

  it('list dedupes by taskId keeping the LAST line', async () => {
    await store.save(makeEntry({createdAt: 1, status: 'created', taskId: 'one'}))
    await store.save(makeEntry({createdAt: 1, startedAt: 2, status: 'started', taskId: 'one'}))
    await store.save(
      makeEntry({completedAt: 3, createdAt: 1, result: 'ok', startedAt: 2, status: 'completed', taskId: 'one'}),
    )

    const result = await store.list()
    expect(result).to.have.lengthOf(1)
    expect(result[0]).to.include({status: 'completed', taskId: 'one'})
  })

  it('list skips taskIds whose final line is _deleted: true', async () => {
    await store.save(makeEntry({taskId: 'keep'}))
    await store.save(makeEntry({taskId: 'gone'}))
    // Manually append a tombstone for 'gone' (M2.05 will write these)
    await appendFile(indexPath, JSON.stringify({_deleted: true, taskId: 'gone'}) + '\n', 'utf8')

    const result = await store.list()
    const ids = result.map((r) => r.taskId)
    expect(ids).to.include('keep')
    expect(ids).to.not.include('gone')
  })

  it('list filters by projectPath / status / type / createdAt range', async () => {
    await store.save(makeEntry({createdAt: 100, projectPath: '/a', status: 'created', taskId: 't1', type: 'curate'}))
    await store.save(makeEntry({createdAt: 200, projectPath: '/b', status: 'created', taskId: 't2', type: 'curate'}))
    await store.save(
      makeEntry({completedAt: 350, createdAt: 300, projectPath: '/a', status: 'completed', taskId: 't3', type: 'query'}),
    )
    await store.save(makeEntry({createdAt: 400, projectPath: '/a', status: 'created', taskId: 't4', type: 'curate'}))

    const byProject = await store.list({projectPath: '/a'})
    expect(byProject.map((r) => r.taskId).sort()).to.deep.equal(['t1', 't3', 't4'])

    const byStatus = await store.list({status: ['completed']})
    expect(byStatus.map((r) => r.taskId)).to.deep.equal(['t3'])

    const byType = await store.list({type: ['query']})
    expect(byType.map((r) => r.taskId)).to.deep.equal(['t3'])

    const byRange = await store.list({after: 150, before: 350})
    expect(byRange.map((r) => r.taskId).sort()).to.deep.equal(['t2', 't3'])
  })

  it('list returns newest-first by createdAt', async () => {
    await store.save(makeEntry({createdAt: 300, taskId: 'mid'}))
    await store.save(makeEntry({createdAt: 100, taskId: 'old'}))
    await store.save(makeEntry({createdAt: 500, taskId: 'new'}))

    const result = await store.list()
    expect(result.map((r) => r.taskId)).to.deep.equal(['new', 'mid', 'old'])
  })

  it('list slices to limit AFTER sort + filter', async () => {
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.save(makeEntry({createdAt: 100 * (i + 1), taskId: `id-${i}`}))
    }

    const result = await store.list({limit: 2})
    expect(result.map((r) => r.taskId)).to.deep.equal(['id-4', 'id-3'])
  })

  it('list returns TaskListItem shape (no detail leak)', async () => {
    const entry = makeEntry({
      reasoningContents: [{content: 'why', timestamp: 1}],
      responseContent: 'big response',
      sessionId: 'sess',
      taskId: 'detailed',
      toolCalls: [
        {args: {}, callId: 'c1', sessionId: 'sess', status: 'completed', timestamp: 1, toolName: 'read'},
      ],
    })
    await store.save(entry)

    const result = await store.list()
    expect(result).to.have.lengthOf(1)
    const item = result[0]
    expect(item).to.not.have.property('responseContent')
    expect(item).to.not.have.property('toolCalls')
    expect(item).to.not.have.property('reasoningContents')
    expect(item).to.not.have.property('sessionId')
    expect(item).to.not.have.property('schemaVersion')
    expect(item).to.not.have.property('id')
  })

  it('atomic data write — no .tmp.* files remain', async () => {
    await store.save(makeEntry({taskId: 'atomic'}))

    const files = await readdir(dataDir)
    const tmpFiles = files.filter((f) => f.includes('.tmp'))
    expect(tmpFiles).to.have.lengthOf(0)
    expect(files).to.have.lengthOf(1)
    expect(files[0]).to.equal('tsk-atomic.json')
  })

  it('same taskId saved 3 times — single data file, 3 index lines', async () => {
    await store.save(makeEntry({taskId: 'repeat'}))
    await store.save(makeEntry({startedAt: 2, status: 'started', taskId: 'repeat'}))
    await store.save(
      makeEntry({completedAt: 3, result: 'r', startedAt: 2, status: 'completed', taskId: 'repeat'}),
    )

    const files = await readdir(dataDir)
    expect(files).to.have.lengthOf(1)
    expect(files[0]).to.equal('tsk-repeat.json')

    const indexRaw = await readFile(indexPath, 'utf8')
    const lines = indexRaw.split('\n').filter(Boolean)
    expect(lines).to.have.lengthOf(3)
  })
  })

  describe('delete + clear', () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    function completedEntry(taskId: string, projectPath = '/p', createdAt = 1_745_432_000_000): TaskHistoryEntry {
      return makeEntry({
        completedAt: createdAt + 2000,
        createdAt,
        projectPath,
        result: 'done',
        startedAt: createdAt + 1000,
        status: 'completed',
        taskId,
      })
    }

    it('delete appends tombstone + unlinks data file, returns true on first call', async () => {
      const entry = completedEntry('one')
      await store.save(entry)

      const result = await store.delete('one')
      expect(result).to.equal(true)

      // Data file unlinked
      const files = await readdir(dataDir)
      expect(files).to.not.include('tsk-one.json')

      // Index has the tombstone
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(2) // 1 save line + 1 tombstone
      const tombstone = JSON.parse(lines[1]) as Record<string, unknown>
      expect(tombstone).to.include({_deleted: true, schemaVersion: 1, taskId: 'one'})
      expect(tombstone.deletedAt).to.be.a('number')
    })

    it('delete returns false on second call (idempotent)', async () => {
      await store.save(completedEntry('two'))
      const first = await store.delete('two')
      expect(first).to.equal(true)

      const second = await store.delete('two')
      expect(second).to.equal(false)

      // No extra tombstone written on the second call
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(2) // still 1 save + 1 tombstone
    })

    it('deleteMany single pass — appends multiple tombstones, returns count of newly-deleted', async () => {
      await store.save(completedEntry('a'))
      await store.save(completedEntry('b'))
      await store.save(completedEntry('c'))

      const count = await store.deleteMany(['a', 'b', 'c'])
      expect(count).to.equal(3)

      // All data files gone
      const files = await readdir(dataDir)
      expect(files).to.have.lengthOf(0)

      // Index has 3 save lines + 3 tombstone lines
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(6)
      const tombstones = lines.slice(3).map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(tombstones.map((t) => t.taskId).sort()).to.deep.equal(['a', 'b', 'c'])
    })

    it('deleteMany handles unlink races without throwing', async () => {
      await store.save(completedEntry('race-a'))
      await store.save(completedEntry('race-b'))

      // Simulate a concurrent unlink: delete one data file out-of-band before deleteMany runs.
      await rm(join(dataDir, 'tsk-race-a.json'), {force: true})

      const count = await store.deleteMany(['race-a', 'race-b'])
      expect(count).to.equal(2)

      const files = await readdir(dataDir)
      expect(files).to.have.lengthOf(0)
    })

    it('clear with default statuses removes only terminal entries', async () => {
      await store.save(makeEntry({status: 'created', taskId: 'created-1'}))
      await store.save(makeEntry({startedAt: 1, status: 'started', taskId: 'started-1'}))
      await store.save(completedEntry('completed-1'))
      await store.save(
        makeEntry({
          completedAt: 2,
          error: {message: 'boom', name: 'Error'},
          startedAt: 1,
          status: 'error',
          taskId: 'error-1',
        }),
      )
      await store.save(
        makeEntry({completedAt: 2, startedAt: 1, status: 'cancelled', taskId: 'cancelled-1'}),
      )

      const result = await store.clear()
      expect(result.deletedCount).to.equal(3)
      expect(result.taskIds.sort()).to.deep.equal(['cancelled-1', 'completed-1', 'error-1'])

      const remaining = await store.list()
      expect(remaining.map((r) => r.taskId).sort()).to.deep.equal(['created-1', 'started-1'])
    })

    it('clear with explicit statuses honors the filter', async () => {
      await store.save(completedEntry('c1'))
      await store.save(completedEntry('c2'))
      await store.save(completedEntry('c3'))

      // Empty allow-list → match nothing.
      const empty = await store.clear({statuses: []})
      expect(empty.deletedCount).to.equal(0)

      // Only 'completed'.
      const onlyCompleted = await store.clear({statuses: ['completed']})
      expect(onlyCompleted.deletedCount).to.equal(3)
      expect(onlyCompleted.taskIds.sort()).to.deep.equal(['c1', 'c2', 'c3'])
    })

    it('clear scoped by projectPath leaves other projects entries alone', async () => {
      await store.save(completedEntry('a', '/p1'))
      await store.save(completedEntry('b', '/p2'))

      const result = await store.clear({projectPath: '/p1'})
      expect(result.taskIds).to.deep.equal(['a'])
      expect(result.deletedCount).to.equal(1)

      const remaining = await store.list()
      expect(remaining.map((r) => r.taskId)).to.deep.equal(['b'])
    })

    it('clear returns the list of deleted taskIds (so caller can broadcast)', async () => {
      await store.save(completedEntry('x'))
      await store.save(completedEntry('y'))

      const result = await store.clear()
      expect(result.deletedCount).to.equal(2)
      expect(result.taskIds.sort()).to.deep.equal(['x', 'y'])
    })

    it('list after delete sees the entry as gone (tombstone respected)', async () => {
      await store.save(completedEntry('ghost'))
      await store.delete('ghost')

      const result = await store.list()
      expect(result.map((r) => r.taskId)).to.not.include('ghost')
    })

    it('getById after delete returns undefined', async () => {
      await store.save(completedEntry('gone'))
      await store.delete('gone')

      const fetched = await store.getById('gone')
      expect(fetched).to.equal(undefined)
    })
  })

  describe('stale recovery', () => {
    const STALE_THRESHOLD_MS = 100

    beforeEach(() => {
      // Override outer store with a small threshold so we can fabricate
      // "stale" entries via createdAt: Date.now() - 200.
      store = new FileTaskHistoryStore({
        baseDir: tempDir,
        maxAgeDays: 0,
        maxEntries: Number.POSITIVE_INFINITY,
        maxIndexBloatRatio: Number.POSITIVE_INFINITY,
        staleThresholdMs: STALE_THRESHOLD_MS,
      })
    })

    // eslint-disable-next-line unicorn/consistent-function-scoping
    function staleStartedEntry(taskId: string, createdAtOffset = 200): TaskHistoryEntry {
      const createdAt = Date.now() - createdAtOffset
      return makeEntry({
        createdAt,
        startedAt: createdAt + 10,
        status: 'started',
        taskId,
      })
    }

    it('list returns recovered shape for created/started past threshold', async () => {
      await store.save(staleStartedEntry('ghost-1'))

      const result = await store.list()
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.include({status: 'error', taskId: 'ghost-1'})
      expect(result[0].error).to.deep.equal({
        code: 'INTERRUPTED',
        message: 'Interrupted (daemon terminated)',
        name: 'TaskError',
      })
    })

    it('getById returns recovered shape; rewrites both index line and data file', async () => {
      await store.save(staleStartedEntry('ghost-2'))

      const fetched = await store.getById('ghost-2')
      expect(fetched).to.exist
      expect(fetched!.status).to.equal('error')
      if (fetched!.status === 'error') {
        expect(fetched!.error).to.deep.equal({
          code: 'INTERRUPTED',
          message: 'Interrupted (daemon terminated)',
          name: 'TaskError',
        })
      }

      // Data file rewritten on disk
      const dataRaw = await readFile(join(dataDir, 'tsk-ghost-2.json'), 'utf8')
      const onDisk = JSON.parse(dataRaw) as Record<string, unknown>
      expect(onDisk.status).to.equal('error')

      // Index has the original save line + the recovery line
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(2)
      const lastLine = JSON.parse(lines[1]) as Record<string, unknown>
      expect(lastLine).to.include({status: 'error', taskId: 'ghost-2'})
    })

    it('created within threshold left alone', async () => {
      const fresh = makeEntry({
        createdAt: Date.now(), // well within 100ms threshold
        status: 'created',
        taskId: 'fresh',
      })
      await store.save(fresh)

      const result = await store.list()
      expect(result).to.have.lengthOf(1)
      expect(result[0].status).to.equal('created')

      // No recovery line appended
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(1)
    })

    it('already-terminal status (completed/error/cancelled) never rewritten', async () => {
      const oldCreatedAt = Date.now() - 1000 // way past threshold
      await store.save(
        makeEntry({
          completedAt: oldCreatedAt + 100,
          createdAt: oldCreatedAt,
          result: 'done',
          startedAt: oldCreatedAt + 10,
          status: 'completed',
          taskId: 't-completed',
        }),
      )
      await store.save(
        makeEntry({
          completedAt: oldCreatedAt + 100,
          createdAt: oldCreatedAt,
          error: {code: 'BOOM', message: 'boom', name: 'BoomError'},
          startedAt: oldCreatedAt + 10,
          status: 'error',
          taskId: 't-error',
        }),
      )
      await store.save(
        makeEntry({
          completedAt: oldCreatedAt + 100,
          createdAt: oldCreatedAt,
          startedAt: oldCreatedAt + 10,
          status: 'cancelled',
          taskId: 't-cancelled',
        }),
      )

      const result = await store.list()
      const byId = Object.fromEntries(result.map((r) => [r.taskId, r.status]))
      expect(byId).to.deep.equal({
        't-cancelled': 'cancelled',
        't-completed': 'completed',
        't-error': 'error',
      })

      // No recovery lines appended — index has only the 3 save lines.
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(3)
    })

    it('idempotent — second list call does not append more recovery lines', async () => {
      await store.save(staleStartedEntry('once'))

      await store.list() // first call: triggers recovery, appends 1 line

      const after1 = await readFile(indexPath, 'utf8')
      const lines1 = after1.split('\n').filter(Boolean).length

      await store.list() // second call: must NOT append again
      const after2 = await readFile(indexPath, 'utf8')
      const lines2 = after2.split('\n').filter(Boolean).length

      expect(lines2).to.equal(lines1)
    })

    it('failed atomic-write does not throw; in-memory recovered shape still returned', async () => {
      await store.save(staleStartedEntry('locked'))

      // Make the index file read-only — the recovery's appendFile will fail with EACCES.
      // The recovered shape must still be returned in-memory.
      const {chmod} = await import('node:fs/promises')
      await chmod(indexPath, 0o444)

      let result
      let threw = false
      try {
        result = await store.list()
      } catch {
        threw = true
      }

      // Restore writability so afterEach can clean up.
      await chmod(indexPath, 0o644)

      expect(threw).to.equal(false)
      expect(result).to.exist
      expect(result!).to.have.lengthOf(1)
      expect(result![0].status).to.equal('error')
    })

    it('recovery line carries schemaVersion: 1', async () => {
      await store.save(staleStartedEntry('schema-check'))
      await store.list() // triggers recovery, appends recovery line

      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      const recoveryLine = JSON.parse(lines.at(-1) ?? '') as Record<string, unknown>
      expect(recoveryLine.schemaVersion).to.equal(1)
      expect(recoveryLine.status).to.equal('error')
    })
  })

  describe('prune + compaction', () => {
    const ONE_DAY_MS = 86_400_000

    // eslint-disable-next-line unicorn/consistent-function-scoping
    async function countIndexLines(): Promise<number> {
      const raw = await readFile(indexPath, 'utf8').catch(() => '')
      return raw.split('\n').filter(Boolean).length
    }

    async function waitForPruneToSettle(): Promise<void> {
      let prev = await countIndexLines()
      for (let i = 0; i < 50; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 4)
        })
        // eslint-disable-next-line no-await-in-loop
        const cur = await countIndexLines()
        if (cur === prev) return
        prev = cur
      }
    }

    describe('age prune', () => {
      it('entries older than maxAgeDays appended as _deleted, data files unlinked', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 1,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        const now = Date.now()
        await store.save(
          makeEntry({completedAt: now - 2 * ONE_DAY_MS, createdAt: now - 2 * ONE_DAY_MS, status: 'completed', taskId: 'old'}),
        )
        // Trigger prune via a fresh save (within threshold).
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'fresh'}))

        await waitForPruneToSettle()

        // Old data file is gone
        const dataFiles = await readdir(dataDir).catch(() => [])
        expect(dataFiles).to.not.include('tsk-old.json')
        expect(dataFiles).to.include('tsk-fresh.json')

        // Tombstone exists for old taskId
        const indexRaw = await readFile(indexPath, 'utf8')
        const tombstones = indexRaw
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((line) => line._deleted === true)
        expect(tombstones.some((t) => t.taskId === 'old')).to.equal(true)
      })

      it('entries within maxAgeDays untouched', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 30,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        const now = Date.now()
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'recent'}))
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'recent2'}))

        await waitForPruneToSettle()

        const result = await store.list()
        expect(result.map((r) => r.taskId).sort()).to.deep.equal(['recent', 'recent2'])
      })

      it('maxAgeDays: 0 disables age prune', async () => {
        // Outer beforeEach already constructs store with maxAgeDays: 0.
        // Save an ancient entry; assert it's still in the live list after settle.
        await store.save(makeEntry({completedAt: 2, createdAt: 1, status: 'completed', taskId: 'ancient'}))
        await waitForPruneToSettle()

        const result = await store.list()
        expect(result.map((r) => r.taskId)).to.include('ancient')
      })
    })

    describe('count prune', () => {
      it('trims live entry count to maxEntries (newest survive)', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: 2,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        const now = Date.now()
        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(
            makeEntry({completedAt: now + i, createdAt: now + i, status: 'completed', taskId: `c${i}`}),
          )
        }

        await waitForPruneToSettle()

        const result = await store.list()
        // newest 2 survive
        expect(result.map((r) => r.taskId).sort()).to.deep.equal(['c2', 'c3'])
      })

      it('deleted-but-not-yet-compacted entries are not counted as live', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: 3,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        const now = Date.now()
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'b'}))
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'c'}))
        // Mark 'a' deleted out-of-band (tombstone via store.delete is the canonical path)
        await store.delete('a')
        // Save more entries — should NOT be pruned because live count is now 3 (b, c, d), under the 3 cap.
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'd'}))

        await waitForPruneToSettle()

        const result = await store.list()
        expect(result.map((r) => r.taskId).sort()).to.deep.equal(['b', 'c', 'd'])
      })
    })

    describe('compaction', () => {
      it('triggered when bloat ratio > 2.0', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 2,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        // Save same taskId 4 times — index has 4 lines, 1 live → ratio 4.0.
        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'spam'}))
        }

        await waitForPruneToSettle()

        const lineCount = await countIndexLines()
        expect(lineCount).to.equal(1)
      })

      it('rewrites _index.jsonl with one line per live entry', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 2,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        await store.save(makeEntry({completedAt: 1, createdAt: 1, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: 2, createdAt: 2, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: 3, createdAt: 3, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: 4, createdAt: 4, status: 'completed', taskId: 'b'}))
        await store.save(makeEntry({completedAt: 5, createdAt: 5, status: 'completed', taskId: 'b'}))

        await waitForPruneToSettle()

        const indexRaw = await readFile(indexPath, 'utf8')
        const lines = indexRaw.split('\n').filter(Boolean)
        const taskIds = lines.map((l) => (JSON.parse(l) as Record<string, unknown>).taskId)
        expect(taskIds.sort()).to.deep.equal(['a', 'b'])
      })

      it('preserves _index.jsonl.bak across one cycle', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 2,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'bak'}))
        }

        await waitForPruneToSettle()

        const bakPath = join(storeDir, '_index.jsonl.bak')
        const bakRaw = await readFile(bakPath, 'utf8')
        // Bak holds the pre-compaction index — multiple lines for 'bak'.
        const bakLines = bakRaw.split('\n').filter(Boolean)
        expect(bakLines.length).to.be.greaterThan(1)
      })

      it('unlinks orphan data files (taskId not in live map)', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 2,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        // Pre-create an orphan data file with no index entry.
        await mkdir(dataDir, {recursive: true})
        await writeFile(join(dataDir, 'tsk-orphan.json'), JSON.stringify({fake: true}), 'utf8')

        // Trigger compaction by saving same taskId multiple times.
        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'live'}))
        }

        await waitForPruneToSettle()

        const dataFiles = await readdir(dataDir)
        expect(dataFiles).to.not.include('tsk-orphan.json')
        expect(dataFiles).to.include('tsk-live.json')
      })

      it('atomic rename — no half-written index visible during compaction', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 2,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'atomic'}))
        }

        await waitForPruneToSettle()

        const allFiles = await readdir(storeDir)
        expect(allFiles).to.not.include('_index.jsonl.tmp')
        expect(allFiles).to.include('_index.jsonl')
      })
    })

    describe('concurrency', () => {
      it('concurrent saves dedupe — one prune pass runs', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: 2,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        // Burst 5 concurrent saves
        const now = Date.now()
        await Promise.all([
          store.save(makeEntry({completedAt: now + 1, createdAt: now + 1, status: 'completed', taskId: 'b1'})),
          store.save(makeEntry({completedAt: now + 2, createdAt: now + 2, status: 'completed', taskId: 'b2'})),
          store.save(makeEntry({completedAt: now + 3, createdAt: now + 3, status: 'completed', taskId: 'b3'})),
          store.save(makeEntry({completedAt: now + 4, createdAt: now + 4, status: 'completed', taskId: 'b4'})),
          store.save(makeEntry({completedAt: now + 5, createdAt: now + 5, status: 'completed', taskId: 'b5'})),
        ])

        await waitForPruneToSettle()

        // Only the newest 2 should survive after a single prune pass.
        const result = await store.list()
        expect(result.map((r) => r.taskId).sort()).to.deep.equal(['b4', 'b5'])
      })

      it('save() returns before prune/compaction completes', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: 1,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        // Pre-load 5 entries to make prune work non-trivial
        for (let i = 0; i < 5; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeEntry({completedAt: Date.now() + i, createdAt: Date.now() + i, status: 'completed', taskId: `pre${i}`}))
        }

        await waitForPruneToSettle()

        // Time a single save; assert it doesn't block on heavy prune work.
        const t0 = Date.now()
        await store.save(makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'fast'}))
        const elapsed = Date.now() - t0

        // Save should complete well under typical prune-pass time (<100ms generous bound).
        expect(elapsed).to.be.lessThan(100)
      })

      it('unlink race on already-deleted data file does not throw', async () => {
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 1,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: Number.POSITIVE_INFINITY,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        const old = Date.now() - 2 * ONE_DAY_MS
        await store.save(makeEntry({completedAt: old, createdAt: old, status: 'completed', taskId: 'race'}))

        // Pre-unlink the data file out-of-band before prune fires.
        await rm(join(dataDir, 'tsk-race.json'), {force: true})

        // Trigger prune via a fresh save.
        let threw = false
        try {
          await store.save(makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'trigger'}))
          await waitForPruneToSettle()
        } catch {
          threw = true
        }

        expect(threw).to.equal(false)
      })
    })
  })
})
