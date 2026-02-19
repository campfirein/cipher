import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {CurateLogEntry, CurateLogOperation} from '../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {TaskInfo} from '../../../../src/server/core/domain/transport/task-info.js'
import type {ICurateLogStore} from '../../../../src/server/core/interfaces/storage/i-curate-log-store.js'

import {computeSummary, CurateLogHandler} from '../../../../src/server/infra/process/curate-log-handler.js'

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    clientId: 'client-1',
    content: 'test context',
    createdAt: Date.now(),
    projectPath: '/app',
    taskId: 'task-abc',
    type: 'curate',
    ...overrides,
  }
}

function makeStore(sandbox: SinonSandbox): ICurateLogStore & {
  getById: SinonStub
  getNextId: SinonStub
  list: SinonStub
  save: SinonStub
} {
  return {
    getById: sandbox.stub().resolves(null),
    getNextId: sandbox.stub().resolves('cur-1000'),
    list: sandbox.stub().resolves([]),
    save: sandbox.stub().resolves(),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('curate-log-handler', () => {

// ── computeSummary ─────────────────────────────────────────────────────────

describe('computeSummary', () => {
  it('should return all zeros for empty operations', () => {
    const summary = computeSummary([])
    expect(summary).to.deep.equal({added: 0, deleted: 0, failed: 0, merged: 0, updated: 0})
  })

  it('should count ADD operations', () => {
    const ops: CurateLogOperation[] = [
      {path: '/a.md', status: 'success', type: 'ADD'},
      {path: '/b.md', status: 'success', type: 'ADD'},
    ]
    expect(computeSummary(ops).added).to.equal(2)
  })

  it('should count UPDATE operations', () => {
    const ops: CurateLogOperation[] = [{path: '/a.md', status: 'success', type: 'UPDATE'}]
    expect(computeSummary(ops).updated).to.equal(1)
  })

  it('should count MERGE operations', () => {
    const ops: CurateLogOperation[] = [{path: '/a.md', status: 'success', type: 'MERGE'}]
    expect(computeSummary(ops).merged).to.equal(1)
  })

  it('should count DELETE operations', () => {
    const ops: CurateLogOperation[] = [{path: '/a.md', status: 'success', type: 'DELETE'}]
    expect(computeSummary(ops).deleted).to.equal(1)
  })

  it('should count UPSERT with "created new" message as added', () => {
    const ops: CurateLogOperation[] = [
      {message: 'created new topic', path: '/a.md', status: 'success', type: 'UPSERT'},
    ]
    const summary = computeSummary(ops)
    expect(summary.added).to.equal(1)
    expect(summary.updated).to.equal(0)
  })

  it('should count UPSERT without "created new" message as updated', () => {
    const ops: CurateLogOperation[] = [
      {message: 'updated existing', path: '/a.md', status: 'success', type: 'UPSERT'},
    ]
    const summary = computeSummary(ops)
    expect(summary.updated).to.equal(1)
    expect(summary.added).to.equal(0)
  })

  it('should count UPSERT with no message as updated', () => {
    const ops: CurateLogOperation[] = [{path: '/a.md', status: 'success', type: 'UPSERT'}]
    expect(computeSummary(ops).updated).to.equal(1)
  })

  it('should count failed operations regardless of type', () => {
    const ops: CurateLogOperation[] = [
      {path: '/a.md', status: 'failed', type: 'ADD'},
      {path: '/b.md', status: 'failed', type: 'DELETE'},
    ]
    const summary = computeSummary(ops)
    expect(summary.failed).to.equal(2)
    expect(summary.added).to.equal(0)
    expect(summary.deleted).to.equal(0)
  })
})

// ============================================================================
// CurateLogHandler
// ============================================================================

describe('CurateLogHandler', () => {
  let sandbox: SinonSandbox
  let store: ReturnType<typeof makeStore>
  let handler: CurateLogHandler

  beforeEach(() => {
    sandbox = createSandbox()
    store = makeStore(sandbox)
    handler = new CurateLogHandler(() => store)
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ==========================================================================
  // onTaskCreate
  // ==========================================================================

  describe('onTaskCreate', () => {
    it('should create a processing entry and return logId for curate task', async () => {
      const task = makeTask()
      const result = await handler.onTaskCreate(task)

      expect(result).to.deep.equal({logId: 'cur-1000'})
      expect(store.save.calledOnce).to.be.true

      const savedEntry: CurateLogEntry = store.save.firstCall.args[0]
      expect(savedEntry.status).to.equal('processing')
      expect(savedEntry.id).to.equal('cur-1000')
      expect(savedEntry.taskId).to.equal('task-abc')
      expect(savedEntry.input.context).to.equal('test context')
    })

    it('should include folders in input for curate-folder task', async () => {
      const task = makeTask({folderPath: '/app/src', type: 'curate-folder'})
      await handler.onTaskCreate(task)

      const savedEntry: CurateLogEntry = store.save.firstCall.args[0]
      expect(savedEntry.input.folders).to.deep.equal(['/app/src'])
    })

    it('should include files in input when task has files', async () => {
      const task = makeTask({files: ['src/auth.ts', 'src/middleware.ts']})
      await handler.onTaskCreate(task)

      const savedEntry: CurateLogEntry = store.save.firstCall.args[0]
      expect(savedEntry.input.files).to.deep.equal(['src/auth.ts', 'src/middleware.ts'])
    })

    it('should skip non-curate task types', async () => {
      const task = makeTask({type: 'query'})
      const result = await handler.onTaskCreate(task)

      expect(result).to.be.undefined
      expect(store.save.called).to.be.false
    })

    it('should skip task without projectPath', async () => {
      const task = makeTask({projectPath: undefined})
      const result = await handler.onTaskCreate(task)

      expect(result).to.be.undefined
      expect(store.save.called).to.be.false
    })

    it('should return undefined if store.getNextId fails', async () => {
      store.getNextId.rejects(new Error('disk full'))

      const task = makeTask()
      const result = await handler.onTaskCreate(task)

      expect(result).to.be.undefined
    })

    it('should return logId even if save fails', async () => {
      store.save.rejects(new Error('write error'))

      const task = makeTask()
      const result = await handler.onTaskCreate(task)

      // logId is still returned — save failure is best-effort
      expect(result).to.deep.equal({logId: 'cur-1000'})
    })
  })

  // ==========================================================================
  // onToolResult
  // ==========================================================================

  describe('onToolResult', () => {
    beforeEach(async () => {
      await handler.onTaskCreate(makeTask())
    })

    it('should collect curate operations from tool result', () => {
      handler.onToolResult('task-abc', {
        result: {
          applied: [
            {path: '/topics/auth.md', status: 'success', type: 'ADD'},
          ],
        },
        sessionId: 'sess-1',
        success: true,
        taskId: 'task-abc',
        toolName: 'curate',
      } as never)

      // Operations should be stored internally
      // Verified by checking onTaskCompleted uses them
    })

    it('should silently skip unknown taskId', () => {
      expect(() => {
        handler.onToolResult('unknown-task', {
          result: {applied: [{path: '/a.md', status: 'success', type: 'ADD'}]},
          sessionId: 'sess-1',
          success: true,
          taskId: 'unknown-task',
          toolName: 'curate',
        } as never)
      }).to.not.throw()
    })
  })

  // ==========================================================================
  // onTaskCompleted
  // ==========================================================================

  describe('onTaskCompleted', () => {
    beforeEach(async () => {
      const processingEntry: CurateLogEntry = {
        id: 'cur-1000',
        input: {context: 'test context'},
        operations: [],
        startedAt: Date.now() - 1000,
        status: 'processing',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-abc',
      }
      store.getById.resolves(processingEntry)
      await handler.onTaskCreate(makeTask())

      // Inject operations via onToolResult
      handler.onToolResult('task-abc', {
        result: {applied: [{path: '/a.md', status: 'success', type: 'ADD'}]},
        sessionId: 'sess-1',
        success: true,
        taskId: 'task-abc',
        toolName: 'curate',
      } as never)
    })

    it('should save completed entry with correct status and operations', async () => {
      await handler.onTaskCompleted('task-abc', 'Great job!', makeTask())

      expect(store.save.callCount).to.equal(2) // once for processing, once for completed
      const completedEntry = store.save.secondCall.args[0] as {operations: unknown[]; response?: string; status: string; summary: {added: number; failed: number}}
      expect(completedEntry.status).to.equal('completed')
      expect(completedEntry.operations).to.have.lengthOf(1)
      expect(completedEntry.summary.added).to.equal(1)
      expect(completedEntry.response).to.equal('Great job!')
    })

    it('should compute correct summary from collected operations', async () => {
      handler.onToolResult('task-abc', {
        result: {applied: [{path: '/b.md', status: 'failed', type: 'UPDATE'}]},
        sessionId: 'sess-1',
        success: true,
        taskId: 'task-abc',
        toolName: 'curate',
      } as never)

      await handler.onTaskCompleted('task-abc', '', makeTask())

      const completedEntry: CurateLogEntry = store.save.secondCall.args[0]
      expect(completedEntry.summary.added).to.equal(1)
      expect(completedEntry.summary.failed).to.equal(1)
    })

    it('should be a no-op for unknown taskId', async () => {
      await handler.onTaskCompleted('unknown-task', 'result', makeTask())
      // Should not throw; save should not be called again
      expect(store.save.callCount).to.equal(1) // only the initial processing save
    })
  })

  // ==========================================================================
  // onTaskError
  // ==========================================================================

  describe('onTaskError', () => {
    beforeEach(async () => {
      const processingEntry: CurateLogEntry = {
        id: 'cur-1000',
        input: {},
        operations: [],
        startedAt: Date.now() - 500,
        status: 'processing',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-abc',
      }
      store.getById.resolves(processingEntry)
      await handler.onTaskCreate(makeTask())
    })

    it('should save error entry with error message', async () => {
      await handler.onTaskError('task-abc', 'Something broke', makeTask())

      expect(store.save.callCount).to.equal(2)
      const errorEntry = store.save.secondCall.args[0] as {error?: string; status: string}
      expect(errorEntry.status).to.equal('error')
      expect(errorEntry.error).to.equal('Something broke')
    })

    it('should be a no-op for unknown taskId', async () => {
      await handler.onTaskError('unknown-task', 'error', makeTask())
      expect(store.save.callCount).to.equal(1) // only initial processing save
    })
  })

  // ==========================================================================
  // cleanup
  // ==========================================================================

  describe('cleanup', () => {
    it('should remove task state so subsequent calls are no-ops', async () => {
      await handler.onTaskCreate(makeTask())
      handler.cleanup('task-abc')

      // After cleanup, onTaskCompleted should be a no-op
      const callCountBefore = store.save.callCount
      await handler.onTaskCompleted('task-abc', 'result', makeTask())
      expect(store.save.callCount).to.equal(callCountBefore)
    })

    it('should be safe to call for unknown taskId', () => {
      expect(() => handler.cleanup('nonexistent')).to.not.throw()
    })
  })
})

}) // end curate-log-handler
