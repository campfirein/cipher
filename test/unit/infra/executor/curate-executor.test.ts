/**
 * CurateExecutor regression tests
 *
 * Session-leak fix: createTaskSession must not be called before
 * processFileReferences, so a preprocessing failure cannot leak sessions.
 *
 * (UUID-variable-naming tests previously here moved to
 * `test/unit/infra/sandbox/local-sandbox-uuid-variable-naming.test.ts`
 * after the Phase 1 cutover — those test LocalSandbox directly, not the
 * executor, and the executor no longer injects sandbox variables.)
 */

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

/**
 * Mock cipher agent used by the runAgentBody / finalize split tests.
 * Hoisted to module scope (consistent-function-scoping lint rule).
 */
function buildSplitTestAgent(): ICipherAgent {
  return {
    cancel: stub().resolves(false),
    createTaskSession: stub().resolves('session-id'),
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession: stub().resolves(),
    execute: stub().resolves(''),
    executeOnSession: stub().resolves('curated'),
    generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
    getSessionMetadata: stub().resolves(),
    getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    start: stub().resolves(),
    stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
  } as unknown as ICipherAgent
}

import {FileValidationError} from '../../../../src/server/core/domain/errors/task-error.js'
import {FileContextTreeManifestService} from '../../../../src/server/infra/context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../../../../src/server/infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../../../../src/server/infra/context-tree/file-context-tree-summary-service.js'
import {DreamStateService} from '../../../../src/server/infra/dream/dream-state-service.js'
import {CurateExecutor} from '../../../../src/server/infra/executor/curate-executor.js'

describe('CurateExecutor (regression)', () => {
  afterEach(() => {
    restore()
  })


  describe('session-leak fix', () => {
    it('should not call createTaskSession when processFileReferences throws', async () => {
      const createTaskSession = stub().resolves('session-id')
      const deleteTaskSession = stub().resolves()

      const agent = {
        cancel: stub().resolves(false),
        createTaskSession,
        deleteSandboxVariable: stub(),
        deleteSandboxVariableOnSession: stub(),
        deleteSession: stub().resolves(true),
        deleteTaskSession,
        execute: stub().resolves(''),
        executeOnSession: stub().resolves(''),
        generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
        getSessionMetadata: stub().resolves(),
        getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
        listPersistedSessions: stub().resolves([]),
        reset: stub(),
        setSandboxVariable: stub(),
        setSandboxVariableOnSession: stub(),
        start: stub().resolves(),
        stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
      } as unknown as ICipherAgent

      // Pass non-existent file paths to trigger FileValidationError in processFileReferences
      const executor = new CurateExecutor()
      const options = {
        content: 'test content',
        files: ['/nonexistent/path/to/file.txt', '/another/invalid/file.md'],
        taskId: 'task-123',
      }

      try {
        await executor.executeWithAgent(agent, options)
        expect.fail('Should have thrown FileValidationError')
      } catch (error) {
        expect(error).to.be.instanceOf(FileValidationError)
      }

      // Key assertion: createTaskSession was NEVER called because
      // processFileReferences runs BEFORE createTaskSession in the restructured code.
      // Previously, createTaskSession ran first and the session would leak on throw.
      expect(createTaskSession.called).to.be.false
      expect(deleteTaskSession.called).to.be.false
    })
  })

  describe('background queue drain', () => {
    it('waits for background work before returning curate results', async () => {
      const createTaskSession = stub().resolves('session-id')
      const deleteTaskSession = stub().resolves()
      const drainBackgroundWork = stub().resolves()
      const executeOnSession = stub().resolves('curated')

      const agent = {
        cancel: stub().resolves(false),
        createTaskSession,
        deleteSandboxVariable: stub(),
        deleteSandboxVariableOnSession: stub(),
        deleteSession: stub().resolves(true),
        deleteTaskSession,
        drainBackgroundWork,
        execute: stub().resolves(''),
        executeOnSession,
        generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
        getSessionMetadata: stub().resolves(),
        getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
        listPersistedSessions: stub().resolves([]),
        reset: stub(),
        setSandboxVariable: stub(),
        setSandboxVariableOnSession: stub(),
        start: stub().resolves(),
        stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
      } as unknown as ICipherAgent

      const executor = new CurateExecutor()
      const response = await executor.executeWithAgent(agent, {
        clientCwd: '/workspace',
        content: 'capture auth knowledge',
        taskId: 'task-123',
      })

      // Post-cutover: response is the formatted DAG result, not the agent's
      // raw text. The hardcoded `executeOnSession.resolves('curated')` is
      // never read by the new path. We assert the lifecycle instead.
      expect(response).to.include('Curate completed via typed-slot DAG')
      expect(response).to.include('"summary"')
      expect(drainBackgroundWork.calledOnce).to.be.true
      expect(deleteTaskSession.calledOnceWithExactly('session-id')).to.be.true
      expect(drainBackgroundWork.calledBefore(deleteTaskSession)).to.be.true
    })
  })

  describe('workspace scoping - projectRoot for post-processing (PR3)', () => {
    it('should use projectRoot (not worktreeRoot) as baseDir for snapshot service', async () => {
      // The curate executor uses baseDir for FileContextTreeSnapshotService,
      // summary propagation, and manifest rebuild — all of which need the
      // project root where .brv/ lives, not the linked workspace subdir.
      //
      // We verify this by checking that projectRoot takes priority over
      // worktreeRoot in the baseDir computation.
      const executor = new CurateExecutor()

      const createTaskSession = stub().resolves('session-1')
      const deleteTaskSession = stub().resolves()
      const executeOnSession = stub().resolves('curation complete')
      const agent = {
        cancel: stub().resolves(false),
        createTaskSession,
        deleteSandboxVariable: stub(),
        deleteSandboxVariableOnSession: stub(),
        deleteSession: stub().resolves(true),
        deleteTaskSession,
        execute: stub().resolves(''),
        executeOnSession,
        generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
        getSessionMetadata: stub().resolves(),
        getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
        listPersistedSessions: stub().resolves([]),
        reset: stub(),
        setSandboxVariable: stub(),
        setSandboxVariableOnSession: stub(),
        start: stub().resolves(),
        stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
      } as unknown as ICipherAgent

      // Execute with both projectRoot and worktreeRoot provided.
      // projectRoot is where .brv/ lives, worktreeRoot is a linked subdir.
      // Post-processing should use projectRoot, NOT worktreeRoot.
      const result = await executor.executeWithAgent(agent, {
        clientCwd: '/projects/monorepo/packages/api/src',
        content: 'test content for curation',
        projectRoot: '/projects/monorepo',
        taskId: 'task-ws-1',
        worktreeRoot: '/projects/monorepo/packages/api',
      })

      // Post-cutover: response is the formatted DAG result. We assert the
      // lifecycle (session created + cleaned up) rather than the agent's
      // raw response, which the new path no longer threads through.
      expect(result).to.include('Curate completed via typed-slot DAG')
      expect(createTaskSession.calledOnce).to.be.true
      expect(deleteTaskSession.calledOnce).to.be.true
    })

    it('should fall back to clientCwd when projectRoot is not provided', async () => {
      const executor = new CurateExecutor()

      const agent = {
        cancel: stub().resolves(false),
        createTaskSession: stub().resolves('session-1'),
        deleteSandboxVariable: stub(),
        deleteSandboxVariableOnSession: stub(),
        deleteSession: stub().resolves(true),
        deleteTaskSession: stub().resolves(),
        execute: stub().resolves(''),
        executeOnSession: stub().resolves('done'),
        generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
        getSessionMetadata: stub().resolves(),
        getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
        listPersistedSessions: stub().resolves([]),
        reset: stub(),
        setSandboxVariable: stub(),
        setSandboxVariableOnSession: stub(),
        start: stub().resolves(),
        stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
      } as unknown as ICipherAgent

      // No projectRoot — should fall back to clientCwd for baseDir
      const result = await executor.executeWithAgent(agent, {
        clientCwd: '/projects/myapp',
        content: 'test',
        taskId: 'task-ws-2',
      })

      // Post-cutover: response is the formatted DAG result.
      expect(result).to.include('Curate completed via typed-slot DAG')
    })
  })

  describe('summary cascade deferral to dream (ENG-2485)', () => {
    it('enqueues stale-summary paths to the dream queue and does NOT call propagateStaleness inline', async () => {
      const agent = {
        cancel: stub().resolves(false),
        createTaskSession: stub().resolves('session-id'),
        deleteSandboxVariable: stub(),
        deleteSandboxVariableOnSession: stub(),
        deleteSession: stub().resolves(true),
        deleteTaskSession: stub().resolves(),
        execute: stub().resolves(''),
        executeOnSession: stub().resolves('curated'),
        generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
        getSessionMetadata: stub().resolves(),
        getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
        listPersistedSessions: stub().resolves([]),
        reset: stub(),
        setSandboxVariable: stub(),
        setSandboxVariableOnSession: stub(),
        start: stub().resolves(),
        stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
      } as unknown as ICipherAgent

      // pre-state empty, post-state has one new file → diffStates yields one changed path
      stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
        .onFirstCall()
        .resolves(new Map())
        .onSecondCall()
        .resolves(new Map([['auth/jwt.md', {hash: 'h', size: 1}]]))
      const propagateStalenessStub = stub(
        FileContextTreeSummaryService.prototype,
        'propagateStaleness',
      ).resolves([])
      stub(FileContextTreeManifestService.prototype, 'buildManifest').resolves()
      const enqueueStub = stub(DreamStateService.prototype, 'enqueueStaleSummaryPaths').resolves()
      // incrementCurationCount is unrelated dream-state work that runs after the post-curation
      // step; stub it so the test doesn't hit disk for the dream state file.
      stub(DreamStateService.prototype, 'incrementCurationCount').resolves()

      const taskId = 'curate-op-uuid-1'
      const projectRoot = '/projects/myapp'
      const executor = new CurateExecutor()
      await executor.executeWithAgent(agent, {
        clientCwd: projectRoot,
        content: 'capture auth knowledge',
        projectRoot,
        taskId,
      })

      // ENG-2485 invariant: the LLM-bound propagateStaleness walk MUST NOT run
      // on the curate hot path. It is deferred to the next dream cycle.
      expect(propagateStalenessStub.called).to.equal(false)

      // The deferred work is captured in the dream queue: the changed paths from
      // diffStates are enqueued for the next dream cycle to drain.
      expect(enqueueStub.calledOnce).to.equal(true)
      expect(enqueueStub.firstCall.args[0]).to.deep.equal(['auth/jwt.md'])
    })
  })

  // Note: PR #601 (ENG-2530) added a "pre-pipelined recon" describe block here
  // that asserted the executor injects `__recon_result_<taskIdSafe>` as a
  // sandbox variable and surfaces it in the agent prompt. PR #578 replaced
  // the agent loop entirely with the typed-slot DAG, so the executor no
  // longer touches sandbox variables or builds an agent prompt. Recon now
  // runs as the first node in the DAG (`recon-node.ts`); coverage for that
  // lives in `test/unit/agent/curate-flow/dag-builder.test.ts` and the
  // services-adapter integration tests.

  describe('runAgentBody / finalize split', () => {
    // runAgentBody must return the response BEFORE Phase 4 runs so the daemon
    // can fire `task:completed` early and queue finalize for background work.
    // Under cascade-defer (ENG-2485), Phase 4 is enqueueStaleSummaryPaths +
    // buildManifest — it must NEVER call propagateStaleness inline.

    it('returns the agent response without running Phase 4 first', async () => {
      const agent = buildSplitTestAgent()
      // Post-PR578: the agent body is the typed-slot DAG runner, not executeOnSession.
      // Empty content → extract emits no facts → write is a no-op → DAG completes
      // and formatResponseString returns the JSON-wrapped empty summary.
      stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
        .onFirstCall()
        .resolves(new Map())
        .onSecondCall()
        .resolves(new Map([['auth/jwt.md', {hash: 'h', size: 1}]]))
      const propagateStalenessStub = stub(
        FileContextTreeSummaryService.prototype,
        'propagateStaleness',
      ).resolves([])
      const buildManifestStub = stub(FileContextTreeManifestService.prototype, 'buildManifest').resolves()
      const enqueueStub = stub(DreamStateService.prototype, 'enqueueStaleSummaryPaths').resolves()
      stub(DreamStateService.prototype, 'incrementCurationCount').resolves()

      const executor = new CurateExecutor()
      const {finalize, response} = await executor.runAgentBody(agent, {
        clientCwd: '/p',
        content: 'capture',
        projectRoot: '/p',
        taskId: 't1',
      })

      // Phase 4 must NOT have run yet — response was returned immediately.
      // Response is the DAG runner's formatResponseString output (post-PR578).
      expect(response).to.match(/Curate completed via typed-slot DAG/)
      expect(enqueueStub.called).to.be.false
      expect(buildManifestStub.called).to.be.false
      expect(propagateStalenessStub.called).to.be.false
      expect((agent.deleteTaskSession as ReturnType<typeof stub>).called).to.be.false

      // finalize() runs Phase 4: enqueue + manifest rebuild + session cleanup.
      // ENG-2485 invariant: propagateStaleness MUST NOT run on the curate path.
      await finalize()
      expect(enqueueStub.calledOnce).to.be.true
      expect(buildManifestStub.calledOnce).to.be.true
      expect(propagateStalenessStub.called).to.be.false
      expect((agent.deleteTaskSession as ReturnType<typeof stub>).calledOnce).to.be.true
    })

    it('cleans up the task session if the agent body throws (no finalize returned)', async () => {
      const agent = buildSplitTestAgent()
      // The DAG runner is fail-soft on per-node errors (extract failures land in
      // runResult.failures rather than throwing). To exercise runAgentBody's
      // catch-and-cleanup path we stub the runner itself to reject.
      const {TopologicalCurationRunner} = await import(
        '../../../../src/agent/core/curation/flow/runner.js'
      )
      stub(TopologicalCurationRunner.prototype, 'run').rejects(new Error('agent failed'))

      const executor = new CurateExecutor()
      try {
        await executor.runAgentBody(agent, {clientCwd: '/p', content: 'x', taskId: 't2'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('agent failed')
      }

      // Even on agent body failure, the session must be cleaned up — no leak.
      expect((agent.deleteTaskSession as ReturnType<typeof stub>).calledOnceWithExactly('session-id')).to.be.true
    })

    it('executeWithAgent (backwards-compat wrapper) still runs Phase 4 inline before returning', async () => {
      const agent = buildSplitTestAgent()
      stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
        .onFirstCall()
        .resolves(new Map())
        .onSecondCall()
        .resolves(new Map([['auth/jwt.md', {hash: 'h', size: 1}]]))
      stub(FileContextTreeSummaryService.prototype, 'propagateStaleness').resolves([])
      stub(FileContextTreeManifestService.prototype, 'buildManifest').resolves()
      const enqueueStub = stub(DreamStateService.prototype, 'enqueueStaleSummaryPaths').resolves()
      stub(DreamStateService.prototype, 'incrementCurationCount').resolves()

      const executor = new CurateExecutor()
      const result = await executor.executeWithAgent(agent, {
        clientCwd: '/p',
        content: 'x',
        projectRoot: '/p',
        taskId: 't3',
      })

      // Response is the DAG runner's formatResponseString output (post-PR578).
      expect(result).to.match(/Curate completed via typed-slot DAG/)
      // Wrapper awaits finalize internally — cascade-defer enqueue ran by the
      // time we get here. Per ENG-2485, propagateStaleness no longer runs on
      // the curate path — it's deferred to dream via enqueueStaleSummaryPaths.
      expect(enqueueStub.calledOnce).to.be.true
    })
  })

  // Note: the previous "dream-lock coordination in Phase 4" describe block
  // tested propagateSummariesUnderLock holding the dream lock around inline
  // propagateStaleness + buildManifest. PR #601 (ENG-2485) replaced that with
  // propagateAndRebuild — propagation is now deferred to dream itself, so the
  // lock dance moved to dream's own write path. The corresponding tests live
  // in dream's test suite now.
})
