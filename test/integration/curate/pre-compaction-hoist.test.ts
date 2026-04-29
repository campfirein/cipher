/**
 * Phase 1 Task 1.3 — async pre-compaction hoist.
 *
 * Asserts that pre-compaction and task-session creation now run concurrently
 * via Promise.all, instead of the previous serial sequence (compact → then
 * createTaskSession).
 */

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../src/agent/core/interfaces/i-cipher-agent.js'

import {CurateExecutor} from '../../../src/server/infra/executor/curate-executor.js'
import {PreCompactionService} from '../../../src/server/infra/executor/pre-compaction/pre-compaction-service.js'

const STUB_LATENCY_MS = 200
const HOIST_BUDGET_MS = 350
const SERIAL_FLOOR_MS = 400

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Build a stub ICipherAgent that immediately fulfills the calls
 * the executor makes after the hoist (variable injection, executeOnSession).
 * createTaskSession is intentionally slow so we can measure parallelism.
 */
function buildStubAgent(taskSessionLatencyMs: number): {agent: ICipherAgent; createSessionResolvedAt: () => number; createSessionStartedAt: () => number} {
  let createSessionStartedAt = -1
  let createSessionResolvedAt = -1

  const agent = {
    cancel: stub().resolves(false),
    createTaskSession: stub().callsFake(async () => {
      createSessionStartedAt = Date.now()
      await delay(taskSessionLatencyMs)
      createSessionResolvedAt = Date.now()
      return 'task-session-id'
    }),
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession: stub().resolves(),
    execute: stub().resolves(''),
    executeOnSession: stub().resolves(
      '```json\n{"summary":{"added":0,"updated":0,"merged":0,"deleted":0,"failed":0}}\n```',
    ),
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

  return {
    agent,
    createSessionResolvedAt: () => createSessionResolvedAt,
    createSessionStartedAt: () => createSessionStartedAt,
  }
}

describe('CurateExecutor — async pre-compaction hoist', () => {
  let compactStartedAt = -1
  let compactResolvedAt = -1

  beforeEach(() => {
    compactStartedAt = -1
    compactResolvedAt = -1

    // Force compaction path to run by returning a "not compacted" PreCompactionResult
    // after a deliberate latency (so we can observe the hoist overlap).
    stub(PreCompactionService.prototype, 'compact').callsFake(async (_agent, context) => {
      compactStartedAt = Date.now()
      await delay(STUB_LATENCY_MS)
      compactResolvedAt = Date.now()
      return {
        context,
        originalCharCount: context.length,
        preCompacted: false,
      }
    })
  })

  afterEach(() => {
    restore()
  })

  it('runs preCompactionService.compact and agent.createTaskSession concurrently', async () => {
    const {agent, createSessionResolvedAt, createSessionStartedAt} = buildStubAgent(STUB_LATENCY_MS)
    const executor = new CurateExecutor()

    const start = Date.now()
    await executor.executeWithAgent(agent, {
      content: 'small content',
      taskId: 'test-task-hoist-1',
    })
    const elapsed = Date.now() - start

    // Both operations should have started before either finished — proves overlap.
    expect(createSessionStartedAt(), 'createTaskSession started').to.be.greaterThan(0)
    expect(compactStartedAt, 'compact started').to.be.greaterThan(0)

    const earlierStart = Math.min(compactStartedAt, createSessionStartedAt())
    const laterStart = Math.max(compactStartedAt, createSessionStartedAt())
    const earlierEnd = Math.min(compactResolvedAt, createSessionResolvedAt())

    // The later-starting one started BEFORE the earlier-starting one resolved → overlap.
    expect(laterStart, 'second op starts before first resolves (overlap)').to.be.lessThan(earlierEnd)

    // Total wall-clock proves it's not the old serial path.
    // Allow generous headroom for CI timing variance.
    expect(elapsed, `total wall-clock under hoist budget (${HOIST_BUDGET_MS}ms)`).to.be.lessThan(HOIST_BUDGET_MS)
    expect(elapsed, `total wall-clock under serial floor (${SERIAL_FLOOR_MS}ms)`).to.be.lessThan(SERIAL_FLOOR_MS)

    // Sanity: ensure earlierStart was used (TS would otherwise mark unused).
    expect(earlierStart).to.be.greaterThan(0)
  })

  it('preserves task-session lifecycle (created, used, cleaned up)', async () => {
    const {agent} = buildStubAgent(STUB_LATENCY_MS)
    const executor = new CurateExecutor()

    await executor.executeWithAgent(agent, {
      content: 'test content for downstream',
      taskId: 'test-task-hoist-2',
    })

    // Post-cutover: the DAG runner doesn't inject sandbox variables (those
    // were for the old agent loop's code_exec). Instead we assert the
    // session lifecycle: createTaskSession resolved a session ID, and
    // deleteTaskSession was called with that same ID at the end.
    const createStub = agent.createTaskSession as ReturnType<typeof stub>
    const deleteStub = agent.deleteTaskSession as ReturnType<typeof stub>
    expect(createStub.calledOnce, 'task session created exactly once').to.be.true
    expect(deleteStub.calledOnceWithExactly('task-session-id'), 'task session deleted with the same id').to.be.true
  })
})
