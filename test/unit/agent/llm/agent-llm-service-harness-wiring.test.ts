import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  CodeExecOutcome,
  HarnessMode,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'
import type {ISandboxService} from '../../../../src/agent/core/interfaces/i-sandbox-service.js'
import type {IToolProvider} from '../../../../src/agent/core/interfaces/i-tool-provider.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessBootstrap} from '../../../../src/agent/infra/harness/harness-bootstrap.js'
import {ByteRoverLlmHttpService} from '../../../../src/agent/infra/http/internal-llm-http-service.js'
import {AgentLLMService} from '../../../../src/agent/infra/llm/agent-llm-service.js'
import {ByteRoverContentGenerator} from '../../../../src/agent/infra/llm/generators/byterover-content-generator.js'
import {SystemPromptManager} from '../../../../src/agent/infra/system-prompt/system-prompt-manager.js'
import {ToolManager} from '../../../../src/agent/infra/tools/tool-manager.js'

const PROJECT_ID = process.cwd() // AgentLLMService uses this as projectId

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'typescript',
    maxVersions: 20,
    ...overrides,
  }
}

function makeVersion(): HarnessVersion {
  return {
    code: '/* placeholder */',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.45,
    id: 'v-test-wiring',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*.ts'],
      version: 1,
    },
    projectId: PROJECT_ID,
    projectType: 'typescript',
    version: 1,
  }
}

function makeOutcomes(count: number, successRate: number, now: number): CodeExecOutcome[] {
  const outcomes: CodeExecOutcome[] = []
  for (let i = 0; i < count; i++) {
    outcomes.push({
      code: `step ${i}`,
      commandType: 'curate',
      delegated: true,
      executionTimeMs: 10,
      id: `o-${i}`,
      projectId: PROJECT_ID,
      projectType: 'typescript',
      sessionId: 'sess',
      success: i < Math.round(count * successRate),
      timestamp: now - i * 1000,
      usedHarness: true,
    })
  }

  return outcomes
}

function createContentGenerator() {
  const httpService = new ByteRoverLlmHttpService({
    apiBaseUrl: 'http://localhost:3000',
    sessionKey: 'k',
    spaceId: 's',
    teamId: 't',
  })
  return new ByteRoverContentGenerator(httpService, {model: 'gemini-2.5-flash'})
}

type HarnessStub = {
  readonly bootstrap: HarnessBootstrap & {bootstrapIfNeeded: SinonStub}
  readonly sandboxService: ISandboxService & {loadHarness: SinonStub}
  readonly store: IHarnessStore & {listOutcomes: SinonStub}
}

function makeHarnessStubs(sb: SinonSandbox): HarnessStub {
  const bootstrapIfNeeded = sb.stub().resolves()
  const loadHarness = sb.stub()
  const listOutcomes = sb.stub().resolves([])

  // Minimal stubs — AgentLLMService only calls these three methods.
  const bootstrap = {bootstrapIfNeeded} as unknown as HarnessBootstrap & {
    bootstrapIfNeeded: SinonStub
  }
  const sandboxService = {
    cleanup: sb.stub(),
    clearSession: sb.stub(),
    deleteSandboxVariable: sb.stub(),
    executeCode: sb.stub(),
    loadHarness,
    setSandboxVariable: sb.stub(),
  } as unknown as ISandboxService & {loadHarness: SinonStub}
  const store = {listOutcomes} as unknown as IHarnessStore & {listOutcomes: SinonStub}

  return {bootstrap, sandboxService, store}
}

function buildService(deps: {
  config?: ValidatedHarnessConfig
  harnessBootstrap?: HarnessBootstrap
  harnessStore?: IHarnessStore
  sandboxService?: ISandboxService
  sb: SinonSandbox
  sessionEventBus: SessionEventBus
}): AgentLLMService {
  const mockToolProvider = {
    getAllTools: deps.sb.stub().returns({}),
    getAvailableMarkers: deps.sb.stub().returns(new Set<string>()),
    getToolNames: deps.sb.stub().returns([]),
  }
  const toolManager = new ToolManager(mockToolProvider as unknown as IToolProvider)

  return new AgentLLMService(
    'test-session',
    createContentGenerator(),
    {model: 'gemini-2.5-flash'},
    {
      harnessBootstrap: deps.harnessBootstrap,
      harnessConfig: deps.config,
      harnessStore: deps.harnessStore,
      sandboxService: deps.sandboxService,
      sessionEventBus: deps.sessionEventBus,
      systemPromptManager: new SystemPromptManager(),
      toolManager,
    },
  )
}

// Private-method access helper. AgentLLMService's `ensureHarnessReady`
// is private (correctly scoped — external callers go through
// `completeTask` which invokes it indirectly). Unit-testing the
// orchestration logic without constructing the full turn would be
// impractical, so the cast below intentionally reaches the private
// method. Confined to this test file.
type EnsureHarnessReadyResult = undefined | {mode: HarnessMode; version: HarnessVersion}
function callEnsureHarnessReady(
  service: AgentLLMService,
  commandType: 'chat' | 'curate' | 'query',
): Promise<EnsureHarnessReadyResult> {
  const internal = service as unknown as {
    ensureHarnessReady: (commandType: 'chat' | 'curate' | 'query') => Promise<EnsureHarnessReadyResult>
  }
  return internal.ensureHarnessReady(commandType)
}

describe('AgentLLMService.ensureHarnessReady (Phase 5 Task 5.4 wiring)', () => {
  let sb: SinonSandbox
  let sessionEventBus: SessionEventBus
  let modeSelectedEvents: Array<Record<string, unknown>>

  beforeEach(() => {
    sb = createSandbox()
    sessionEventBus = new SessionEventBus()
    modeSelectedEvents = []
    sessionEventBus.on('harness:mode-selected', (payload) => {
      modeSelectedEvents.push(payload as Record<string, unknown>)
    })
  })

  afterEach(() => {
    sb.restore()
  })

  it('1. harness.enabled=false → no bootstrap call, no event, returns undefined', async () => {
    const stubs = makeHarnessStubs(sb)
    const service = buildService({
      config: makeConfig({enabled: false}),
      harnessBootstrap: stubs.bootstrap,
      harnessStore: stubs.store,
      sandboxService: stubs.sandboxService,
      sb,
      sessionEventBus,
    })

    const result = await callEnsureHarnessReady(service, 'curate')

    expect(result).to.equal(undefined)
    expect(stubs.bootstrap.bootstrapIfNeeded.callCount).to.equal(0)
    expect(modeSelectedEvents).to.have.length(0)
  })

  it('2. loadHarness returns no-version → no event, returns undefined', async () => {
    const stubs = makeHarnessStubs(sb)
    stubs.sandboxService.loadHarness.resolves({loaded: false, reason: 'no-version'})
    const service = buildService({
      config: makeConfig(),
      harnessBootstrap: stubs.bootstrap,
      harnessStore: stubs.store,
      sandboxService: stubs.sandboxService,
      sb,
      sessionEventBus,
    })

    const result = await callEnsureHarnessReady(service, 'curate')

    expect(result).to.equal(undefined)
    expect(stubs.bootstrap.bootstrapIfNeeded.callCount).to.equal(1)
    expect(modeSelectedEvents).to.have.length(0)
  })

  it('3. happy path: loaded + H in Mode A → emits event, returns {mode: assisted, version}', async () => {
    const stubs = makeHarnessStubs(sb)
    const version = makeVersion()
    stubs.sandboxService.loadHarness.resolves({loaded: true, version})
    // Seed outcomes that produce H in [0.30, 0.60) — pass-through cap.
    stubs.store.listOutcomes.resolves(makeOutcomes(20, 1, Date.now()))

    const service = buildService({
      config: makeConfig(),
      harnessBootstrap: stubs.bootstrap,
      harnessStore: stubs.store,
      sandboxService: stubs.sandboxService,
      sb,
      sessionEventBus,
    })

    const result = await callEnsureHarnessReady(service, 'curate')

    expect(result).to.not.equal(undefined)
    expect(result?.mode).to.equal('assisted')
    expect(result?.version.id).to.equal('v-test-wiring')
    expect(modeSelectedEvents).to.have.length(1)
    const [event] = modeSelectedEvents
    expect(event.commandType).to.equal('curate')
    expect(event.mode).to.equal('assisted')
    expect(event.projectId).to.equal(PROJECT_ID)
    expect(event.version).to.equal(1)
    expect(event.heuristic).to.be.a('number')
  })

  it('4. heuristic=null (insufficient outcomes) → no event, returns undefined', async () => {
    const stubs = makeHarnessStubs(sb)
    stubs.sandboxService.loadHarness.resolves({loaded: true, version: makeVersion()})
    // Fewer than the min-sample floor → computeHeuristic returns null.
    stubs.store.listOutcomes.resolves(makeOutcomes(5, 1, Date.now()))

    const service = buildService({
      config: makeConfig(),
      harnessBootstrap: stubs.bootstrap,
      harnessStore: stubs.store,
      sandboxService: stubs.sandboxService,
      sb,
      sessionEventBus,
    })

    const result = await callEnsureHarnessReady(service, 'curate')

    expect(result).to.equal(undefined)
    expect(modeSelectedEvents).to.have.length(0)
  })

  it('5. modeOverride=policy + low H → returns policy (override wins); event carries policy', async () => {
    const stubs = makeHarnessStubs(sb)
    stubs.sandboxService.loadHarness.resolves({loaded: true, version: makeVersion()})
    stubs.store.listOutcomes.resolves(makeOutcomes(20, 0, Date.now())) // H would be ~0 without override

    const service = buildService({
      config: makeConfig({modeOverride: 'policy'}),
      harnessBootstrap: stubs.bootstrap,
      harnessStore: stubs.store,
      sandboxService: stubs.sandboxService,
      sb,
      sessionEventBus,
    })

    const result = await callEnsureHarnessReady(service, 'curate')

    expect(result?.mode).to.equal('policy')
    expect(modeSelectedEvents).to.have.length(1)
    expect(modeSelectedEvents[0].mode).to.equal('policy')
  })

  it('6. event fires ONCE per (sessionId, commandType) across multiple calls', async () => {
    const stubs = makeHarnessStubs(sb)
    stubs.sandboxService.loadHarness.resolves({loaded: true, version: makeVersion()})
    stubs.store.listOutcomes.resolves(makeOutcomes(20, 1, Date.now()))

    const service = buildService({
      config: makeConfig(),
      harnessBootstrap: stubs.bootstrap,
      harnessStore: stubs.store,
      sandboxService: stubs.sandboxService,
      sb,
      sessionEventBus,
    })

    // Three turns, same commandType.
    await callEnsureHarnessReady(service, 'curate')
    await callEnsureHarnessReady(service, 'curate')
    await callEnsureHarnessReady(service, 'curate')

    expect(modeSelectedEvents).to.have.length(1)
  })
})
