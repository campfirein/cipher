/**
 * SandboxService — harness outcome recording wiring tests.
 *
 * Validates that `SandboxService.executeCode` calls
 * `HarnessOutcomeRecorder.record()` in a fire-and-forget fashion:
 * the sandbox result is returned immediately, the recorder runs in
 * the background, and errors from the recorder never propagate to
 * the caller.
 *
 * ENG-2232 (Phase 2 Task 2.3)
 */

import {expect} from 'chai'
import sinon from 'sinon'

import type {EnvironmentContext} from '../../../../src/agent/core/domain/environment/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {RecordParams} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'

import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessOutcomeRecorder} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {InMemoryHarnessStore} from '../../../helpers/in-memory-harness-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHarnessConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'typescript',
    maxVersions: 20,
    ...overrides,
  }
}

function makeLogger(): ILogger & {calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>>} {
  const calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>> = {
    debug: [],
    error: [],
    info: [],
    warn: [],
  }
  return {
    calls,
    debug(message: string, context?: Record<string, unknown>) {
      calls.debug.push({context, message})
    },
    error(message: string, context?: Record<string, unknown>) {
      calls.error.push({context, message})
    },
    info(message: string, context?: Record<string, unknown>) {
      calls.info.push({context, message})
    },
    warn(message: string, context?: Record<string, unknown>) {
      calls.warn.push({context, message})
    },
  }
}

function makeEnvironmentContext(workingDirectory = '/test/project'): EnvironmentContext {
  return {
    brvStructure: '',
    fileTree: '',
    isGitRepository: false,
    nodeVersion: '22.0.0',
    osVersion: 'test',
    platform: 'darwin',
    workingDirectory,
  }
}

function createRecorder(
  config?: Partial<ValidatedHarnessConfig>,
): {logger: ReturnType<typeof makeLogger>; recorder: HarnessOutcomeRecorder; store: InMemoryHarnessStore} {
  const store = new InMemoryHarnessStore()
  const bus = new SessionEventBus()
  const logger = makeLogger()
  const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeHarnessConfig(config))
  return {logger, recorder, store}
}

/** Wire recorder + environment into a SandboxService ready for recording. */
function wireService(
  recorder: HarnessOutcomeRecorder,
  overrides?: {config?: Partial<ValidatedHarnessConfig>; workingDirectory?: string},
): SandboxService {
  const service = new SandboxService()
  service.setHarnessConfig(makeHarnessConfig(overrides?.config))
  service.setEnvironmentContext(makeEnvironmentContext(overrides?.workingDirectory))
  service.setHarnessOutcomeRecorder(recorder)
  return service
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SandboxService — harness outcome recording', () => {
  afterEach(() => {
    sinon.restore()
  })

  // ── Regression guard ─────────────────────────────────────────────────────

  it('without recorder set, executeCode behaves identically to today', async () => {
    const service = new SandboxService()

    const result = await service.executeCode('1 + 1', 'sess-1')

    expect(result.returnValue).to.equal(2)
    expect(result.stderr).to.equal('')
  })

  // ── Recording wiring ─────────────────────────────────────────────────────

  it('calls recorder.record once per executeCode with correct params', async () => {
    const {recorder} = createRecorder()
    const service = wireService(recorder, {config: {language: 'typescript'}, workingDirectory: '/my/project'})
    const spy = sinon.spy(recorder, 'record')

    await service.executeCode('1 + 1', 'sess-1', {
      commandType: 'curate',
      conversationTurn: 2,
      taskDescription: 'find the auth module',
    })

    expect(spy.calledOnce).to.equal(true)
    const params: RecordParams = spy.firstCall.args[0]
    expect(params.code).to.equal('1 + 1')
    expect(params.commandType).to.equal('curate')
    expect(params.sessionId).to.equal('sess-1')
    expect(params.result).to.have.property('stdout')
    expect(params.result).to.have.property('stderr')
    expect(params.executionTimeMs).to.be.a('number').and.to.be.at.least(0)
    expect(params.projectType).to.equal('typescript')
    expect(params.projectId).to.equal('/my/project')
    expect(params.conversationTurn).to.equal(2)
    expect(params.taskDescription).to.equal('find the auth module')
  })

  it('defaults commandType to chat when config.commandType is absent', async () => {
    const {recorder} = createRecorder()
    const service = wireService(recorder)
    const spy = sinon.spy(recorder, 'record')

    await service.executeCode('1', 'sess-1')

    expect(spy.calledOnce).to.equal(true)
    expect(spy.firstCall.args[0].commandType).to.equal('chat')
  })

  it('resolves projectType to generic when language is auto', async () => {
    const {recorder} = createRecorder()
    const service = wireService(recorder, {config: {language: 'auto'}})
    const spy = sinon.spy(recorder, 'record')

    await service.executeCode('1', 'sess-1')

    expect(spy.firstCall.args[0].projectType).to.equal('generic')
  })

  it('skips recording when environmentContext is not set', async () => {
    const {recorder} = createRecorder()
    const service = new SandboxService()
    service.setHarnessOutcomeRecorder(recorder)
    const spy = sinon.spy(recorder, 'record')

    const result = await service.executeCode('1 + 1', 'sess-1')

    expect(spy.callCount).to.equal(0)
    expect(result.returnValue).to.equal(2)
  })

  // ── Error resilience ─────────────────────────────────────────────────────

  it('recorder throwing synchronously does not break executeCode', async () => {
    const {recorder} = createRecorder()
    const service = wireService(recorder)
    sinon.stub(recorder, 'record').throws(new Error('sync boom'))

    const result = await service.executeCode('1 + 1', 'sess-1')

    expect(result.returnValue).to.equal(2)
    expect(result.stderr).to.equal('')
  })

  it('recorder returning rejected promise does not break executeCode', async () => {
    const {recorder} = createRecorder()
    const service = wireService(recorder)
    sinon.stub(recorder, 'record').rejects(new Error('async boom'))

    const result = await service.executeCode('1 + 1', 'sess-1')

    expect(result.returnValue).to.equal(2)
    expect(result.stderr).to.equal('')
  })

  // ── Fire-and-forget latency ──────────────────────────────────────────────

  it('executeCode latency is not blocked by slow recorder', async () => {
    const {recorder} = createRecorder()

    // Baseline: no recorder
    const baseline = new SandboxService()
    // Warm up to eliminate first-call overhead
    await baseline.executeCode('1', 'sess-warm')
    const t0Start = performance.now()
    await baseline.executeCode('1 + 1', 'sess-warm')
    const t0 = performance.now() - t0Start

    // With slow recorder that takes 100ms
    const service = wireService(recorder)
    sinon.stub(recorder, 'record').callsFake(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100)
      })
    })

    // Warm up
    await service.executeCode('1', 'sess-warm2')
    const t1Start = performance.now()
    await service.executeCode('1 + 1', 'sess-warm2')
    const t1 = performance.now() - t1Start

    // Fire-and-forget: T1 must NOT include the 100ms recorder delay.
    // Allow 2x baseline + 20ms tolerance for try/catch overhead.
    expect(t1).to.be.at.most(2 * t0 + 20)
  })
})
