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

describe('FileTaskHistoryStore (basic)', () => {
  let store: FileTaskHistoryStore
  let tempDir: string
  let storeDir: string
  let dataDir: string
  let indexPath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-task-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    store = new FileTaskHistoryStore({baseDir: tempDir})
    storeDir = join(tempDir, 'task-history')
    dataDir = join(storeDir, 'data')
    indexPath = join(storeDir, '_index.jsonl')
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

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
