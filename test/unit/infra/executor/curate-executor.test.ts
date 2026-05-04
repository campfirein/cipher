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
import {DreamLockService} from '../../../../src/server/infra/dream/dream-lock-service.js'
import {CurateExecutor} from '../../../../src/server/infra/executor/curate-executor.js'

/**
 * Default DreamLockService stubs so Phase 4 tests don't write real
 * `dream.lock` files. Tests exercising the lock directly re-stub via restore.
 */
function stubDreamLockServiceDefaults(): void {
  stub(DreamLockService.prototype, 'tryAcquire').resolves({acquired: true, priorMtime: 0})
  stub(DreamLockService.prototype, 'release').resolves()
  stub(DreamLockService.prototype, 'rollback').resolves()
}

describe('CurateExecutor (regression)', () => {
  beforeEach(() => {
    stubDreamLockServiceDefaults()
  })

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

  describe('summary propagation taskId threading (ENG-2100)', () => {
    it('passes the curate operation taskId to propagateStaleness so summary LLM calls share one billing session', async () => {
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

      const taskId = 'curate-op-uuid-1'
      const projectRoot = '/projects/myapp'
      const executor = new CurateExecutor()
      await executor.executeWithAgent(agent, {
        clientCwd: projectRoot,
        content: 'capture auth knowledge',
        projectRoot,
        taskId,
      })

      expect(propagateStalenessStub.calledOnce).to.be.true
      // 4th arg must be the curate's taskId so the billing service groups
      // summary regenerations into the same session as the parent operation.
      expect(propagateStalenessStub.firstCall.args[3]).to.equal(taskId)
    })
  })

  describe('runAgentBody / finalize split', () => {
    // runAgentBody must return the response BEFORE Phase 4 runs so the daemon
    // can fire `task:completed` early and queue finalize for background work.

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
      stub(FileContextTreeManifestService.prototype, 'buildManifest').resolves()

      const executor = new CurateExecutor()
      const {finalize, response} = await executor.runAgentBody(agent, {
        clientCwd: '/p',
        content: 'capture',
        projectRoot: '/p',
        taskId: 't1',
      })

      // Phase 4 must NOT have run yet — response was returned immediately.
      expect(response).to.match(/Curate completed via typed-slot DAG/)
      expect(propagateStalenessStub.called).to.be.false
      expect((agent.deleteTaskSession as ReturnType<typeof stub>).called).to.be.false

      // finalize() actually runs Phase 4
      await finalize()
      expect(propagateStalenessStub.calledOnce).to.be.true
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
      const propagateStalenessStub = stub(
        FileContextTreeSummaryService.prototype,
        'propagateStaleness',
      ).resolves([])

      const executor = new CurateExecutor()
      const result = await executor.executeWithAgent(agent, {
        clientCwd: '/p',
        content: 'x',
        projectRoot: '/p',
        taskId: 't3',
      })

      expect(result).to.match(/Curate completed via typed-slot DAG/)
      // Wrapper awaits finalize internally — Phase 4 ran by the time we get here.
      expect(propagateStalenessStub.calledOnce).to.be.true
    })
  })

  describe('dream-lock coordination in Phase 4', () => {
    // Detached Phase 4 races with idle-triggered dream on `_index.md` /
    // `_manifest.json`. Curate's finalize must hold the dream lock around
    // propagateStaleness + buildManifest to prevent interleaving.

    it('acquires the dream lock before propagation and releases on success', async () => {
      // Restore default stubs so we can observe the real call sequence.
      restore()
      const tryAcquire = stub(DreamLockService.prototype, 'tryAcquire').resolves({acquired: true, priorMtime: 1234})
      const release = stub(DreamLockService.prototype, 'release').resolves()
      const rollback = stub(DreamLockService.prototype, 'rollback').resolves()

      const agent = buildSplitTestAgent()
      stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
        .onFirstCall()
        .resolves(new Map())
        .onSecondCall()
        .resolves(new Map([['auth/jwt.md', {hash: 'h', size: 1}]]))
      const propagateStaleness = stub(FileContextTreeSummaryService.prototype, 'propagateStaleness').resolves([])

      const executor = new CurateExecutor()
      const {finalize} = await executor.runAgentBody(agent, {
        clientCwd: '/p',
        content: 'x',
        projectRoot: '/p',
        taskId: 't-lock-success',
      })
      await finalize()

      expect(tryAcquire.calledOnce).to.be.true
      expect(propagateStaleness.calledOnce).to.be.true
      // Lock-then-propagate, then release on success (no rollback).
      expect(tryAcquire.calledBefore(propagateStaleness)).to.be.true
      expect(release.calledOnce).to.be.true
      expect(rollback.called).to.be.false
    })

    it('skips propagation when the lock is held (dream is running)', async () => {
      restore()
      const tryAcquire = stub(DreamLockService.prototype, 'tryAcquire').resolves({acquired: false})
      const release = stub(DreamLockService.prototype, 'release').resolves()
      const rollback = stub(DreamLockService.prototype, 'rollback').resolves()

      const agent = buildSplitTestAgent()
      // Snapshot is reachable so without the lock check, propagation would run.
      stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
        .onFirstCall()
        .resolves(new Map())
        .onSecondCall()
        .resolves(new Map([['auth/jwt.md', {hash: 'h', size: 1}]]))
      const propagateStaleness = stub(FileContextTreeSummaryService.prototype, 'propagateStaleness').resolves([])

      const executor = new CurateExecutor()
      const {finalize} = await executor.runAgentBody(agent, {
        clientCwd: '/p',
        content: 'x',
        projectRoot: '/p',
        taskId: 't-lock-held',
      })
      await finalize()

      // Lock was checked; propagation skipped; nothing to release/rollback.
      expect(tryAcquire.calledOnce).to.be.true
      expect(propagateStaleness.called).to.be.false
      expect(release.called).to.be.false
      expect(rollback.called).to.be.false
    })

    it('rolls back the lock (preserves prior mtime) when propagation throws', async () => {
      restore()
      const priorMtime = 9999
      stub(DreamLockService.prototype, 'tryAcquire').resolves({acquired: true, priorMtime})
      const release = stub(DreamLockService.prototype, 'release').resolves()
      const rollback = stub(DreamLockService.prototype, 'rollback').resolves()

      const agent = buildSplitTestAgent()
      stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
        .onFirstCall()
        .resolves(new Map())
        .onSecondCall()
        .resolves(new Map([['auth/jwt.md', {hash: 'h', size: 1}]]))
      stub(FileContextTreeSummaryService.prototype, 'propagateStaleness').rejects(new Error('boom'))

      const executor = new CurateExecutor()
      const {finalize} = await executor.runAgentBody(agent, {
        clientCwd: '/p',
        content: 'x',
        projectRoot: '/p',
        taskId: 't-lock-fail',
      })

      // Phase 4 is fail-open: finalize must not throw even though propagation did.
      await finalize()

      expect(release.called).to.be.false
      expect(rollback.calledOnceWithExactly(priorMtime)).to.be.true
    })
  })
})
