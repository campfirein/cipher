 
import {expect} from 'chai'
import sinon from 'sinon'

import type {LlmToolResultEvent} from '../../../../../src/server/core/domain/transport/schemas.js'
import type {TaskInfo} from '../../../../../src/server/core/domain/transport/task-info.js'
import type {IAnalyticsClient} from '../../../../../src/server/core/interfaces/analytics/i-analytics-client.js'
import type {QueryResultMetadata} from '../../../../../src/server/infra/process/query-log-handler.js'

import {AnalyticsBatch} from '../../../../../src/server/core/domain/analytics/batch.js'
import {AnalyticsHook} from '../../../../../src/server/infra/process/analytics-hook.js'
import {AnalyticsEventNames} from '../../../../../src/shared/analytics/event-names.js'

const FIXED_NOW = 1_700_000_000_000

type StubBundle = {
  client: IAnalyticsClient
  flushStub: sinon.SinonStub
  trackStub: sinon.SinonStub
}

const buildAnalyticsClient = (): StubBundle => {
  const trackStub = sinon.stub()
  const flushStub = sinon.stub().resolves(AnalyticsBatch.create([]))
  const client: IAnalyticsClient = {flush: flushStub, track: trackStub}
  return {client, flushStub, trackStub}
}

const buildCurateTask = (overrides: Partial<TaskInfo> = {}): TaskInfo =>
  ({
    clientId: 'client-1',
    completedAt: FIXED_NOW + 5000,
    content: 'curate stuff',
    createdAt: FIXED_NOW,
    projectPath: '/project',
    taskId: 'task-curate-1',
    type: 'curate',
    ...overrides,
  }) as TaskInfo

const buildQueryTask = (overrides: Partial<TaskInfo> = {}): TaskInfo =>
  ({
    clientId: 'client-1',
    completedAt: FIXED_NOW + 1234,
    content: 'query stuff',
    createdAt: FIXED_NOW,
    projectPath: '/project',
    taskId: 'task-query-1',
    toolCalls: [],
    type: 'query',
    ...overrides,
  }) as TaskInfo

const buildToolResult = (ops: Array<Record<string, unknown>>): LlmToolResultEvent => ({
  callId: 'call-1',
  result: JSON.stringify({applied: ops}),
  sessionId: 'session-1',
  taskId: 'task-curate-1',
  timestamp: FIXED_NOW,
  toolName: 'curate' as const,
}) as unknown as LlmToolResultEvent

describe('AnalyticsHook', () => {
  let trackStub: sinon.SinonStub
  let hook: AnalyticsHook

  beforeEach(() => {
    const bundle = buildAnalyticsClient()
    trackStub = bundle.trackStub
    hook = new AnalyticsHook()
    hook.setAnalyticsClient(bundle.client)
  })

  describe('curate task flow', () => {
    it('emits curate_operation_applied per successful op + bumps matching counter; no event for failed op', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)

      const payload = buildToolResult([
        {filePath: '/a.md', needsReview: false, path: 'notes/a', status: 'success', type: 'ADD'},
        {filePath: '/b.md', needsReview: true, path: 'notes/b', status: 'success', type: 'UPDATE'},
        {filePath: '/c.md', needsReview: false, path: 'notes/c', status: 'failed', type: 'ADD'},
      ])
      hook.onToolResult(task.taskId, payload)

      expect(trackStub.callCount).to.equal(2)
      expect(trackStub.firstCall.args[0]).to.equal(AnalyticsEventNames.CURATE_OPERATION_APPLIED)
      const firstProps = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(firstProps.absolute_path).to.equal('/a.md')
      expect(firstProps.knowledge_path).to.equal('notes/a')
      expect(firstProps.operation_type).to.equal('ADD')
      expect(firstProps.needs_review).to.equal(false)
      expect(firstProps).to.not.have.property('tags')
      expect(firstProps).to.not.have.property('keywords')
      expect(firstProps).to.not.have.property('related')

      const secondProps = trackStub.secondCall.args[1] as Record<string, unknown>
      expect(secondProps.needs_review).to.equal(true)
      expect(secondProps.operation_type).to.equal('UPDATE')
    })

    it('emits curate_run_completed at terminal with counter totals + outcome=completed', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      hook.onToolResult(
        task.taskId,
        buildToolResult([
          {filePath: '/a.md', needsReview: false, path: 'a', status: 'success', type: 'ADD'},
          {filePath: '/b.md', needsReview: false, path: 'b', status: 'success', type: 'UPDATE'},
          {filePath: '/c.md', needsReview: false, path: 'c', status: 'success', type: 'DELETE'},
        ]),
      )
      trackStub.resetHistory()

      await hook.onTaskCompleted(task.taskId, '', task)

      expect(trackStub.calledOnce).to.equal(true)
      expect(trackStub.firstCall.args[0]).to.equal(AnalyticsEventNames.CURATE_RUN_COMPLETED)
      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.task_id).to.equal(task.taskId)
      expect(props.task_type).to.equal('curate')
      expect(props.outcome).to.equal('completed')
      expect(props.operations_added).to.equal(1)
      expect(props.operations_updated).to.equal(1)
      expect(props.operations_deleted).to.equal(1)
      expect(props.operations_merged).to.equal(0)
      expect(props.operations_failed).to.equal(0)
      expect(props.pending_review_count).to.equal(0)
      expect(props.duration_ms).to.equal(5000)
    })

    it('emits outcome=partial when at least one op failed', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      hook.onToolResult(
        task.taskId,
        buildToolResult([
          {filePath: '/a.md', needsReview: false, path: 'a', status: 'success', type: 'ADD'},
          {filePath: '/b.md', needsReview: false, path: 'b', status: 'failed', type: 'ADD'},
        ]),
      )
      trackStub.resetHistory()

      await hook.onTaskCompleted(task.taskId, '', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.outcome).to.equal('partial')
      expect(props.operations_failed).to.equal(1)
    })

    it('emits outcome=error on onTaskError', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      trackStub.resetHistory()

      await hook.onTaskError(task.taskId, 'boom', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.outcome).to.equal('error')
    })

    it('emits outcome=cancelled on onTaskCancelled', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      trackStub.resetHistory()

      await hook.onTaskCancelled(task.taskId, task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.outcome).to.equal('cancelled')
    })

    it('counts UPSERT with "created new" message as added; otherwise as updated', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      hook.onToolResult(
        task.taskId,
        buildToolResult([
          {filePath: '/a.md', message: 'created new entry', path: 'a', status: 'success', type: 'UPSERT'},
          {filePath: '/b.md', message: 'updated existing entry', path: 'b', status: 'success', type: 'UPSERT'},
        ]),
      )
      trackStub.resetHistory()

      await hook.onTaskCompleted(task.taskId, '', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.operations_added).to.equal(1)
      expect(props.operations_updated).to.equal(1)
    })

    it('counts pending review when needsReview=true on a successful op', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      hook.onToolResult(
        task.taskId,
        buildToolResult([
          {filePath: '/a.md', needsReview: true, path: 'a', status: 'success', type: 'ADD'},
          {filePath: '/b.md', needsReview: true, path: 'b', status: 'success', type: 'UPDATE'},
        ]),
      )
      trackStub.resetHistory()

      await hook.onTaskCompleted(task.taskId, '', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.pending_review_count).to.equal(2)
    })

    it('uses task_type literal from task (curate-folder)', async () => {
      const task = buildCurateTask({type: 'curate-folder'})
      await hook.onTaskCreate(task)
      await hook.onTaskCompleted(task.taskId, '', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.task_type).to.equal('curate-folder')
    })

    it('skips emitting op when op.filePath is missing (avoids invalid payload)', async () => {
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      hook.onToolResult(
        task.taskId,
        buildToolResult([{needsReview: false, path: 'a', status: 'success', type: 'ADD'}]),
      )

      expect(trackStub.called).to.equal(false)
    })
  })

  describe('query task flow', () => {
    it('emits query_completed at terminal with derived counts + paths', async () => {
      const task = buildQueryTask({
        toolCalls: [
          {args: {filePath: '/a.md'}, sessionId: 's', status: 'completed', timestamp: 1, toolName: 'read_file'},
          {args: {filePath: '/b.md'}, sessionId: 's', status: 'completed', timestamp: 2, toolName: 'read_file'},
          {args: {filePath: '/a.md'}, sessionId: 's', status: 'completed', timestamp: 3, toolName: 'read_file'},
          {
            args: {stubPath: '/c.md'},
            sessionId: 's',
            status: 'completed',
            timestamp: 4,
            toolName: 'expand_knowledge',
          },
          {args: {query: 'foo'}, sessionId: 's', status: 'completed', timestamp: 5, toolName: 'search_knowledge'},
        ],
      } as Partial<TaskInfo>)

      await hook.onTaskCreate(task)
      hook.setQueryResult(task.taskId, {
        matchedDocs: [],
        searchMetadata: {resultCount: 7, topScore: 0.9, totalFound: 7},
        tier: 3,
        timing: {durationMs: 1234},
      } as QueryResultMetadata)
      await hook.onTaskCompleted(task.taskId, '', task)

      expect(trackStub.calledOnce).to.equal(true)
      expect(trackStub.firstCall.args[0]).to.equal(AnalyticsEventNames.QUERY_COMPLETED)
      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.task_id).to.equal(task.taskId)
      expect(props.task_type).to.equal('query')
      expect(props.outcome).to.equal('completed')
      expect(props.duration_ms).to.equal(1234)
      expect(props.read_tool_call_count).to.equal(4) // 3 read_file + 1 expand_knowledge
      expect(props.search_call_count).to.equal(1)
      expect(props.read_doc_count).to.equal(3) // distinct: /a.md, /b.md, /c.md
      expect(props.tier).to.equal(3)
      expect(props.cache_hit).to.equal(false)
      expect(props.matched_doc_count).to.equal(7)
      const paths = props.read_paths_with_metadata as Array<Record<string, unknown>>
      expect(paths).to.have.lengthOf(3)
      // sorted lexicographically
      expect(paths.map((p) => p.absolute_path)).to.deep.equal(['/a.md', '/b.md', '/c.md'])
      // each entry has only absolute_path, no metadata in M12.2
      for (const entry of paths) {
        expect(entry).to.not.have.property('tags')
        expect(entry).to.not.have.property('keywords')
        expect(entry).to.not.have.property('related')
      }
    })

    it('caps read_paths_with_metadata at 10 entries even when more distinct paths exist', async () => {
      const toolCalls = Array.from({length: 15}, (_, i) => ({
        args: {filePath: `/file-${String(i).padStart(2, '0')}.md`},
        sessionId: 's',
        status: 'completed' as const,
        timestamp: i,
        toolName: 'read_file',
      }))
      const task = buildQueryTask({toolCalls} as Partial<TaskInfo>)

      await hook.onTaskCreate(task)
      await hook.onTaskCompleted(task.taskId, '', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      const paths = props.read_paths_with_metadata as Array<Record<string, unknown>>
      expect(paths).to.have.lengthOf(10)
      expect(props.read_doc_count).to.equal(15) // distinct count NOT capped
    })

    for (const tier of [0, 1] as const) {
      it(`cache_hit is true for tier ${tier}`, async () => {
        const localBundle = buildAnalyticsClient()
        const localHook = new AnalyticsHook()
        localHook.setAnalyticsClient(localBundle.client)
        const task = buildQueryTask({taskId: `task-tier-${tier}`})

        await localHook.onTaskCreate(task)
        localHook.setQueryResult(task.taskId, {
          matchedDocs: [],
          tier,
          timing: {durationMs: 5},
        } as QueryResultMetadata)
        await localHook.onTaskCompleted(task.taskId, '', task)

        const props = localBundle.trackStub.firstCall.args[1] as Record<string, unknown>
        expect(props.cache_hit).to.equal(true)
      })
    }

    for (const tier of [2, 3, 4] as const) {
      it(`cache_hit is false for tier ${tier}`, async () => {
        const localBundle = buildAnalyticsClient()
        const localHook = new AnalyticsHook()
        localHook.setAnalyticsClient(localBundle.client)
        const task = buildQueryTask({taskId: `task-tier-${tier}`})

        await localHook.onTaskCreate(task)
        localHook.setQueryResult(task.taskId, {
          matchedDocs: [],
          tier,
          timing: {durationMs: 5},
        } as QueryResultMetadata)
        await localHook.onTaskCompleted(task.taskId, '', task)

        const props = localBundle.trackStub.firstCall.args[1] as Record<string, unknown>
        expect(props.cache_hit).to.equal(false)
      })
    }

    it('emits tier absent + cache_hit=false + matched_doc_count=0 when setQueryResult never ran', async () => {
      const task = buildQueryTask()
      await hook.onTaskCreate(task)
      await hook.onTaskCompleted(task.taskId, '', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.tier).to.equal(undefined)
      expect(props.cache_hit).to.equal(false)
      expect(props.matched_doc_count).to.equal(0)
    })

    it('emits outcome=error on onTaskError for query', async () => {
      const task = buildQueryTask()
      await hook.onTaskCreate(task)

      await hook.onTaskError(task.taskId, 'boom', task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.outcome).to.equal('error')
    })

    it('emits outcome=cancelled on onTaskCancelled for query', async () => {
      const task = buildQueryTask()
      await hook.onTaskCreate(task)

      await hook.onTaskCancelled(task.taskId, task)

      const props = trackStub.firstCall.args[1] as Record<string, unknown>
      expect(props.outcome).to.equal('cancelled')
    })
  })

  describe('lifecycle hygiene', () => {
    it('cleanup(taskId) drops state for both flavors', async () => {
      const curate = buildCurateTask()
      const query = buildQueryTask()
      await hook.onTaskCreate(curate)
      await hook.onTaskCreate(query)
      hook.cleanup(curate.taskId)
      hook.cleanup(query.taskId)

      // After cleanup, terminal hooks should be no-ops
      trackStub.resetHistory()
      await hook.onTaskCompleted(curate.taskId, '', curate)
      await hook.onTaskCompleted(query.taskId, '', query)
      expect(trackStub.called).to.equal(false)
    })

    it('ignores unknown task types (no state created)', async () => {
      const task = buildCurateTask({taskId: 'task-unknown', type: 'unknown' as TaskInfo['type']})
      await hook.onTaskCreate(task)
      await hook.onTaskCompleted(task.taskId, '', task)
      expect(trackStub.called).to.equal(false)
    })

    it('swallows analyticsClient.track throws (does not propagate)', async () => {
      trackStub.throws(new Error('boom'))
      const task = buildCurateTask()
      await hook.onTaskCreate(task)
      hook.onToolResult(
        task.taskId,
        buildToolResult([{filePath: '/a.md', needsReview: false, path: 'a', status: 'success', type: 'ADD'}]),
      )
      // No throw means swallowed
      expect(trackStub.called).to.equal(true)
    })

    it('emit is a no-op when setAnalyticsClient was never called', async () => {
      const bareHook = new AnalyticsHook()
      const task = buildCurateTask()
      await bareHook.onTaskCreate(task)
      // No throws, no client to assert against
      bareHook.onToolResult(
        task.taskId,
        buildToolResult([{filePath: '/a.md', needsReview: false, path: 'a', status: 'success', type: 'ADD'}]),
      )
      await bareHook.onTaskCompleted(task.taskId, '', task)
    })
  })
})
