/**
 * Integration test — null-mode path when H is below Mode A threshold.
 *
 * Exercises the full stack to prove that when heuristic H = 0 (below
 * Mode A floor of 0.30), harness injection is cleanly skipped:
 *
 *   - `ensureHarnessReady` returns `undefined`
 *   - `harness:mode-selected` event does NOT fire
 *   - System prompt does NOT contain `<harness-v2 …>`
 *   - Sandbox code evaluates `typeof harness === 'undefined'` as true
 *
 * Then proves the skip is transient: seeding outcomes that climb H
 * above 0.30 enables Mode A on the next call, with event emission
 * and harness namespace available in the sandbox.
 *
 * Complements the cli-lifecycle test (7.7) and mode-selection test
 * (5.5 scenario 5) — those verify lifecycle and mode gating; this
 * pins the null-mode → Mode A transition in a single continuous flow.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'null-mode-skip-test'
const COMMAND_TYPE = 'curate' as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'typescript',
    maxVersions: 20,
    ...overrides,
  }
}

function makeVersion(projectId: string): HarnessVersion {
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
    id: 'v-null-mode-test',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId,
    projectType: 'typescript',
    version: 1,
  }
}

/**
 * Seed N outcomes into the store. Uses `batchIndex` to space timestamps:
 * batch 0 outcomes are older, batch 1 are newer. This ensures the
 * window (most-recent 50) is dominated by the later batch when both
 * exist.
 */
async function seedOutcomes(
  store: HarnessStore,
  projectId: string,
  spec: {batchIndex?: number; count: number; stderr: string; success: boolean},
): Promise<void> {
  const now = Date.now()
  // Batch 0 timestamps: 100s ago. Batch 1: recent.
  // Ensures batch 1 outcomes are strictly more recent than batch 0.
  const baseOffset = spec.batchIndex === 1 ? 0 : 100_000
  const promises: Promise<void>[] = []
  for (let i = 0; i < spec.count; i++) {
    promises.push(
      store.saveOutcome({
        code: `step ${i}`,
        commandType: COMMAND_TYPE,
        delegated: true,
        executionTimeMs: 10,
        id: `o-batch${spec.batchIndex ?? 0}-${i}-${now}`,
        projectId,
        projectType: 'typescript',
        sessionId: 'integ-sess',
        stderr: spec.stderr,
        success: spec.success,
        timestamp: now - baseOffset + i * 1000,
        usedHarness: true,
      }),
    )
  }

  await Promise.all(promises)
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

  const harnessBootstrap = new HarnessBootstrap(
    harnessStore,
    // HarnessBootstrap's 2nd arg is `IFileSystem`, used only inside
    // `bootstrapIfNeeded` for project-type detection. Not called in
    // this test — versions are seeded directly.
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

/** Private-method test access — same pattern as mode-selection.test.ts. */
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AutoHarness V2 — null-mode skip integration', function () {
  this.timeout(10_000)

  let sb: SinonSandbox
  let modeEvents: Array<{heuristic: number; mode: HarnessMode}>

  beforeEach(() => {
    sb = createSandbox()
    sb.stub(process, 'cwd').returns(PROJECT_ID)
    modeEvents = []
    GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
  })

  afterEach(() => {
    sb.restore()
    GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
  })

  it('H=0 skips cleanly, then H climb enables Mode A', async () => {
    // ── Step 1: Stack setup ──────────────────────────────────────────
    // harness.enabled: true, no modeOverride.
    const sessionId = 'null-mode-sess'
    const config = makeConfig()
    const stack = await buildStack(sessionId, config)
    stack.sessionEventBus.on('harness:mode-selected', (payload) => {
      modeEvents.push(payload as {heuristic: number; mode: HarnessMode})
    })

    // ── Step 2: Seed v1 ──────────────────────────────────────────────
    const version = makeVersion(PROJECT_ID)
    await stack.harnessStore.saveVersion(version)

    // ── Step 3: Seed 15 outcomes → H = 0 ─────────────────────────────
    // success=false, stderr='err' → successRate=0, errorRate=1,
    // realHarnessRate=0 → H = 0.2·0 + 0.3·(1-1) + 0.5·0 = 0.
    await seedOutcomes(stack.harnessStore, PROJECT_ID, {
      batchIndex: 0,
      count: 15,
      stderr: 'err',
      success: false,
    })

    // ── Step 4: ensureHarnessReady → undefined, no event ─────────────
    const ready = await callEnsureHarnessReady(stack.agentService, COMMAND_TYPE)

    expect(ready).to.equal(undefined)
    expect(modeEvents).to.have.length(0)

    // ── Step 5: System prompt has no harness block ────────────────────
    const prompt = await stack.systemPromptManager.build({
      commandType: COMMAND_TYPE,
      harnessMode: ready?.mode,
      harnessVersion: ready?.version,
    })
    expect(prompt).to.not.include('<harness-v2')

    // ── Step 6: Sandbox code → typeof harness === 'undefined' ────────
    // Use a fresh session that never had loadHarness called — proves
    // the null-mode code path leaves the sandbox clean.
    const cleanSessionId = 'no-harness-session'
    const exec = await stack.sandboxService.executeCode(
      `typeof harness === 'undefined'`,
      cleanSessionId,
    )
    expect(exec.returnValue).to.equal(true)

    // ── Step 7: Seed outcomes to climb H above 0.30 ──────────────────
    // 40 outcomes with success=true, stderr='' at more-recent timestamps.
    // Window of 50: ~40 successes + ~10 failures from batch 0.
    // H ≈ 0.2·(40/50) + 0.3·(1 - 10/50) + 0 = 0.16 + 0.24 = 0.40.
    await seedOutcomes(stack.harnessStore, PROJECT_ID, {
      batchIndex: 1,
      count: 40,
      stderr: '',
      success: true,
    })

    // ── Step 8: ensureHarnessReady → Mode A, event fires ─────────────
    // The first call (step 4) returned before the dedup check, so
    // the dedup key was NOT added. This call emits the event.
    const readyAfter = await callEnsureHarnessReady(stack.agentService, COMMAND_TYPE)

    expect(readyAfter).to.not.equal(undefined)
    if (readyAfter === undefined) throw new Error('expected Mode A selection after H climb')
    expect(readyAfter.mode).to.equal('assisted')

    expect(modeEvents).to.have.length(1)
    expect(modeEvents[0].mode).to.equal('assisted')
    expect(modeEvents[0].heuristic).to.be.greaterThanOrEqual(0.3)

    // Subsequent sandbox exec sees harness namespace. The session
    // used by ensureHarnessReady had loadHarness called internally,
    // so that session's sandbox has the harness module loaded.
    const execAfter = await stack.sandboxService.executeCode(
      `typeof harness !== 'undefined' && typeof harness.curate === 'function'`,
      sessionId,
    )
    expect(execAfter.returnValue).to.equal(true)
  })
})
