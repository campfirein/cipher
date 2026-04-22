/**
 * Integration test — Phase 5 mode selection + prompt injection + Mode C caps.
 *
 * Exercises Phase 3 + Phase 4 + Phase 5 end to end against real
 * components: HarnessStore (`FileKeyStorage({inMemory: true})`),
 * HarnessBootstrap, HarnessModuleBuilder, SandboxService,
 * SystemPromptManager with the real `HarnessContributor` registered,
 * AgentLLMService with a stub content generator (the LLM never
 * runs — this test verifies the prompt assembly + event emission
 * + Mode C cap path, not LLM behavior).
 *
 * Scenarios:
 *   1. H-driven Mode A — seeded outcomes produce H = 0.30, event
 *      fires with `mode: 'assisted'`, system prompt contains the
 *      assisted block.
 *   2. Override-driven Mode B — `modeOverride: 'filter'` + low H
 *      → event fires with `mode: 'filter'`, prompt contains the
 *      filter block.
 *   3. Override-driven Mode C — `modeOverride: 'policy'` → prompt
 *      contains the Mode C directive.
 *   4. Mode C ops cap — harness that calls `ctx.tools.curate` 51
 *      times → the 51st throws, surface-normalized error contains
 *      "ops cap exceeded".
 *   5. Below-threshold, no override → no event, empty harness block.
 *
 * Budget: < 5s (Phase 5.5 AC).
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {HarnessMode, HarnessVersion} from '../../../../src/agent/core/domain/harness/types.js'
import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'
import type {IToolProvider} from '../../../../src/agent/core/interfaces/i-tool-provider.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessBootstrap} from '../../../../src/agent/infra/harness/harness-bootstrap.js'
import {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {
  GLOBAL_RATE_LIMITER,
  TEST_ONLY_RESET,
} from '../../../../src/agent/infra/harness/rate-limiter.js'
import {AgentLLMService} from '../../../../src/agent/infra/llm/agent-llm-service.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'
import {HarnessContributor} from '../../../../src/agent/infra/system-prompt/contributors/harness-contributor.js'
import {SystemPromptManager} from '../../../../src/agent/infra/system-prompt/system-prompt-manager.js'
import {ToolManager} from '../../../../src/agent/infra/tools/tool-manager.js'

// ── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'typescript',
    maxVersions: 20,
    ...overrides,
  }
}

function makeVersion(projectId: string, overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: `
      exports.meta = function() {
        return {
          capabilities: ['curate'],
          commandType: 'curate',
          projectPatterns: ['**/*'],
          version: 1,
        }
      }
      exports.curate = async function(ctx) {
        return {ok: true}
      }
    `,
    commandType: 'curate',
    createdAt: Date.now(),
    heuristic: 0.45,
    id: 'v-integ-test',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId,
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

/**
 * Seed outcomes that produce a target heuristic. Uses the pass-through
 * bound: all outcomes carry `delegated: true`, so realHarnessRate is 0.
 * With all-delegated outcomes, the formula reduces to
 * `0.2·sr + 0.3·(1-er)` (cap at 0.5).
 *
 *  - H = 0.30: 15 outcomes with success=false, stderr='' → sr=0, er=0.
 *  - H = 0.00: 15 outcomes with success=false, stderr='x' → sr=0, er=1.
 */
function seedOutcomes(
  store: HarnessStore,
  projectId: string,
  spec: {count: number; stderr: string; success: boolean},
): Promise<void[]> {
  const now = Date.now()
  const promises: Promise<void>[] = []
  for (let i = 0; i < spec.count; i++) {
    promises.push(
      store.saveOutcome({
        code: `step ${i}`,
        commandType: 'curate',
        delegated: true,
        executionTimeMs: 10,
        id: `o-${i}-${now}`,
        projectId,
        projectType: 'typescript',
        sessionId: 'integ-sess',
        stderr: spec.stderr,
        success: spec.success,
        timestamp: now - i * 1000,
        usedHarness: true,
      }),
    )
  }

  return Promise.all(promises)
}

interface Stack {
  readonly agentService: AgentLLMService
  readonly harnessStore: HarnessStore
  readonly sandboxService: SandboxService
  readonly sessionEventBus: SessionEventBus
  readonly systemPromptManager: SystemPromptManager
}

async function buildStack(
  sessionId: string,
  harnessConfig: ValidatedHarnessConfig,
): Promise<Stack> {
  const logger = new NoOpLogger()
  const sessionEventBus = new SessionEventBus()

  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  const harnessStore = new HarnessStore(keyStorage, logger)

  const sandboxService = new SandboxService()
  const builder = new HarnessModuleBuilder(logger)
  sandboxService.setHarnessConfig(harnessConfig)
  sandboxService.setHarnessStore(harnessStore)
  sandboxService.setHarnessModuleBuilder(builder)

  // Bootstrap is wired but we never call it in these tests — every
  // scenario directly saves a version into the store (either the happy
  // template or the 51-ops cap-testing variant in scenario 4). This
  // exercises mode selection in isolation.
  const harnessBootstrap = new HarnessBootstrap(
    harnessStore,
    // HarnessBootstrap's 2nd arg is `IFileSystem`, used only inside
    // `bootstrapIfNeeded` for project-type detection. We never call
    // that method here, so an empty object cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    harnessConfig,
    logger,
  )

  const systemPromptManager = new SystemPromptManager()
  if (harnessConfig.enabled) {
    systemPromptManager.registerContributor(new HarnessContributor())
  }

  const mockToolProvider = {
    getAllTools: () => ({}),
    getAvailableMarkers: () => new Set<string>(),
    getToolNames: () => [],
  }
  const toolManager = new ToolManager(mockToolProvider as unknown as IToolProvider)

  // Content generator is never called in these tests — the LLM path is
  // out of scope. A stub that throws on use catches any accidental LLM
  // traffic with a clear error.
  const generator: IContentGenerator = {
    generateContent() {
      throw new Error('integration test: content generator must not be invoked')
    },
  } as unknown as IContentGenerator

  const agentService = new AgentLLMService(
    sessionId,
    generator,
    {model: 'gemini-2.5-flash'},
    {
      harnessBootstrap,
      harnessConfig,
      harnessStore,
      sandboxService,
      sessionEventBus,
      systemPromptManager,
      toolManager,
    },
  )

  return {agentService, harnessStore, sandboxService, sessionEventBus, systemPromptManager}
}

/** Private-method test access — same pattern as `agent-llm-service-harness-wiring.test.ts`. */
type EnsureHarnessReadyResult = undefined | {mode: HarnessMode; version: HarnessVersion}
function callEnsureHarnessReady(
  service: AgentLLMService,
  commandType: 'chat' | 'curate' | 'query',
): Promise<EnsureHarnessReadyResult> {
  const internal = service as unknown as {
    ensureHarnessReady: (ct: 'chat' | 'curate' | 'query') => Promise<EnsureHarnessReadyResult>
  }
  return internal.ensureHarnessReady(commandType)
}

// ── Suite ────────────────────────────────────────────────────────────────

describe('AutoHarness V2 — Phase 5 mode selection integration', function () {
  this.timeout(10_000)

  let sb: SinonSandbox
  let projectId: string
  let modeEvents: Array<{heuristic: number; mode: HarnessMode;}>

  beforeEach(() => {
    sb = createSandbox()
    // AgentLLMService reads `process.cwd()` at construction to seed its
    // `workingDirectory` field, which becomes the HarnessStore partition
    // key. Real paths contain `/`, which `FileKeyStorage` rejects as a
    // key segment (slug/path gap — see outcome-collection.test.ts:32).
    // Stubbing `process.cwd()` to return a slug side-steps the gap here
    // without patching the production code. Scoped to each test.
    projectId = 'mode-integ-project'
    sb.stub(process, 'cwd').returns(projectId)
    modeEvents = []
    GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
  })

  afterEach(() => {
    sb.restore()
    GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
  })

  async function setupStackWithVersion(
    sessionId: string,
    config: ValidatedHarnessConfig,
    version: HarnessVersion = makeVersion(projectId),
  ): Promise<Stack> {
    const stack = await buildStack(sessionId, config)
    stack.sessionEventBus.on('harness:mode-selected', (payload) => {
      modeEvents.push(payload as {heuristic: number; mode: HarnessMode;})
    })
    await stack.harnessStore.saveVersion(version)
    return stack
  }

  it('1. H-driven Mode A: H=0.30 → event+prompt say assisted', async () => {
    const stack = await setupStackWithVersion('sess-a', makeConfig())
    // 15 outcomes with success=false, stderr='' → sr=0, er=0 → H=0.30.
    await seedOutcomes(stack.harnessStore, projectId, {count: 15, stderr: '', success: false})

    const ready = await callEnsureHarnessReady(stack.agentService, 'curate')

    expect(ready?.mode).to.equal('assisted')
    expect(modeEvents).to.have.length(1)
    expect(modeEvents[0].mode).to.equal('assisted')
    expect(modeEvents[0].heuristic).to.be.closeTo(0.3, 0.05)

    const prompt = await stack.systemPromptManager.build({
      commandType: 'curate',
      harnessMode: ready?.mode,
      harnessVersion: ready?.version,
    })
    expect(prompt).to.include('<harness-v2 mode="assisted"')
  })

  it('2. Override-driven Mode B: modeOverride=filter wins over any H', async () => {
    const stack = await setupStackWithVersion(
      'sess-b',
      makeConfig({modeOverride: 'filter'}),
    )
    // No outcomes seeded — H would be null, but override short-circuits.

    const ready = await callEnsureHarnessReady(stack.agentService, 'curate')

    expect(ready?.mode).to.equal('filter')
    // Length guard before indexed access — a silent emission failure
    // should surface as "expected length 1, got 0", not TypeError.
    expect(modeEvents).to.have.length(1)
    expect(modeEvents[0].mode).to.equal('filter')
    // Sentinel value: when override fires with no outcomes (H is null),
    // `ensureHarnessReady` emits `heuristic: 0` via `rawHeuristic ?? 0`.
    // Pin the sentinel so a future encoding change (e.g. `-1` or `NaN`)
    // breaks this test visibly rather than silently.
    expect(modeEvents[0].heuristic).to.equal(0)

    const prompt = await stack.systemPromptManager.build({
      commandType: 'curate',
      harnessMode: ready?.mode,
      harnessVersion: ready?.version,
    })
    expect(prompt).to.include('<harness-v2 mode="filter"')
    expect(prompt).to.match(/invoke|obtain|call/i)
  })

  it('3. Override-driven Mode C: modeOverride=policy → prompt names autonomous directive', async () => {
    const stack = await setupStackWithVersion(
      'sess-c',
      makeConfig({modeOverride: 'policy'}),
    )

    const ready = await callEnsureHarnessReady(stack.agentService, 'curate')

    expect(ready?.mode).to.equal('policy')
    // Length guard + sentinel check — same rationale as scenario 2.
    expect(modeEvents).to.have.length(1)
    expect(modeEvents[0].mode).to.equal('policy')
    expect(modeEvents[0].heuristic).to.equal(0)

    const prompt = await stack.systemPromptManager.build({
      commandType: 'curate',
      harnessMode: ready?.mode,
      harnessVersion: ready?.version,
    })
    expect(prompt).to.include('<harness-v2 mode="policy"')
    // Mode C's load-bearing directive — the "don't write own
    // orchestration" instruction that weak models tend to ignore.
    expect(prompt).to.match(/do not|don['’]t/i)
  })

  it('4. Mode C ops cap: 51st ctx.tools.curate call throws through error normalization', async () => {
    const config = makeConfig({modeOverride: 'policy'})
    // Harness that bursts 51 `ctx.tools.curate` calls. Exercises the
    // unconditional 50-op cap wired in `buildHarnessTools`. Invoked via
    // the sandbox's `harness.curate()` namespace so the OpsCounter-
    // wrapped tools are the ones the harness code actually calls —
    // invoking `module.curate(ctx)` with a test-supplied ctx would
    // bypass the counter.
    const burstyCode = `
      exports.meta = function() {
        return {
          capabilities: ['curate'],
          commandType: 'curate',
          projectPatterns: ['**/*'],
          version: 1,
        }
      }
      exports.curate = async function(ctx) {
        for (let i = 0; i < 51; i++) {
          await ctx.tools.curate([])
        }
        return {ok: true}
      }
    `
    const stack = await setupStackWithVersion(
      'sess-cap',
      config,
      makeVersion(projectId, {code: burstyCode, id: 'v-bursty'}),
    )

    // Wire minimal tool services so `buildHarnessTools`'s service-
    // wired guards pass and the counter actually runs. The stub resolves
    // quickly (50 invocations per call is fine).
    //
    // FOLLOW-UP: direct assignment to private fields is brittle against
    // renames. `SandboxService` should grow typed test-injection setters
    // (e.g., `setCurateService(...)`, `setFileSystem(...)`) — tracked
    // outside this PR so the integration gate can land first. Same
    // pattern used by `outcome-collection.test.ts` and `cold-start.test.ts`.
    const curateStub = sb.stub().resolves({applied: 0, errors: [], items: []})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(stack.sandboxService as any).curateService = {curate: curateStub}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(stack.sandboxService as any).fileSystem = {readFile: sb.stub().resolves({content: ''})}

    const loadResult = await stack.sandboxService.loadHarness('sess-cap', projectId, 'curate')
    expect(loadResult.loaded).to.equal(true)

    // Invoke via sandbox's own `harness.curate()` namespace. The
    // sandbox's `buildCtx()` wraps `ctx.tools.*` with the per-call
    // OpsCounter, so the 51st call throws and the error surfaces as
    // the sandbox result's `stderr`. Use an async IIFE because the
    // sandbox does not support top-level `await` in every mode.
    const execResult = await stack.sandboxService.executeCode(
      '(async () => harness.curate())().catch((e) => { throw e })',
      'sess-cap',
    )

    // Phase 3 Task 3.2 normalizes thrown errors as
    // `harness curate() failed: …`. The inner message must surface
    // the OPS_CAP_EXCEEDED context.
    const errorText = execResult.stderr + ' ' + (execResult.returnValue === undefined ? '' : String(execResult.returnValue))
    expect(errorText).to.match(/curate\(\) failed/)
    expect(errorText).to.match(/ops cap exceeded/i)
    // Stub fired for each successful increment up to the cap.
    expect(curateStub.callCount).to.equal(50)
  })

  it('5. Below-threshold + no override → no event, empty prompt block', async () => {
    const stack = await setupStackWithVersion('sess-low', makeConfig())
    // sr=0, er=1 → H = 0.2·0 + 0.3·0 + 0 = 0. Below Mode A floor.
    await seedOutcomes(stack.harnessStore, projectId, {count: 15, stderr: 'err', success: false})

    const ready = await callEnsureHarnessReady(stack.agentService, 'curate')

    expect(ready).to.equal(undefined)
    expect(modeEvents).to.have.length(0)

    const prompt = await stack.systemPromptManager.build({
      commandType: 'curate',
      harnessMode: ready?.mode,
      harnessVersion: ready?.version,
    })
    expect(prompt).to.not.include('<harness-v2')
  })
})
