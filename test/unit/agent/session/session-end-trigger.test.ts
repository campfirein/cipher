import {expect} from 'chai'
import sinon from 'sinon'

import type {CipherAgentServices} from '../../../../src/agent/core/interfaces/cipher-services.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {HarnessOutcomeRecorder} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'
import type {HarnessSynthesizer, SynthesisResult} from '../../../../src/agent/infra/harness/harness-synthesizer.js'

import {SessionManager} from '../../../../src/agent/infra/session/session-manager.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHarnessConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

/**
 * Stub synthesizer with controllable refineIfNeeded + cleanup.
 */
function makeSynthesizerStub(): HarnessSynthesizer & {
  cleanupStub: sinon.SinonStub
  refineStub: sinon.SinonStub<[string, 'chat' | 'curate' | 'query'], Promise<SynthesisResult | undefined>>
} {
  const refineStub = sinon.stub<[string, 'chat' | 'curate' | 'query'], Promise<SynthesisResult | undefined>>().resolves()
  const cleanupStub = sinon.stub()
  return {
    cleanup: cleanupStub,
    cleanupStub,
    refineIfNeeded: refineStub,
    refineStub,
  } as unknown as HarnessSynthesizer & {
    cleanupStub: sinon.SinonStub
    refineStub: sinon.SinonStub<[string, 'chat' | 'curate' | 'query'], Promise<SynthesisResult | undefined>>
  }
}

/**
 * Stub outcome recorder with controllable session state.
 */
function makeRecorderStub(opts: {
  commandTypes?: ReadonlySet<string>
  projectId?: string
}): HarnessOutcomeRecorder {
  return {
    cleanup: sinon.stub(),
    clearSession: sinon.stub(),
    getCommandTypesForSession: sinon.stub().returns(opts.commandTypes ?? new Set<string>()),
    getProjectIdForSession: sinon.stub().returns(opts.projectId ?? 'proj-1'),
  } as unknown as HarnessOutcomeRecorder
}

/**
 * Minimal stub session for endSession — just enough to not throw.
 */
function makeSessionStub() {
  return {
    dispose: sinon.stub(),
    getLLMService: () => ({
      getContextManager: () => ({
        flush: sinon.stub().resolves(),
      }),
    }),
  }
}

/**
 * Build a minimal CipherAgentServices for session-end trigger tests.
 * Only the harness-related fields need real stubs.
 */
function makeSharedServices(opts: {
  harnessConfig?: ValidatedHarnessConfig
  harnessOutcomeRecorder?: HarnessOutcomeRecorder
  harnessSynthesizer?: HarnessSynthesizer
}): CipherAgentServices {
  return {
    ...opts,
    harnessConfig: opts.harnessConfig ?? makeHarnessConfig(),
    harnessOutcomeRecorder: opts.harnessOutcomeRecorder,
    harnessSynthesizer: opts.harnessSynthesizer,
  } as unknown as CipherAgentServices
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager — session-end harness trigger', () => {
  let clock: sinon.SinonFakeTimers

  afterEach(() => {
    sinon.restore()
    if (clock) clock.restore()
  })

  it('endSession fires refineIfNeeded for each command type the session touched', async () => {
    const synthesizer = makeSynthesizerStub()
    const recorder = makeRecorderStub({
      commandTypes: new Set(['curate', 'query']),
      projectId: 'proj-1',
    })
    const services = makeSharedServices({
      harnessOutcomeRecorder: recorder,
      harnessSynthesizer: synthesizer,
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )

    // Inject a stub session into the manager's session map
    const session = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session)

    await sm.endSession('s1')

    // Allow fire-and-forget promises to settle
    await new Promise((r) => { setTimeout(r, 10) })

    expect(synthesizer.refineStub.callCount).to.equal(2)
    expect(synthesizer.refineStub.calledWith('proj-1', 'curate')).to.equal(true)
    expect(synthesizer.refineStub.calledWith('proj-1', 'query')).to.equal(true)
  })

  it('endSession is a no-op when harness is disabled', async () => {
    const synthesizer = makeSynthesizerStub()
    const recorder = makeRecorderStub({commandTypes: new Set(['curate'])})
    const services = makeSharedServices({
      harnessConfig: makeHarnessConfig({enabled: false}),
      harnessOutcomeRecorder: recorder,
      harnessSynthesizer: synthesizer,
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )
    const session = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session)

    await sm.endSession('s1')
    await new Promise((r) => { setTimeout(r, 10) })

    expect(synthesizer.refineStub.callCount).to.equal(0)
  })

  it('endSession is a no-op when autoLearn is false', async () => {
    const synthesizer = makeSynthesizerStub()
    const recorder = makeRecorderStub({commandTypes: new Set(['curate'])})
    const services = makeSharedServices({
      harnessConfig: makeHarnessConfig({autoLearn: false}),
      harnessOutcomeRecorder: recorder,
      harnessSynthesizer: synthesizer,
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )
    const session = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session)

    await sm.endSession('s1')
    await new Promise((r) => { setTimeout(r, 10) })

    expect(synthesizer.refineStub.callCount).to.equal(0)
  })

  it('deduplicate: calling endSession twice for the same session only fires once', async () => {
    const synthesizer = makeSynthesizerStub()
    const recorder = makeRecorderStub({commandTypes: new Set(['curate'])})
    const services = makeSharedServices({
      harnessOutcomeRecorder: recorder,
      harnessSynthesizer: synthesizer,
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )

    // First call with a real session
    const session1 = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session1)
    await sm.endSession('s1')

    // Second call — session is gone from map, so endSession returns false
    // The dedup set prevents the trigger from firing again even if
    // the session were re-added
    const session2 = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session2)
    await sm.endSession('s1')

    await new Promise((r) => { setTimeout(r, 10) })

    expect(synthesizer.refineStub.callCount).to.equal(1)
  })

  it('synthesizer errors do not break session cleanup', async () => {
    const synthesizer = makeSynthesizerStub()
    synthesizer.refineStub.rejects(new Error('LLM down'))
    const recorder = makeRecorderStub({commandTypes: new Set(['curate'])})
    const services = makeSharedServices({
      harnessOutcomeRecorder: recorder,
      harnessSynthesizer: synthesizer,
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )
    const session = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session)

    // endSession must succeed despite synthesizer error
    const result = await sm.endSession('s1')
    expect(result).to.equal(true)
  })

  it('no-op when synthesizer is not wired', async () => {
    const recorder = makeRecorderStub({commandTypes: new Set(['curate'])})
    const services = makeSharedServices({
      harnessOutcomeRecorder: recorder,
      // No synthesizer
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )
    const session = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session)

    // Should not throw
    const result = await sm.endSession('s1')
    expect(result).to.equal(true)
  })

  it('endedSessions dedup set is cleaned up after grace window', async () => {
    clock = sinon.useFakeTimers({shouldAdvanceTime: false})

    const synthesizer = makeSynthesizerStub()
    const recorder = makeRecorderStub({commandTypes: new Set(['curate'])})
    const services = makeSharedServices({
      harnessOutcomeRecorder: recorder,
      harnessSynthesizer: synthesizer,
    })

    const sm = new SessionManager(
      services,
      {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
      {model: 'test-model'},
    )
    const session = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session)
    await sm.endSession('s1')

    // Advance past the 60s grace window
    clock.tick(61_000)

    // Re-add session and end again — trigger should fire because dedup expired
    const session2 = makeSessionStub()
    ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('s1', session2)
    await sm.endSession('s1')
    await clock.tickAsync(10)

    expect(synthesizer.refineStub.callCount).to.equal(2)

    sm.dispose()
  })
})
