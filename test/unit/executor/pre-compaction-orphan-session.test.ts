/**
 * Phase 1 Task 1.3 — orphan-session guard.
 *
 * The async pre-compaction hoist runs `compact()` and `createTaskSession()`
 * in parallel. If `compact()` rejects after `createTaskSession()` has already
 * resolved, we must delete the orphan session before propagating the error.
 */

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../src/agent/core/interfaces/i-cipher-agent.js'

import {CurateExecutor} from '../../../src/server/infra/executor/curate-executor.js'
import {PreCompactionService} from '../../../src/server/infra/executor/pre-compaction/pre-compaction-service.js'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function buildAgent(): {
  agent: ICipherAgent
  createTaskSessionStub: ReturnType<typeof stub>
  deleteTaskSessionStub: ReturnType<typeof stub>
} {
  const createTaskSession = stub().resolves('orphaned-session-id')
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
    getState: stub().returns({
      currentIteration: 0,
      executionHistory: [],
      executionState: 'idle',
      toolCallsExecuted: 0,
    }),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    start: stub().resolves(),
    stream: stub().resolves({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({done: true, value: undefined}),
      }),
    }),
  } as unknown as ICipherAgent

  return {agent, createTaskSessionStub: createTaskSession, deleteTaskSessionStub: deleteTaskSession}
}

describe('CurateExecutor — orphan-session guard during hoisted pre-compaction', () => {
  afterEach(() => {
    restore()
  })

  it('deletes the orphan session when compact rejects after session creation succeeds', async () => {
    // compact rejects after a delay so session has time to resolve first
    stub(PreCompactionService.prototype, 'compact').callsFake(async () => {
      await delay(20)
      throw new Error('boom: compaction failed')
    })

    const {agent, createTaskSessionStub, deleteTaskSessionStub} = buildAgent()
    const executor = new CurateExecutor()

    let thrown: Error | undefined
    try {
      await executor.executeWithAgent(agent, {
        content: 'test',
        taskId: 'task-orphan-1',
      })
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown, 'compaction error propagates').to.exist
    expect(thrown?.message).to.include('boom')

    expect(createTaskSessionStub.called, 'createTaskSession was called').to.be.true
    expect(deleteTaskSessionStub.called, 'orphan session was deleted').to.be.true
    expect(deleteTaskSessionStub.firstCall.args[0]).to.equal('orphaned-session-id')
  })

  it('does not double-delete when both compact and createTaskSession succeed', async () => {
    stub(PreCompactionService.prototype, 'compact').callsFake(async (_agent, context) => ({
      context,
      originalCharCount: context.length,
      preCompacted: false,
    }))

    const {agent, deleteTaskSessionStub} = buildAgent()
    const executor = new CurateExecutor()

    await executor.executeWithAgent(agent, {
      content: 'test',
      taskId: 'task-orphan-2',
    })

    // Normal happy-path: deleteTaskSession is called exactly once in the `finally` block
    expect(deleteTaskSessionStub.callCount).to.equal(1)
  })

  it('propagates session-creation errors when both arms fail', async () => {
    stub(PreCompactionService.prototype, 'compact').callsFake(async () => {
      throw new Error('compact-error')
    })

    const createTaskSession = stub().rejects(new Error('session-error'))
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
      getState: stub().returns({
        currentIteration: 0,
        executionHistory: [],
        executionState: 'idle',
        toolCallsExecuted: 0,
      }),
      listPersistedSessions: stub().resolves([]),
      reset: stub(),
      setSandboxVariable: stub(),
      setSandboxVariableOnSession: stub(),
      start: stub().resolves(),
      stream: stub().resolves({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({done: true, value: undefined}),
        }),
      }),
    } as unknown as ICipherAgent

    const executor = new CurateExecutor()

    let thrown: Error | undefined
    try {
      await executor.executeWithAgent(agent, {
        content: 'test',
        taskId: 'task-orphan-3',
      })
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown, 'an error propagates').to.exist
    // No session was successfully created, so deleteTaskSession should NOT be called
    expect(deleteTaskSession.called, 'no orphan to delete').to.be.false
  })
})
