/**
 * AutoHarness V2 — HarnessScenarioCapture tests.
 *
 * Validates the scenario capture policy: positive/negative selection
 * rules, deduplication, per-pair LRU eviction (20-scenario cap),
 * and concurrent-capture safety. Uses a real `InMemoryHarnessStore`
 * for speed — the real `HarnessStore` is tested via Task 6.6.
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'

import type {CodeExecOutcome} from '../../../../src/agent/core/domain/harness/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {CaptureContext} from '../../../../src/agent/infra/harness/harness-scenario-capture.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessScenarioCapture} from '../../../../src/agent/infra/harness/harness-scenario-capture.js'
import {InMemoryHarnessStore} from '../../../helpers/in-memory-harness-store.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOutcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'exports.curate = async function(ctx) {}',
    commandType: 'curate',
    executionTimeMs: 100,
    id: `outcome-${randomUUID().slice(0, 8)}`,
    projectId: 'proj-1',
    projectType: 'typescript',
    sessionId: 'session-1',
    success: true,
    timestamp: Date.now(),
    usedHarness: true,
    ...overrides,
  }
}

function makeCaptureContext(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    code: 'const result = await tools.curate(ops)',
    commandType: 'curate',
    outcome: makeOutcome({
      curateResult: [{applied: [{path: 'project/overview', status: 'success', type: 'UPSERT'}], summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0}}],
    }),
    projectId: 'proj-1',
    projectType: 'typescript',
    taskDescription: 'Curate the project overview',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessScenarioCapture', () => {
  let store: InMemoryHarnessStore
  let logger: ILogger
  let capture: HarnessScenarioCapture

  beforeEach(() => {
    store = new InMemoryHarnessStore()
    logger = new NoOpLogger()
    capture = new HarnessScenarioCapture(store, logger)
  })

  // Test 1: Positive curate outcome → scenario saved
  it('captures positive curate outcome with non-empty curateResult', async () => {
    const ctx = makeCaptureContext()

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
    expect(scenarios[0].expectedBehavior).to.equal('Succeeds without errors')
    expect(scenarios[0].commandType).to.equal('curate')
    expect(scenarios[0].code).to.equal(ctx.code)
    expect(scenarios[0].taskDescription).to.equal(ctx.taskDescription)
    expect(scenarios[0].projectId).to.equal('proj-1')
    expect(scenarios[0].projectType).to.equal('typescript')
  })

  // Test 2: Positive query outcome with topScore 0.9 → scenario saved
  it('captures positive query outcome with topScore >= 0.7', async () => {
    const ctx = makeCaptureContext({
      commandType: 'query',
      outcome: makeOutcome({
        commandType: 'query',
        queryResult: {topScore: 0.9},
        success: true,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'query')
    expect(scenarios).to.have.lengthOf(1)
    expect(scenarios[0].expectedBehavior).to.equal('Succeeds without errors')
  })

  // Test 3: Positive query outcome with topScore 0.3 → NOT captured
  it('skips positive query outcome with topScore below 0.7', async () => {
    const ctx = makeCaptureContext({
      commandType: 'query',
      outcome: makeOutcome({
        commandType: 'query',
        queryResult: {topScore: 0.3},
        success: true,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'query')
    expect(scenarios).to.have.lengthOf(0)
  })

  // Test 4: Negative outcome with structural stderr → scenario saved
  it('captures negative outcome with structural failure stderr', async () => {
    const ctx = makeCaptureContext({
      outcome: makeOutcome({
        stderr: 'TypeError: Cannot read property of undefined',
        success: false,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
    expect(scenarios[0].expectedBehavior).to.satisfy(
      (s: string) => s === 'Rejects malformed input' || s === 'Returns error without corrupting state',
    )
  })

  // Test 5: Chat outcome (success or fail) → NOT captured
  it('does not capture chat outcomes regardless of success', async () => {
    const successCtx = makeCaptureContext({
      commandType: 'chat',
      outcome: makeOutcome({commandType: 'chat', success: true}),
    })
    const failCtx = makeCaptureContext({
      commandType: 'chat',
      outcome: makeOutcome({commandType: 'chat', stderr: 'Error: something', success: false}),
      taskDescription: 'Chat about code',
    })

    await capture.captureIfInteresting(successCtx)
    await capture.captureIfInteresting(failCtx)

    const scenarios = await store.listScenarios('proj-1', 'chat')
    expect(scenarios).to.have.lengthOf(0)
  })

  // Test 6: Identical (taskDescription, code) → deduplicated
  it('deduplicates identical (taskDescription, code) pairs', async () => {
    const ctx = makeCaptureContext()

    await capture.captureIfInteresting(ctx)
    await capture.captureIfInteresting(ctx)
    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
  })

  // Test 7: 21st scenario for a pair → oldest deleted, total stays at 20
  it('evicts oldest scenario when per-pair cap of 20 is exceeded', async () => {
    // Seed 20 distinct scenarios
    for (let i = 0; i < 20; i++) {
      const ctx = makeCaptureContext({
        outcome: makeOutcome({
          curateResult: [{applied: [{path: `p/${i}`, status: 'success', type: 'UPSERT'}], summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0}}],
        }),
        taskDescription: `Task ${i}`,
      })
      // eslint-disable-next-line no-await-in-loop
      await capture.captureIfInteresting(ctx)
    }

    let scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(20)

    // The first scenario's taskDescription
    const oldestDescription = scenarios[0].taskDescription

    // 21st scenario triggers eviction
    const ctx21 = makeCaptureContext({
      outcome: makeOutcome({
        curateResult: [{applied: [{path: 'p/new', status: 'success', type: 'UPSERT'}], summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0}}],
      }),
      taskDescription: 'Task NEW',
    })
    await capture.captureIfInteresting(ctx21)

    scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(20)

    // Oldest should be gone
    const descriptions = scenarios.map((s) => s.taskDescription)
    expect(descriptions).to.not.include(oldestDescription)
    expect(descriptions).to.include('Task NEW')
  })

  // Test 8: Concurrent captures → no more than 20 end up in store
  it('maintains per-pair cap under concurrent captures', async () => {
    const promises: Array<Promise<void>> = []

    for (let i = 0; i < 25; i++) {
      const ctx = makeCaptureContext({
        outcome: makeOutcome({
          curateResult: [{applied: [{path: `p/${i}`, status: 'success', type: 'UPSERT'}], summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0}}],
        }),
        taskDescription: `Concurrent task ${i}`,
      })
      promises.push(capture.captureIfInteresting(ctx))
    }

    await Promise.all(promises)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(20)
  })

  // Additional: Negative captures rate-limited to one per session per commandType
  it('rate-limits negative captures to one per session per commandType', async () => {
    const ctx1 = makeCaptureContext({
      outcome: makeOutcome({
        sessionId: 'session-A',
        stderr: 'TypeError: first error',
        success: false,
      }),
      taskDescription: 'Task A',
    })
    const ctx2 = makeCaptureContext({
      code: 'different code',
      outcome: makeOutcome({
        sessionId: 'session-A',
        stderr: 'RangeError: second error',
        success: false,
      }),
      taskDescription: 'Task B',
    })

    await capture.captureIfInteresting(ctx1)
    await capture.captureIfInteresting(ctx2)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
  })

  // Concurrent negative captures for same session → only one saved
  it('rate-limits concurrent negative captures for the same session', async () => {
    const promises: Array<Promise<void>> = []
    for (let i = 0; i < 5; i++) {
      const ctx = makeCaptureContext({
        code: `code-${i}`,
        outcome: makeOutcome({
          sessionId: 'session-concurrent',
          stderr: `TypeError: error ${i}`,
          success: false,
        }),
        taskDescription: `Negative task ${i}`,
      })
      promises.push(capture.captureIfInteresting(ctx))
    }

    await Promise.all(promises)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
  })

  // Additional: Positive curate with empty curateResult → NOT captured
  it('skips positive curate outcome with empty curateResult', async () => {
    const ctx = makeCaptureContext({
      outcome: makeOutcome({
        curateResult: [],
        success: true,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(0)
  })

  // Additional: Negative outcome with soft failure (no structural pattern) → NOT captured
  it('skips negative outcome without structural failure pattern in stderr', async () => {
    const ctx = makeCaptureContext({
      outcome: makeOutcome({
        stderr: 'no results found',
        success: false,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(0)
  })

  // expectedBehavior derivation: 'Rejects malformed input' when stderr contains Rejected
  it('derives "Rejects malformed input" for negative outcomes with Rejected in stderr', async () => {
    const ctx = makeCaptureContext({
      outcome: makeOutcome({
        stderr: 'Rejected: input validation failed',
        success: false,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
    expect(scenarios[0].expectedBehavior).to.equal('Rejects malformed input')
  })

  // expectedBehavior derivation: generic error gets 'Returns error without corrupting state'
  it('derives "Returns error without corrupting state" for non-rejection negative outcomes', async () => {
    const ctx = makeCaptureContext({
      outcome: makeOutcome({
        stderr: 'TypeError: Cannot read property of undefined',
        success: false,
      }),
    })

    await capture.captureIfInteresting(ctx)

    const scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)
    expect(scenarios[0].expectedBehavior).to.equal('Returns error without corrupting state')
  })

  // Lifecycle: clearSession removes negative-capture tracking for that session
  it('clearSession allows new negative captures for the same session', async () => {
    const ctx1 = makeCaptureContext({
      outcome: makeOutcome({
        sessionId: 'session-X',
        stderr: 'Error: first',
        success: false,
      }),
      taskDescription: 'Task 1',
    })

    await capture.captureIfInteresting(ctx1)

    let scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)

    // Clear session tracking
    capture.clearSession('session-X')

    const ctx2 = makeCaptureContext({
      code: 'different code',
      outcome: makeOutcome({
        sessionId: 'session-X',
        stderr: 'Exception: second',
        success: false,
      }),
      taskDescription: 'Task 2',
    })

    await capture.captureIfInteresting(ctx2)

    scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(2)
  })

  // cleanup() clears all session state (negative rate-limits + pair locks)
  it('cleanup clears all session state so captures resume normally', async () => {
    const ctx1 = makeCaptureContext({
      outcome: makeOutcome({
        sessionId: 'session-Z',
        stderr: 'Error: first',
        success: false,
      }),
      taskDescription: 'Task 1',
    })

    await capture.captureIfInteresting(ctx1)

    let scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(1)

    capture.cleanup()

    // Same session should now be capturable again (rate-limit reset)
    const ctx2 = makeCaptureContext({
      code: 'different code',
      outcome: makeOutcome({
        sessionId: 'session-Z',
        stderr: 'Exception: second',
        success: false,
      }),
      taskDescription: 'Task 2',
    })

    await capture.captureIfInteresting(ctx2)

    scenarios = await store.listScenarios('proj-1', 'curate')
    expect(scenarios).to.have.lengthOf(2)
  })
})
