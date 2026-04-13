import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {TaskInfo} from '../../../../src/server/core/domain/transport/task-info.js'
import type {QueryExecutorResult} from '../../../../src/server/core/interfaces/executor/i-query-executor.js'
import type {IQueryLogStore} from '../../../../src/server/core/interfaces/storage/i-query-log-store.js'

import {TIER_DIRECT_SEARCH} from '../../../../src/server/core/domain/entities/query-log-entry.js'
import {QueryLogHandler} from '../../../../src/server/infra/process/query-log-handler.js'

type QueryResultMetadata = Omit<QueryExecutorResult, 'response'>

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    clientId: 'client-1',
    content: 'what is caching?',
    createdAt: Date.now(),
    projectPath: '/app',
    taskId: 'task-abc',
    type: 'query',
    ...overrides,
  }
}

function makeStore(sandbox: SinonSandbox): IQueryLogStore & {
  getById: SinonStub
  getNextId: SinonStub
  list: SinonStub
  save: SinonStub
} {
  return {
    getById: sandbox.stub().resolves(),
    getNextId: sandbox.stub().resolves('qry-1000'),
    list: sandbox.stub().resolves([]),
    save: sandbox.stub().resolves(),
  }
}

function makeQueryResult(overrides: Partial<QueryResultMetadata> = {}): QueryResultMetadata {
  return {
    matchedDocs: [{path: 'design/caching.md', score: 0.95, title: 'Caching Strategy'}],
    searchMetadata: {resultCount: 3, topScore: 0.95, totalFound: 10},
    tier: TIER_DIRECT_SEARCH,
    timing: {durationMs: 450},
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('QueryLogHandler', () => {
  let sandbox: SinonSandbox
  let store: ReturnType<typeof makeStore>
  let handler: QueryLogHandler

  beforeEach(() => {
    sandbox = createSandbox()
    store = makeStore(sandbox)
    handler = new QueryLogHandler(() => store)
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ── onTaskCreate ─────────────────────────────────────────────────────────

  describe('onTaskCreate', () => {
    it('should create processing entry for query task and return logId', async () => {
      const task = makeTask()
      const result = await handler.onTaskCreate(task)

      expect(result).to.deep.equal({logId: 'qry-1000'})
      expect(store.save.calledOnce).to.be.true

      const savedEntry = store.save.firstCall.args[0]
      expect(savedEntry.id).to.equal('qry-1000')
      expect(savedEntry.status).to.equal('processing')
      expect(savedEntry.query).to.equal('what is caching?')
      expect(savedEntry.taskId).to.equal('task-abc')
      expect(savedEntry.matchedDocs).to.deep.equal([])
      expect(savedEntry.startedAt).to.equal(task.createdAt)
    })

    it('should ignore non-query task types', async () => {
      const curateResult = await handler.onTaskCreate(makeTask({type: 'curate'}))
      const folderResult = await handler.onTaskCreate(makeTask({type: 'curate-folder'}))

      expect(curateResult).to.be.undefined
      expect(folderResult).to.be.undefined
      expect(store.save.called).to.be.false
    })

    it('should ignore tasks without projectPath', async () => {
      const result = await handler.onTaskCreate(makeTask({projectPath: undefined}))

      expect(result).to.be.undefined
      expect(store.save.called).to.be.false
    })

    it('should return undefined if getNextId throws', async () => {
      store.getNextId.rejects(new Error('disk full'))

      const result = await handler.onTaskCreate(makeTask())

      expect(result).to.be.undefined
    })

    it('should return logId even if save fails (memory-first)', async () => {
      store.save.rejects(new Error('write error'))

      const task = makeTask()
      const result = await handler.onTaskCreate(task)

      expect(result).to.deep.equal({logId: 'qry-1000'})

      // Prove memory-first: onTaskCompleted still works despite initial save failure
      store.save.resolves() // Reset save to succeed for completion
      await handler.onTaskCompleted('task-abc', 'response text', task)

      // Last save call (completion) should have status: 'completed'
      expect(store.save.lastCall.args[0].status).to.equal('completed')
    })
  })

  // ── setQueryResult + onTaskCompleted ───────────────────────────────────

  describe('setQueryResult + onTaskCompleted', () => {
    it('should save completed entry with all metadata from setQueryResult', async () => {
      const task = makeTask()
      await handler.onTaskCreate(task)
      handler.setQueryResult('task-abc', makeQueryResult())

      await handler.onTaskCompleted('task-abc', 'Caching uses Redis...', task)

      const savedEntry = store.save.lastCall.args[0]
      // Status + completion fields
      expect(savedEntry.status).to.equal('completed')
      expect(savedEntry.completedAt).to.be.a('number')
      expect(savedEntry.response).to.equal('Caching uses Redis...')
      // Base fields preserved from processing entry
      expect(savedEntry.id).to.equal('qry-1000')
      expect(savedEntry.query).to.equal('what is caching?')
      expect(savedEntry.taskId).to.equal('task-abc')
      expect(savedEntry.startedAt).to.equal(task.createdAt)
      // Metadata merged from setQueryResult
      expect(savedEntry.tier).to.equal(TIER_DIRECT_SEARCH)
      expect(savedEntry.timing).to.deep.equal({durationMs: 450})
      expect(savedEntry.matchedDocs).to.deep.equal([
        {path: 'design/caching.md', score: 0.95, title: 'Caching Strategy'},
      ])
      expect(savedEntry.searchMetadata).to.deep.equal({resultCount: 3, topScore: 0.95, totalFound: 10})
    })

    it('should gracefully degrade if setQueryResult was never called', async () => {
      const task = makeTask()
      await handler.onTaskCreate(task)

      // Skip setQueryResult — simulate case where metadata never arrived
      await handler.onTaskCompleted('task-abc', 'fallback response', task)

      const savedEntry = store.save.lastCall.args[0]
      expect(savedEntry.status).to.equal('completed')
      expect(savedEntry.response).to.equal('fallback response')
      // All metadata fields degrade to undefined/empty
      expect(savedEntry.tier).to.be.undefined
      expect(savedEntry.timing).to.be.undefined
      expect(savedEntry.searchMetadata).to.be.undefined
      expect(savedEntry.matchedDocs).to.deep.equal([])
      // Base fields still preserved
      expect(savedEntry.id).to.equal('qry-1000')
      expect(savedEntry.query).to.equal('what is caching?')
      expect(savedEntry.taskId).to.equal('task-abc')
    })
  })

  // ── onTaskError ──────────────────────────────────────────────────────────

  describe('onTaskError', () => {
    it('should save error entry with metadata when setQueryResult was called', async () => {
      const task = makeTask()
      await handler.onTaskCreate(task)
      handler.setQueryResult('task-abc', makeQueryResult())

      await handler.onTaskError('task-abc', 'LLM failed', task)

      const savedEntry = store.save.lastCall.args[0]
      expect(savedEntry.status).to.equal('error')
      expect(savedEntry.error).to.equal('LLM failed')
      expect(savedEntry.completedAt).to.be.a('number')
      // Base fields preserved
      expect(savedEntry.id).to.equal('qry-1000')
      expect(savedEntry.query).to.equal('what is caching?')
      expect(savedEntry.taskId).to.equal('task-abc')
      // Metadata preserved from setQueryResult
      expect(savedEntry.tier).to.equal(TIER_DIRECT_SEARCH)
      expect(savedEntry.timing).to.deep.equal({durationMs: 450})
      expect(savedEntry.matchedDocs).to.deep.equal([
        {path: 'design/caching.md', score: 0.95, title: 'Caching Strategy'},
      ])
      expect(savedEntry.searchMetadata).to.deep.equal({resultCount: 3, topScore: 0.95, totalFound: 10})
    })

    it('should gracefully degrade if setQueryResult was never called', async () => {
      const task = makeTask()
      await handler.onTaskCreate(task)

      // No setQueryResult — error before executor returned
      await handler.onTaskError('task-abc', 'Agent crashed', task)

      const savedEntry = store.save.lastCall.args[0]
      expect(savedEntry.status).to.equal('error')
      expect(savedEntry.error).to.equal('Agent crashed')
      expect(savedEntry.completedAt).to.be.a('number')
      // Metadata degrades to undefined/empty
      expect(savedEntry.tier).to.be.undefined
      expect(savedEntry.timing).to.be.undefined
      expect(savedEntry.searchMetadata).to.be.undefined
      expect(savedEntry.matchedDocs).to.deep.equal([])
    })
  })

  // ── onTaskCancelled ──────────────────────────────────────────────────────

  describe('onTaskCancelled', () => {
    it('should save cancelled entry with base fields and degraded metadata', async () => {
      const task = makeTask()
      await handler.onTaskCreate(task)

      await handler.onTaskCancelled('task-abc', task)

      const savedEntry = store.save.lastCall.args[0]
      expect(savedEntry.status).to.equal('cancelled')
      expect(savedEntry.completedAt).to.be.a('number')
      // Base fields preserved
      expect(savedEntry.id).to.equal('qry-1000')
      expect(savedEntry.query).to.equal('what is caching?')
      expect(savedEntry.taskId).to.equal('task-abc')
      expect(savedEntry.startedAt).to.equal(task.createdAt)
      // Metadata degrades — setQueryResult was never called
      expect(savedEntry.tier).to.be.undefined
      expect(savedEntry.timing).to.be.undefined
      expect(savedEntry.searchMetadata).to.be.undefined
      expect(savedEntry.matchedDocs).to.deep.equal([])
    })
  })

  // ── cleanup ──────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('should remove in-memory task state', async () => {
      const task = makeTask()
      await handler.onTaskCreate(task)

      handler.cleanup('task-abc')

      // After cleanup, onTaskCompleted should be a no-op (state is gone)
      await handler.onTaskCompleted('task-abc', 'response', task)

      // Only the initial processing save should exist, no completion save
      expect(store.save.callCount).to.equal(1)
      expect(store.save.firstCall.args[0].status).to.equal('processing')
    })

    it('should evict store when last task for project is cleaned up', async () => {
      let factoryCallCount = 0
      const trackingHandler = new QueryLogHandler(() => {
        factoryCallCount++
        return makeStore(sandbox)
      })

      // Two tasks for same project
      await trackingHandler.onTaskCreate(makeTask({taskId: 'task-1'}))
      await trackingHandler.onTaskCreate(makeTask({taskId: 'task-2'}))
      expect(factoryCallCount).to.equal(1) // Shared store

      // Cleanup first — store still alive for task-2
      trackingHandler.cleanup('task-1')

      // Cleanup second — store should be evicted
      trackingHandler.cleanup('task-2')

      // New task for same project — factory called again (fresh store)
      await trackingHandler.onTaskCreate(makeTask({taskId: 'task-3'}))
      expect(factoryCallCount).to.equal(2)
    })
  })

  // ── store sharing ────────────────────────────────────────────────────────

  describe('store sharing', () => {
    it('should share one store for concurrent tasks on same project', async () => {
      let factoryCallCount = 0
      const trackingHandler = new QueryLogHandler(() => {
        factoryCallCount++
        return makeStore(sandbox)
      })

      await trackingHandler.onTaskCreate(makeTask({taskId: 'task-1'}))
      await trackingHandler.onTaskCreate(makeTask({taskId: 'task-2'}))
      await trackingHandler.onTaskCreate(makeTask({taskId: 'task-3'}))

      expect(factoryCallCount).to.equal(1)
    })
  })
})
