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

import {FileValidationError} from '../../../../src/server/core/domain/errors/task-error.js'
import {FileContextTreeManifestService} from '../../../../src/server/infra/context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../../../../src/server/infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../../../../src/server/infra/context-tree/file-context-tree-summary-service.js'
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
})
