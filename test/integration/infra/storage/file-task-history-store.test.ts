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
    // Use crypto.randomUUID for guaranteed uniqueness — under high load
    // (full suite run) two consecutive tests can collide on Date.now()+Math.random.
    tempDir = join(tmpdir(), `brv-task-history-test-${Date.now()}-${(await import('node:crypto')).randomUUID()}`)
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
    // Deterministic flush of the current outer store's pending prune/compaction
    // before we delete tempDir. Sub-tests that use a private `raceStore` are
    // responsible for flushing it themselves (see C1/B2 tests).
    await store.flushPendingOperations()
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
        makeEntry({
          completedAt: 350,
          createdAt: 300,
          projectPath: '/a',
          status: 'completed',
          taskId: 't3',
          type: 'query',
        }),
      )
      await store.save(makeEntry({createdAt: 400, projectPath: '/a', status: 'created', taskId: 't4', type: 'curate'}))

      const byProject = await store.list({projectPath: '/a'})
      expect(byProject.map((r) => r.taskId).sort()).to.deep.equal(['t1', 't3', 't4'])

      const byStatus = await store.list({status: ['completed']})
      expect(byStatus.map((r) => r.taskId)).to.deep.equal(['t3'])

      const byType = await store.list({type: ['query']})
      expect(byType.map((r) => r.taskId)).to.deep.equal(['t3'])

      const byRange = await store.list({createdAfter: 150, createdBefore: 350})
      expect(byRange.map((r) => r.taskId).sort()).to.deep.equal(['t2', 't3'])
    })

    it('list returns newest-first by createdAt', async () => {
      await store.save(makeEntry({createdAt: 300, taskId: 'mid'}))
      await store.save(makeEntry({createdAt: 100, taskId: 'old'}))
      await store.save(makeEntry({createdAt: 500, taskId: 'new'}))

      const result = await store.list()
      expect(result.map((r) => r.taskId)).to.deep.equal(['new', 'mid', 'old'])
    })

    it('list returns ALL matches (M2.16: handler paginates, no store-level slice)', async () => {
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.save(makeEntry({createdAt: 100 * (i + 1), taskId: `id-${i}`}))
      }

      const result = await store.list()
      expect(result.map((r) => r.taskId)).to.deep.equal(['id-4', 'id-3', 'id-2', 'id-1', 'id-0'])
    })

    it('list filters by provider[] / model[] (M2.16)', async () => {
      await store.save(makeEntry({model: 'gpt-5-pro', provider: 'openai', taskId: 'a1'}))
      await store.save(makeEntry({model: 'claude-sonnet-4-6', provider: 'anthropic', taskId: 'a2'}))
      await store.save(makeEntry({taskId: 'a3'})) // no provider/model

      const byProvider = await store.list({provider: ['openai']})
      expect(byProvider.map((r) => r.taskId)).to.deep.equal(['a1'])

      const byModel = await store.list({model: ['claude-sonnet-4-6']})
      expect(byModel.map((r) => r.taskId)).to.deep.equal(['a2'])
    })

    it('list returns TaskListItem shape (no detail leak)', async () => {
      const entry = makeEntry({
        reasoningContents: [{content: 'why', timestamp: 1}],
        responseContent: 'big response',
        sessionId: 'sess',
        taskId: 'detailed',
        toolCalls: [{args: {}, callId: 'c1', sessionId: 'sess', status: 'completed', timestamp: 1, toolName: 'read'}],
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
      await store.save(makeEntry({completedAt: 3, result: 'r', startedAt: 2, status: 'completed', taskId: 'repeat'}))

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

    it('deleteMany single pass — appends multiple tombstones, returns ids of newly-deleted', async () => {
      await store.save(completedEntry('a'))
      await store.save(completedEntry('b'))
      await store.save(completedEntry('c'))

      const removed = await store.deleteMany(['a', 'b', 'c'])
      expect(removed).to.have.members(['a', 'b', 'c'])

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

      const removed = await store.deleteMany(['race-a', 'race-b'])
      expect(removed).to.have.members(['race-a', 'race-b'])

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
      await store.save(makeEntry({completedAt: 2, startedAt: 1, status: 'cancelled', taskId: 'cancelled-1'}))

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
      // `daemonStartedAt` is set FAR IN THE FUTURE so every save in this
      // describe registers `lastSavedAt < daemonStartedAt` — i.e. the C0
      // gate treats them as pre-boot orphans (recoverable). The new
      // 'daemon-startup gate (C0)' describe below tests the inverse.
      store = new FileTaskHistoryStore({
        baseDir: tempDir,
        daemonStartedAt: Date.now() + 60_000_000_000,
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

    // N1 — chmod-based test only meaningful on POSIX where directory
    // permissions enforce. Windows ignores chmod for FAT/NTFS perms.
    const itPosix = process.platform === 'win32' ? it.skip : it
    itPosix('N1 — writeAtomic failure leaves index unchanged (no orphaned recovery line)', async () => {
      // Sequential persistRecovery semantics: if the data-file write fails,
      // the recovery line MUST NOT be appended. Otherwise the index would
      // claim status='error' while the on-disk data file still says
      // 'started' — list() and getById() would diverge for the same row.
      //
      // The previous parallel implementation ran writeAtomic and appendFile
      // concurrently with independent catches: if writeAtomic failed but
      // appendFile succeeded, the index gained an orphan recovery line.

      await store.save(staleStartedEntry('pf'))

      // Snapshot index state BEFORE recovery attempt.
      const indexBefore = await readFile(indexPath, 'utf8')

      // Make dataDir read-only so writeAtomic's writeFile-to-tmp fails with EACCES.
      const {chmod} = await import('node:fs/promises')
      await chmod(dataDir, 0o555)

      let threw = false
      try {
        await store.list() // triggers recovery → recoverViaTaskId → persistRecovery
      } catch {
        threw = true
      }

      // Restore writability for afterEach cleanup.
      await chmod(dataDir, 0o755)

      expect(threw, 'recovery threw — must swallow disk errors').to.equal(false)

      // Sequential: writeAtomic fails first → return BEFORE appendFile → no new line.
      const indexAfter = await readFile(indexPath, 'utf8')
      expect(indexAfter, 'index gained an orphan recovery line despite data-file write failure').to.equal(indexBefore)
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

  describe('daemon-startup gate (C0)', () => {
    // These tests use the DEFAULT daemonStartedAt (Date.now() at construction),
    // so any save() inside the test registers `lastSavedAt > daemonStartedAt` and
    // is treated as a "live in-flight" entry that must NOT be recovered. This
    // covers the regression where >10-min-running curate/dream tasks were being
    // ping-ponged to `error: INTERRUPTED` on every list() / getById() call.
    const STALE_THRESHOLD_MS = 100

    let liveStore: FileTaskHistoryStore

    beforeEach(() => {
      liveStore = new FileTaskHistoryStore({
        baseDir: tempDir,
        // daemonStartedAt defaults to Date.now() — saves are post-boot
        maxAgeDays: 0,
        maxEntries: Number.POSITIVE_INFINITY,
        maxIndexBloatRatio: Number.POSITIVE_INFINITY,
        staleThresholdMs: STALE_THRESHOLD_MS,
      })
    })

    // eslint-disable-next-line unicorn/consistent-function-scoping
    function liveStartedEntry(taskId: string, createdAtOffsetMs = 200): TaskHistoryEntry {
      const createdAt = Date.now() - createdAtOffsetMs
      return makeEntry({
        createdAt,
        startedAt: createdAt + 10,
        status: 'started',
        taskId,
      })
    }

    it('list() does NOT recover live entries (lastSavedAt > daemonStartedAt) even when stale by age', async () => {
      await liveStore.save(liveStartedEntry('live-task'))

      // Wait past stale threshold so isStale would otherwise fire.
      await new Promise<void>((r) => {
        setTimeout(() => r(), 150)
      })

      const result = await liveStore.list()
      expect(result).to.have.lengthOf(1)
      expect(result[0].status).to.equal('started')
      expect(result[0].taskId).to.equal('live-task')

      // No recovery line appended — only the original save line exists.
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(1)
    })

    it('list() does NOT ping-pong — repeated list+save loops keep entry as `started`', async () => {
      // Reproduces the original C0 bug scenario: long-running task whose
      // throttled saves alternate with WebUI list() polls.
      await liveStore.save(liveStartedEntry('no-pingpong'))

      await new Promise<void>((r) => {
        setTimeout(() => r(), 150)
      })

      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        const result = await liveStore.list()
        expect(result, `iteration ${i}`).to.have.lengthOf(1)
        expect(result[0].status, `iteration ${i}`).to.equal('started')

        // Simulate the next throttled lifecycle save (TaskHistoryHook.onTaskUpdate).
        // eslint-disable-next-line no-await-in-loop
        await liveStore.save(liveStartedEntry('no-pingpong'))
      }

      // Index has only the 6 save lines (1 initial + 5 re-saves), zero recoveries.
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(6)

      for (const lineRaw of lines) {
        const parsed = JSON.parse(lineRaw) as Record<string, unknown>
        expect(parsed.status).to.equal('started')
      }
    })

    it('getById() does NOT recover live entries — returns original `started` entry as-is', async () => {
      await liveStore.save(liveStartedEntry('live-get'))

      await new Promise<void>((r) => {
        setTimeout(() => r(), 150)
      })

      const fetched = await liveStore.getById('live-get')
      expect(fetched).to.exist
      expect(fetched!.status).to.equal('started')

      // No recovery line appended.
      const indexRaw = await readFile(indexPath, 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      expect(lines).to.have.lengthOf(1)

      // Data file untouched (no `error` payload).
      const dataRaw = await readFile(join(dataDir, 'tsk-live-get.json'), 'utf8')
      const onDisk = JSON.parse(dataRaw) as Record<string, unknown>
      expect(onDisk.status).to.equal('started')
    })

    it('list() DOES recover entries from a previous daemon boot (lastSavedAt < daemonStartedAt)', async () => {
      // Simulate "previous daemon left an orphan" by writing index + data file
      // directly with `lastSavedAt` set to a pre-boot time, then constructing a
      // new store whose daemonStartedAt is AFTER that timestamp.
      const previousBootTime = Date.now() - 1_000_000
      const taskId = 'leftover-task'
      const createdAt = previousBootTime
      const entry = makeEntry({
        createdAt,
        startedAt: createdAt + 10,
        status: 'started',
        taskId,
      })

      await mkdir(dataDir, {recursive: true})
      await writeFile(join(dataDir, `tsk-${taskId}.json`), JSON.stringify(entry, null, 2), 'utf8')

      const indexLine = {
        content: entry.content,
        createdAt,
        // Pre-boot: previous daemon's last save before crash.
        lastSavedAt: createdAt + 100,
        projectPath: '/p',
        schemaVersion: 1,
        startedAt: createdAt + 10,
        status: 'started',
        taskId,
        type: 'curate',
      }
      await mkdir(storeDir, {recursive: true})
      await writeFile(indexPath, JSON.stringify(indexLine) + '\n', 'utf8')

      const newDaemon = new FileTaskHistoryStore({
        baseDir: tempDir,
        daemonStartedAt: Date.now(), // AFTER the indexLine.lastSavedAt
        maxAgeDays: 0,
        maxEntries: Number.POSITIVE_INFINITY,
        maxIndexBloatRatio: Number.POSITIVE_INFINITY,
        staleThresholdMs: STALE_THRESHOLD_MS,
      })

      const result = await newDaemon.list()
      expect(result).to.have.lengthOf(1)
      expect(result[0].status).to.equal('error')
      expect(result[0].error).to.deep.equal({
        code: 'INTERRUPTED',
        message: 'Interrupted (daemon terminated)',
        name: 'TaskError',
      })
    })

    it('list() recovers legacy index lines without lastSavedAt (back-compat)', async () => {
      // Lines written by an older codebase have no `lastSavedAt` field. Treat
      // them as eligible for stale-recovery so existing on-disk state from
      // pre-C0 deploys is still cleaned up.
      const taskId = 'legacy-task'
      const createdAt = Date.now() - 1_000_000
      const entry = makeEntry({
        createdAt,
        startedAt: createdAt + 10,
        status: 'started',
        taskId,
      })

      await mkdir(dataDir, {recursive: true})
      await writeFile(join(dataDir, `tsk-${taskId}.json`), JSON.stringify(entry, null, 2), 'utf8')

      // Index line WITHOUT lastSavedAt.
      const legacyLine = {
        content: entry.content,
        createdAt,
        projectPath: '/p',
        schemaVersion: 1,
        startedAt: createdAt + 10,
        status: 'started',
        taskId,
        type: 'curate',
      }
      await mkdir(storeDir, {recursive: true})
      await writeFile(indexPath, JSON.stringify(legacyLine) + '\n', 'utf8')

      const newDaemon = new FileTaskHistoryStore({
        baseDir: tempDir,
        daemonStartedAt: Date.now(),
        maxAgeDays: 0,
        maxEntries: Number.POSITIVE_INFINITY,
        maxIndexBloatRatio: Number.POSITIVE_INFINITY,
        staleThresholdMs: STALE_THRESHOLD_MS,
      })

      const result = await newDaemon.list()
      expect(result).to.have.lengthOf(1)
      expect(result[0].status).to.equal('error')
    })

    it('save() persists `lastSavedAt` on every appended index line', async () => {
      const before = Date.now()
      await liveStore.save(makeEntry({taskId: 'with-lastSavedAt'}))
      const after = Date.now()

      const indexRaw = await readFile(indexPath, 'utf8')
      const line = JSON.parse(indexRaw.trim()) as Record<string, unknown>
      expect(line.lastSavedAt, 'lastSavedAt missing on save').to.be.a('number')
      expect(line.lastSavedAt).to.be.at.least(before)
      expect(line.lastSavedAt).to.be.at.most(after)
    })
  })

  describe('prune + compaction', () => {
    const ONE_DAY_MS = 86_400_000

    // eslint-disable-next-line unicorn/consistent-function-scoping
    async function countIndexLines(): Promise<number> {
      const raw = await readFile(indexPath, 'utf8').catch(() => '')
      return raw.split('\n').filter(Boolean).length
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
          makeEntry({
            completedAt: now - 2 * ONE_DAY_MS,
            createdAt: now - 2 * ONE_DAY_MS,
            status: 'completed',
            taskId: 'old',
          }),
        )
        // Trigger prune via a fresh save (within threshold).
        await store.save(makeEntry({completedAt: now, createdAt: now, status: 'completed', taskId: 'fresh'}))

        await store.flushPendingOperations()

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

        await store.flushPendingOperations()

        const result = await store.list()
        expect(result.map((r) => r.taskId).sort()).to.deep.equal(['recent', 'recent2'])
      })

      it('maxAgeDays: 0 disables age prune', async () => {
        // Outer beforeEach already constructs store with maxAgeDays: 0.
        // Save an ancient entry; assert it's still in the live list after settle.
        await store.save(makeEntry({completedAt: 2, createdAt: 1, status: 'completed', taskId: 'ancient'}))
        await store.flushPendingOperations()

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
          await store.save(makeEntry({completedAt: now + i, createdAt: now + i, status: 'completed', taskId: `c${i}`}))
        }

        await store.flushPendingOperations()

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

        await store.flushPendingOperations()

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
          await store.save(
            makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'spam'}),
          )
        }

        await store.flushPendingOperations()

        const lineCount = await countIndexLines()
        expect(lineCount).to.equal(1)
      })

      it('rewrites _index.jsonl with one line per live entry', async () => {
        // ratio=1 ensures compaction fires whenever total > live (any duplicate).
        // Originally ratio=2 — flaky under load because timer 1's compaction
        // could fire mid-saves and converge to a state where the FINAL index
        // still had a duplicate (3/2=1.5 < 2 → no further compaction).
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 1,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        await store.save(makeEntry({completedAt: 1, createdAt: 1, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: 2, createdAt: 2, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: 3, createdAt: 3, status: 'completed', taskId: 'a'}))
        await store.save(makeEntry({completedAt: 4, createdAt: 4, status: 'completed', taskId: 'b'}))
        await store.save(makeEntry({completedAt: 5, createdAt: 5, status: 'completed', taskId: 'b'}))

        await store.flushPendingOperations()

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
          await store.save(
            makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'bak'}),
          )
        }

        await store.flushPendingOperations()

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
          await store.save(
            makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'live'}),
          )
        }

        await store.flushPendingOperations()

        const dataFiles = await readdir(dataDir)
        expect(dataFiles).to.not.include('tsk-orphan.json')
        expect(dataFiles).to.include('tsk-live.json')
      })

      it('N2 — recoverPreRenameSaves applies C0 gate to orphan data files (no resurrection of stale entries)', async () => {
        // An orphan data file with status='started' and a pre-boot
        // createdAt must be recovered to status='error' on encounter, NOT
        // re-appended as a live entry. The previous code re-stamped
        // lastSavedAt=Date.now() unconditionally, so the C0 gate then
        // protected the resurrection forever as a current-boot live task.
        const STALE_THRESHOLD_MS = 100
        store = new FileTaskHistoryStore({
          baseDir: tempDir,
          // Daemon boot now — the orphan's lastSavedAt (we don't write one)
          // and createdAt are pre-boot, so the C0 gate qualifies it as
          // recoverable.
          daemonStartedAt: Date.now(),
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 1.5,
          staleThresholdMs: STALE_THRESHOLD_MS,
        })

        const oldCreatedAt = Date.now() - 10 * STALE_THRESHOLD_MS
        const orphanEntry = makeEntry({
          createdAt: oldCreatedAt,
          startedAt: oldCreatedAt + 10,
          status: 'started',
          taskId: 'phantom-revival',
        })

        // Plant the orphan: data file present, NO index line.
        await mkdir(dataDir, {recursive: true})
        await writeFile(join(dataDir, 'tsk-phantom-revival.json'), JSON.stringify(orphanEntry, null, 2), 'utf8')

        // Drive compaction so recoverPreRenameSaves runs and encounters the orphan.
        // Repeated saves on the same taskId inflate the bloat ratio past 1.5.
        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(
            makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'driver'}),
          )
        }

        await store.flushPendingOperations()

        // After compaction, the orphan is reachable via list() (recoverPreRenameSaves
        // re-appended its index line). The fix requires that re-appended line to
        // reflect the recovered (status='error') state, not the original 'started'.
        const list = await store.list()
        const phantom = list.find((t) => t.taskId === 'phantom-revival')
        expect(phantom, 'orphan never reached list — recoverPreRenameSaves dropped it').to.exist
        expect(phantom!.status, 'N2: orphan was resurrected as live instead of recovered to error').to.equal('error')

        // getById must agree.
        const fetched = await store.getById('phantom-revival')
        expect(fetched, 'getById returned undefined for resurrected orphan').to.exist
        expect(fetched!.status).to.equal('error')
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
          await store.save(
            makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'atomic'}),
          )
        }

        await store.flushPendingOperations()

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

        await store.flushPendingOperations()

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
          await store.save(
            makeEntry({completedAt: Date.now() + i, createdAt: Date.now() + i, status: 'completed', taskId: `pre${i}`}),
          )
        }

        await store.flushPendingOperations()

        // Time a single save; assert it doesn't block on heavy prune work.
        const t0 = Date.now()
        await store.save(
          makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'fast'}),
        )
        const elapsed = Date.now() - t0

        // Save should complete well under typical prune-pass time (<100ms generous bound).
        expect(elapsed).to.be.lessThan(100)
      })

      it('C1 — saves landing concurrent with compaction survive (post-rewrite re-read picks them up)', async () => {
        // Reproduces the C1 race: under the OLD code, `sweepOrphanData` was
        // called with a snapshot taken BEFORE `rewriteIndex`. A save() that
        // appended its index line + wrote its data file between the snapshot
        // and the sweep would have its data file unlinked. The fix re-reads
        // the index AFTER the rewrite and unions newly-appended taskIds into
        // the live set before the sweep.
        //
        // Aggressive bloat ratio so compaction fires after every tombstone batch.
        const raceStore = new FileTaskHistoryStore({
          baseDir: tempDir,
          daemonStartedAt: Date.now() + 60_000_000_000,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 1.5,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        // Seed pool that we'll repeatedly tombstone to drive compaction.
        const SEED_COUNT = 10
        const seedIds = Array.from({length: SEED_COUNT}, (_, i) => `seed-${i}`)
        for (const id of seedIds) {
          // eslint-disable-next-line no-await-in-loop
          await raceStore.save(makeEntry({taskId: id}))
        }

        // Burst: tombstone all seeds (drives ratio > 1.5 → compaction fires)
        // and concurrently save 30 racing entries. Without the C1 fix, some
        // race-N data files would be silently unlinked by the sweep.
        const RACE_COUNT = 30
        const raceIds = Array.from({length: RACE_COUNT}, (_, i) => `race-${i}`)

        const racingSaves: Promise<void>[] = []
        for (const id of raceIds) {
          racingSaves.push(raceStore.save(makeEntry({taskId: id})))
        }

        await raceStore.deleteMany(seedIds) // triggers compaction
        await Promise.all(racingSaves)

        await raceStore.flushPendingOperations()

        // Every racing taskId must still be retrievable: index has its line AND
        // data file is intact. With the old code, ~5-15% of race-N would be lost.
        for (const id of raceIds) {
          // eslint-disable-next-line no-await-in-loop
          const fetched = await raceStore.getById(id)
          expect(fetched, `lost race taskId ${id} to C1 sweep race`).to.exist
          expect(fetched!.taskId).to.equal(id)
        }
      })

      it('B2 — deletes landing concurrent with compaction stay deleted (no phantom rows)', async () => {
        // Reproduces the B2 race: under the OLD code, a tombstone whose
        // `appendFile` landed AFTER `maybeCompact` snapshotted the index but
        // BEFORE the rewrite's `rename` would be wiped by the rename — the
        // post-rewrite re-read found no tombstone (rewrite was built from the
        // pre-tombstone snapshot) and `recoverPreRenameSaves` could not
        // recover from the data dir because the delete had already unlinked
        // the data file. Result: index lists the taskId as live, no data
        // file → phantom row in `list()` whose `getById()` returns undefined.
        //
        // Heavy interleaved burst across multiple sub-trials to provoke the
        // race window (snapshot→rename inside maybeCompact). The fix —
        // serializing tombstoneAndUnlink against the snapshot+rewrite via a
        // promise-chain rewriteLock — eliminates the race entirely, so the
        // test asserts ZERO phantoms across the full set.
        const raceStore = new FileTaskHistoryStore({
          baseDir: tempDir,
          // Far-future daemonStartedAt so test saves never trigger stale recovery.
          daemonStartedAt: Date.now() + 60_000_000_000,
          maxAgeDays: 0,
          maxEntries: Number.POSITIVE_INFINITY,
          maxIndexBloatRatio: 1.5,
          staleThresholdMs: Number.POSITIVE_INFINITY,
        })

        // Multiple sub-trials with interleaved saves and deletes — each
        // sub-trial spreads the deleteMany across the save burst so the
        // tombstones land at different points relative to compaction.
        const SUBTRIALS = 8
        const SEEDS_PER_TRIAL = 20
        const FRESH_PER_TRIAL = 40
        const allSeedIds: string[] = []

        for (let trial = 0; trial < SUBTRIALS; trial++) {
          const seedIds = Array.from({length: SEEDS_PER_TRIAL}, (_, i) => `t${trial}-doomed-${i}`)
          const freshIds = Array.from({length: FRESH_PER_TRIAL}, (_, i) => `t${trial}-fresh-${i}`)
          allSeedIds.push(...seedIds)

          for (const id of seedIds) {
            // eslint-disable-next-line no-await-in-loop
            await raceStore.save(
              makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: id}),
            )
          }

          // Interleave: alternate save (triggers firePrune) and delete-of-one
          // so tombstones land at varied compaction phases across the burst.
          const ops: Promise<unknown>[] = []
          for (let i = 0; i < FRESH_PER_TRIAL; i++) {
            ops.push(
              raceStore.save(
                makeEntry({
                  completedAt: Date.now(),
                  createdAt: Date.now(),
                  status: 'completed',
                  taskId: freshIds[i],
                }),
              ),
            )
            if (i < SEEDS_PER_TRIAL) {
              ops.push(raceStore.deleteMany([seedIds[i]]))
            }
          }

          // eslint-disable-next-line no-await-in-loop
          await Promise.all(ops)
          // eslint-disable-next-line no-await-in-loop
          await raceStore.flushPendingOperations()
        }

        // Drain any final cascaded prune.
        await raceStore.flushPendingOperations()

        // Assertion: NO doomed taskId is reachable, NONE appears in list().
        const list = await raceStore.list()
        const phantoms = list.filter((t) => allSeedIds.includes(t.taskId))
        expect(
          phantoms.map((t) => t.taskId),
          `B2 phantoms detected in list() — tombstones lost to compaction race`,
        ).to.deep.equal([])

        for (const id of allSeedIds) {
          // eslint-disable-next-line no-await-in-loop
          const fetched = await raceStore.getById(id)
          expect(fetched, `B2 phantom — getById(${id}) succeeded after delete+compaction race`).to.be.undefined
        }
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
          await store.save(
            makeEntry({completedAt: Date.now(), createdAt: Date.now(), status: 'completed', taskId: 'trigger'}),
          )
          await store.flushPendingOperations()
        } catch {
          threw = true
        }

        expect(threw).to.equal(false)
      })
    })
  })
})
