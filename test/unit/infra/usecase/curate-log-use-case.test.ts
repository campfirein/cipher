import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {CurateLogEntry} from '../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {ICurateLogStore} from '../../../../src/server/core/interfaces/storage/i-curate-log-store.js'

import {CurateLogUseCase} from '../../../../src/server/infra/usecase/curate-log-use-case.js'

// ============================================================================
// Helpers
// ============================================================================

function makeProcessingEntry(overrides: Partial<CurateLogEntry> = {}): CurateLogEntry {
  return {
    id: 'cur-1000',
    input: {context: 'test context'},
    operations: [],
    startedAt: 1_700_000_000_000,
    status: 'processing',
    summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    taskId: 'task-1',
    ...overrides,
  } as CurateLogEntry
}

function makeCompletedEntry(overrides: Partial<CurateLogEntry> = {}): CurateLogEntry {
  return {
    completedAt: 1_700_000_001_000,
    id: 'cur-1001',
    input: {context: 'add auth', files: ['src/auth.ts']},
    operations: [
      {path: '/topics/auth.md', status: 'success', type: 'ADD'},
      {path: '/topics/jwt.md', status: 'failed', type: 'UPDATE'},
    ],
    response: 'Done! Added auth context.',
    startedAt: 1_700_000_000_000,
    status: 'completed',
    summary: {added: 1, deleted: 0, failed: 1, merged: 0, updated: 0},
    taskId: 'task-2',
    ...overrides,
  } as CurateLogEntry
}

function makeStore(sandbox: SinonSandbox): ICurateLogStore & {
  batchUpdateOperationReviewStatus: SinonStub
  getById: SinonStub
  getNextId: SinonStub
  list: SinonStub
  save: SinonStub
} {
  return {
    batchUpdateOperationReviewStatus: sandbox.stub().resolves(true),
    getById: sandbox.stub().resolves(null),
    getNextId: sandbox.stub().resolves('cur-9999'),
    list: sandbox.stub().resolves([]),
    save: sandbox.stub().resolves(),
  }
}

describe('CurateLogUseCase', () => {
  let sandbox: SinonSandbox
  let store: ReturnType<typeof makeStore>
  let logs: string[]
  let useCase: CurateLogUseCase

  beforeEach(() => {
    sandbox = createSandbox()
    store = makeStore(sandbox)
    logs = []
    useCase = new CurateLogUseCase({
      curateLogStore: store,
      terminal: {
        log(msg?: string) {
          logs.push(msg ?? '')
        },
      },
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ==========================================================================
  // List (no id)
  // ==========================================================================

  describe('list mode', () => {
    it('should show empty state message when no entries', async () => {
      store.list.resolves([])
      await useCase.run({})

      expect(logs.join('\n')).to.include('No curate log entries found')
      expect(logs.join('\n')).to.include('brv curate')
    })

    it('should render table with header and entries', async () => {
      store.list.resolves([makeCompletedEntry()])
      await useCase.run({})

      const output = logs.join('\n')
      expect(output).to.include('ID')
      expect(output).to.include('Status')
      expect(output).to.include('cur-1001')
      expect(output).to.include('completed')
      expect(output).to.include('1 added, 1 failed')
    })

    it('should show processing status with placeholder timestamp', async () => {
      store.list.resolves([makeProcessingEntry()])
      await useCase.run({})

      const output = logs.join('\n')
      expect(output).to.include('processing')
      expect(output).to.include('(processing...)')
    })

    it('should respect limit', async () => {
      await useCase.run({limit: 5})
      expect(store.list.calledWith({limit: 5})).to.be.true
    })

    it('should output JSON format', async () => {
      store.list.resolves([makeCompletedEntry()])
      await useCase.run({format: 'json'})

      const output = logs.join('\n')
      const parsed = JSON.parse(output)
      expect(parsed.command).to.equal('curate view')
      expect(parsed.success).to.be.true
      expect(Array.isArray(parsed.data)).to.be.true
      expect(parsed.retrievedAt).to.be.a('string')
    })

    it('should pass status filter to store.list', async () => {
      await useCase.run({status: ['completed', 'error']})
      expect(store.list.calledWith({limit: 10, status: ['completed', 'error']})).to.be.true
    })

    it('should pass after filter to store.list', async () => {
      const after = 1_700_000_000_000
      await useCase.run({after})
      expect(store.list.calledWith({after, limit: 10})).to.be.true
    })

    it('should pass before filter to store.list', async () => {
      const before = 1_700_000_000_000
      await useCase.run({before})
      expect(store.list.calledWith({before, limit: 10})).to.be.true
    })

    it('should show operations in detail mode', async () => {
      store.list.resolves([makeCompletedEntry()])
      await useCase.run({detail: true})

      const output = logs.join('\n')
      expect(output).to.include('/topics/auth.md')
      expect(output).to.include('[ADD]')
    })

    it('should not show operations when detail is false', async () => {
      store.list.resolves([makeCompletedEntry()])
      await useCase.run({detail: false})

      const output = logs.join('\n')
      expect(output).to.not.include('[ADD]')
    })
  })

  // ==========================================================================
  // Detail (with id)
  // ==========================================================================

  describe('detail mode', () => {
    it('should show not found message when entry does not exist', async () => {
      store.getById.resolves(null)
      await useCase.run({id: 'cur-9999'})

      expect(logs.join('\n')).to.include('No curate log entry found')
    })

    it('should show full detail for completed entry', async () => {
      store.getById.resolves(makeCompletedEntry())
      await useCase.run({id: 'cur-1001'})

      const output = logs.join('\n')
      expect(output).to.include('cur-1001')
      expect(output).to.include('completed')
      expect(output).to.include('add auth')
      expect(output).to.include('src/auth.ts')
      expect(output).to.include('/topics/auth.md')
      expect(output).to.include('1 added, 1 failed')
      expect(output).to.include('Done! Added auth context.')
    })

    it('should show error message for error entries', async () => {
      const errorEntry: CurateLogEntry = {
        completedAt: Date.now(),
        error: 'Something went wrong',
        id: 'cur-999',
        input: {},
        operations: [],
        startedAt: Date.now() - 1000,
        status: 'error',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-err',
      }
      store.getById.resolves(errorEntry)
      await useCase.run({id: 'cur-999'})

      const output = logs.join('\n')
      expect(output).to.include('error')
      expect(output).to.include('Something went wrong')
    })

    it('should not show Finished for processing entries', async () => {
      store.getById.resolves(makeProcessingEntry())
      await useCase.run({id: 'cur-1000'})

      const output = logs.join('\n')
      expect(output).to.not.include('Finished')
    })

    it('should output JSON format for detail', async () => {
      store.getById.resolves(makeCompletedEntry())
      await useCase.run({format: 'json', id: 'cur-1001'})

      const output = logs.join('\n')
      const parsed = JSON.parse(output)
      expect(parsed.command).to.equal('curate view')
      expect(parsed.success).to.be.true
      expect(parsed.data).to.have.property('id', 'cur-1001')
    })

    it('should output JSON error for not-found with json format', async () => {
      store.getById.resolves(null)
      await useCase.run({format: 'json', id: 'cur-missing'})

      const output = logs.join('\n')
      const parsed = JSON.parse(output)
      expect(parsed.success).to.be.false
      expect(parsed.data.error).to.include('cur-missing')
    })

    it('should print FULL context when input.context exceeds 200 chars (no truncation)', async () => {
      const longContext = 'A'.repeat(800)
      store.getById.resolves(makeProcessingEntry({input: {context: longContext}}))
      await useCase.run({id: 'cur-1000'})

      const output = logs.join('\n')
      expect(output).to.include(longContext)
      expect(output).to.not.include('A'.repeat(200) + '...')
    })

    it('should print FULL response when response exceeds 500 chars (no truncation)', async () => {
      const longResponse = 'B'.repeat(900)
      store.getById.resolves(makeCompletedEntry({response: longResponse}))
      await useCase.run({id: 'cur-1001'})

      const output = logs.join('\n')
      expect(output).to.include(longResponse)
      expect(output).to.not.include('B'.repeat(500) + '...')
    })
  })
})
