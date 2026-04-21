/**
 * Integration test — outcome collection pipeline.
 *
 * Exercises the Phase 1 + Phase 2 stack end-to-end: real HarnessStore
 * (FileKeyStorage on tmpdir), real HarnessOutcomeRecorder, real
 * SandboxService. Confirms the seams line up, backpressure holds,
 * and the feedback round-trip works against real storage.
 */

import {expect} from 'chai'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {EnvironmentContext} from '../../../../src/agent/core/domain/environment/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessOutcomeRecorder} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// FileKeyStorage rejects path separators in key segments, so projectId
// must be a simple slug — not a filesystem path. In production the
// recorder receives `environmentContext.workingDirectory` (a full path);
// that path-to-key incompatibility is a known gap tracked outside this test.
// TODO: remove slug workaround once projectId is encoded before key insertion
const PROJECT_ID = 'test-project'
const SESSION_ID = 'integ-session-1'
const OUTCOME_COUNT = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger: ILogger = new NoOpLogger()

function makeEnvironmentContext(workingDirectory: string): EnvironmentContext {
  return {
    brvStructure: '',
    fileTree: '',
    isGitRepository: false,
    nodeVersion: process.version,
    osVersion: 'test',
    platform: process.platform,
    workingDirectory,
  }
}

function makeHarnessConfig(overrides?: Partial<ValidatedHarnessConfig>): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

/**
 * Wire the harness stack the same way service-initializer.ts does:
 * FileKeyStorage → HarnessStore → HarnessOutcomeRecorder → SandboxService
 */
async function createHarnessStack(storageDir: string, config?: Partial<ValidatedHarnessConfig>) {
  const harnessConfig = makeHarnessConfig(config)

  const keyStorage = new FileKeyStorage({storageDir})
  await keyStorage.initialize()

  const harnessStore = new HarnessStore(keyStorage, logger)
  const sessionEventBus = new SessionEventBus()
  const recorder = new HarnessOutcomeRecorder(
    harnessStore,
    sessionEventBus,
    logger,
    harnessConfig,
  )

  const sandboxService = new SandboxService()
  sandboxService.setHarnessConfig(harnessConfig)
  sandboxService.setEnvironmentContext(makeEnvironmentContext(PROJECT_ID))
  sandboxService.setHarnessOutcomeRecorder(recorder, logger)

  return {harnessStore, keyStorage, recorder, sandboxService, sessionEventBus}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('outcome collection — integration', function () {
  // Integration tests can be slower than unit tests
  this.timeout(15_000)

  let tempDir: string

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-harness-integ-')))
  })

  afterEach(() => {
    rmSync(tempDir, {force: true, recursive: true})
  })

  // ── Scenario 1: 20 code_exec calls → 20 outcomes persisted ──────────

  it('records 20 outcomes with all fields populated', async () => {
    const {harnessStore, sandboxService} = await createHarnessStack(tempDir)

    // Fire 20 sequential executeCode calls with varied inputs
    for (let i = 0; i < OUTCOME_COUNT; i++) {
      // eslint-disable-next-line no-await-in-loop
      await sandboxService.executeCode(
        `const x = ${i}; x`,
        SESSION_ID,
        {
          commandType: i % 3 === 0 ? 'curate' : i % 3 === 1 ? 'query' : 'chat',
          conversationTurn: i,
          taskDescription: `task-${i}`,
          timeout: 5000,
        },
      )
    }

    // The recorder is fire-and-forget — wait for background writes to land.
    // No drain() API yet; 1000ms is generous for 20 file writes through a
    // 5-permit semaphore on tmpdir.
    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })

    // Collect outcomes across all three command types
    const curateOutcomes = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 100)
    const queryOutcomes = await harnessStore.listOutcomes(PROJECT_ID, 'query', 100)
    const chatOutcomes = await harnessStore.listOutcomes(PROJECT_ID, 'chat', 100)
    const allOutcomes = [...curateOutcomes, ...queryOutcomes, ...chatOutcomes]

    // Per-bucket distribution: i%3 fan-out → curate=7, query=7, chat=6
    expect(curateOutcomes).to.have.length(7)
    expect(queryOutcomes).to.have.length(7)
    expect(chatOutcomes).to.have.length(6)
    expect(allOutcomes).to.have.length(OUTCOME_COUNT)

    // All 20 IDs must be distinct
    const ids = new Set(allOutcomes.map((o) => o.id))
    expect(ids.size).to.equal(OUTCOME_COUNT)

    // Verify every outcome has required fields populated
    for (const outcome of allOutcomes) {
      expect(outcome.code).to.be.a('string').and.not.be.empty
      expect(outcome.commandType).to.be.oneOf(['chat', 'curate', 'query'])
      expect(outcome.projectId).to.equal(PROJECT_ID)
      expect(outcome.success).to.be.a('boolean')
      expect(outcome.timestamp).to.be.a('number').and.be.greaterThan(0)
      expect(outcome.executionTimeMs).to.be.a('number').and.be.at.least(0)
      expect(outcome.id).to.be.a('string').and.not.be.empty
      expect(outcome.sessionId).to.equal(SESSION_ID)
    }

    // taskDescription and conversationTurn flow through SandboxConfig →
    // RecordParams but are not persisted on CodeExecOutcome. Forwarding is
    // validated by the code-exec-tool-harness-fields unit tests; this test
    // confirms the full pipeline works without errors when the fields are set.
  })

  // ── Scenario 2: Latency bound ──────────────────────────────────────

  it('recorder overhead stays within 2x baseline + 100ms tolerance', async function () {
    // CI environments have unpredictable timing — skip there
    if (process.env.CI === 'true') {
      this.skip()
    }

    const callCount = OUTCOME_COUNT

    // Baseline: sandbox without recorder
    const baselineService = new SandboxService()
    baselineService.setEnvironmentContext(makeEnvironmentContext(PROJECT_ID))
    // No recorder wired — pure sandbox overhead

    const t0Start = performance.now()
    for (let i = 0; i < callCount; i++) {
      // eslint-disable-next-line no-await-in-loop
      await baselineService.executeCode(`${i}`, 'baseline-sess', {timeout: 5000})
    }

    const t0 = performance.now() - t0Start

    // With recorder: real stack
    const {sandboxService} = await createHarnessStack(tempDir)

    const t1Start = performance.now()
    for (let i = 0; i < callCount; i++) {
      // eslint-disable-next-line no-await-in-loop
      await sandboxService.executeCode(`${i}`, SESSION_ID, {
        commandType: 'chat',
        conversationTurn: i,
        taskDescription: `latency-test-${i}`,
        timeout: 5000,
      })
    }

    const t1 = performance.now() - t1Start

    // Allow fire-and-forget writes to complete before teardown
    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })

    // The recorder is fire-and-forget, so T₁ should be close to T₀.
    // Spec: T₁ ≤ 2 × T₀ + 100ms tolerance
    expect(t1).to.be.at.most(2 * t0 + 100, `Recorder overhead too high: T₁=${t1.toFixed(1)}ms, T₀=${t0.toFixed(1)}ms`)
  })

  // ── Scenario 3: Feedback round-trip ────────────────────────────────

  it('attachFeedback(bad) creates 3 synthetic rows then null clears the flag', async () => {
    const {harnessStore, recorder, sandboxService} = await createHarnessStack(tempDir)

    // Record one outcome
    await sandboxService.executeCode('1 + 1', SESSION_ID, {
      commandType: 'curate',
      conversationTurn: 0,
      taskDescription: 'feedback-test',
    })

    // Wait for fire-and-forget write
    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })

    const initialOutcomes = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 100)
    expect(initialOutcomes).to.have.length(1)

    const originalId = initialOutcomes[0]?.id
    expect(originalId).to.be.a('string')

    if (!originalId) throw new Error('Expected outcome id')
    const originalTimestamp = initialOutcomes[0]?.timestamp
    expect(originalTimestamp).to.be.a('number').and.be.greaterThan(0)

    // Attach 'bad' feedback → 3 synthetic clones
    await recorder.attachFeedback(PROJECT_ID, 'curate', originalId, 'bad')

    const afterBad = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 100)
    // 1 original + 3 synthetics = 4
    expect(afterBad).to.have.length(4)

    // Original should have userFeedback: 'bad'
    const original = afterBad.find((o) => o.id === originalId)
    expect(original?.userFeedback).to.equal('bad')

    // Synthetics should have userFeedback: 'bad' and same timestamp
    const synthetics = afterBad.filter((o) => o.id !== originalId)
    expect(synthetics).to.have.length(3)

    for (const s of synthetics) {
      expect(s.userFeedback).to.equal('bad')
      expect(s.timestamp).to.equal(originalTimestamp)
      expect(s.id).to.not.equal(originalId)
      expect(s.projectId).to.equal(PROJECT_ID)
      expect(s.commandType).to.equal('curate')
    }

    // All synthetic IDs must be distinct
    const syntheticIds = new Set(synthetics.map((s) => s.id))
    expect(syntheticIds.size).to.equal(3)

    // Clear feedback with null → flag cleared, synthetics remain
    await recorder.attachFeedback(PROJECT_ID, 'curate', originalId, null)

    const afterClear = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 100)
    // Synthetics are separate records — they remain (4 total)
    expect(afterClear).to.have.length(4)

    const cleared = afterClear.find((o) => o.id === originalId)
    expect(cleared?.userFeedback).to.equal(null)

    // Synthetics still have 'bad' — they are independent records
    const remainingSynthetics = afterClear.filter((o) => o.id !== originalId)
    for (const s of remainingSynthetics) {
      expect(s.userFeedback).to.equal('bad')
    }
  })
})
