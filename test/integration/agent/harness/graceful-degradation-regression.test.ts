/**
 * Integration regression test for Phase 3 Task 3.4's graceful-
 * degradation invariants, exercised through the full Phase 3 + 4 + 5
 * stack.
 *
 * Phase 3 Task 3.4 proved the invariants at the module-builder
 * layer. This test proves they still hold when the module builder
 * sits under real HarnessStore + real SandboxService + real
 * HarnessOutcomeRecorder — the same composition production uses.
 *
 * Eight scenarios, one per documented failure mode:
 *
 *   Load-time failures (harness NOT loaded; sandbox degrades to
 *   raw `tools.*`):
 *     1. Syntax error in TEMPLATE_CODE
 *     2. `meta()` throws at load
 *     3. `meta()` returns a schema-invalid object
 *
 *   Runtime failures (harness loaded; per-invocation wrapper throws;
 *   session continues):
 *     4. Throw in `curate(ctx)` body
 *     5. Infinite loop in `curate(ctx)` → vm.Script timeout
 *     6. Infinite recursion in `curate(ctx)` → stack overflow
 *     7. Never-resolving Promise from `curate(ctx)` → Promise.race
 *        timer
 *
 *   Legitimate non-failure (not a degradation case but pinned here
 *   so a future change doesn't accidentally classify it as one):
 *     8. `curate(ctx)` resolves to `undefined`
 *
 * For each case, the sandbox MUST:
 *   - continue executing unrelated plain-JS code after the harness
 *     misbehaves
 *   - not crash, not corrupt session state
 *   - (runtime failures only) record an outcome so the heuristic
 *     learns from the failure
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {EnvironmentContext} from '../../../../src/agent/core/domain/environment/types.js'
import type {HarnessVersion} from '../../../../src/agent/core/domain/harness/types.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'
import {HarnessOutcomeRecorder} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

// Slug projectId to side-step the FileKeyStorage slug/path gap (same
// workaround used by outcome-collection.test.ts and cold-start.test.ts).
const PROJECT_ID = 'degradation-test-project'
const SESSION_ID = 'degradation-sess-1'

// Valid meta block — template used as a prefix when only the curate()
// body should fail (scenarios 4-8). `meta()` must parse cleanly so the
// module builder reaches the curate wrapper.
const VALID_META = `
  exports.meta = function() {
    return {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    }
  }
`

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

function makeConfig(): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'generic',
    maxVersions: 20,
  }
}

function makeVersion(code: string, id: string = 'v-degradation'): HarnessVersion {
  return {
    code,
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.3,
    id,
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: PROJECT_ID,
    projectType: 'generic',
    version: 1,
  }
}

interface Stack {
  readonly harnessStore: HarnessStore
  readonly sandboxService: SandboxService
}

/** Wires the same component graph `service-initializer.ts` builds. */
async function buildStack(): Promise<Stack> {
  const logger = new NoOpLogger()
  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  const harnessStore = new HarnessStore(keyStorage, logger)
  const config = makeConfig()
  const sessionEventBus = new SessionEventBus()
  const recorder = new HarnessOutcomeRecorder(
    harnessStore,
    sessionEventBus,
    logger,
    config,
  )
  const builder = new HarnessModuleBuilder(logger)

  const sandboxService = new SandboxService()
  sandboxService.setHarnessConfig(config)
  sandboxService.setEnvironmentContext(makeEnvironmentContext(PROJECT_ID))
  sandboxService.setHarnessStore(harnessStore)
  sandboxService.setHarnessModuleBuilder(builder)
  sandboxService.setHarnessOutcomeRecorder(recorder, logger)

  return {harnessStore, sandboxService}
}

/**
 * Run unrelated plain-JS code in the sandbox. Used after each failure
 * scenario to prove the session didn't get corrupted — if `2 + 2`
 * stops equaling `4`, the sandbox state is broken.
 */
async function expectSandboxHealthy(sandboxService: SandboxService): Promise<void> {
  const result = await sandboxService.executeCode('2 + 2', SESSION_ID)
  expect(result.returnValue, 'sandbox must still execute plain JS after harness failure').to.equal(4)
}

/** Poll the outcome store for a recorded entry; cold-start.test.ts pattern. */
async function pollForOutcome(
  harnessStore: HarnessStore,
  timeoutMs: number = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const outcomes = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 10)
    if (outcomes.length > 0) return true
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => {
      setTimeout(r, 50)
    })
  }

  return false
}

describe('AutoHarness V2 — graceful-degradation regression (Phase 3.4 invariants)', function () {
  this.timeout(25_000)

  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  // ── Load-time failures: harness NOT loaded, sandbox degrades ──────────────

  it('1. Syntax error → loadHarness returns {loaded:false, reason:syntax}; sandbox stays healthy', async () => {
    const {harnessStore, sandboxService} = await buildStack()
    await harnessStore.saveVersion(makeVersion('function {{ broken syntax', 'v-syn'))

    const result = await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')
    expect(result).to.deep.equal({loaded: false, reason: 'syntax'})

    await expectSandboxHealthy(sandboxService)
  })

  it('2. meta() throws → {loaded:false, reason:meta-threw}; sandbox stays healthy', async () => {
    const {harnessStore, sandboxService} = await buildStack()
    const code = `exports.meta = function() { throw new Error('bad meta') }`
    await harnessStore.saveVersion(makeVersion(code, 'v-meta-threw'))

    const result = await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')
    expect(result).to.deep.equal({loaded: false, reason: 'meta-threw'})

    await expectSandboxHealthy(sandboxService)
  })

  it('3. meta() returns schema-invalid object → {loaded:false, reason:meta-invalid}; sandbox stays healthy', async () => {
    const {harnessStore, sandboxService} = await buildStack()
    // Missing `capabilities` + wrong `version` type — fails HarnessMetaSchema.
    const code = `
      exports.meta = function() {
        return {commandType: 'curate', projectPatterns: [], version: 'not-a-number'}
      }
    `
    await harnessStore.saveVersion(makeVersion(code, 'v-meta-invalid'))

    const result = await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')
    expect(result).to.deep.equal({loaded: false, reason: 'meta-invalid'})

    await expectSandboxHealthy(sandboxService)
  })

  // ── Runtime failures: loaded; wrapper throws on invocation; session lives ─

  it('4. curate() throws → error surfaces in stderr; outcome recorded; sandbox healthy', async () => {
    const {harnessStore, sandboxService} = await buildStack()
    const code = `${VALID_META}
      exports.curate = async function(ctx) { throw new Error('user code bad') }
    `
    await harnessStore.saveVersion(makeVersion(code, 'v-throws'))

    const loadResult = await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')
    expect(loadResult.loaded).to.equal(true)

    const exec = await sandboxService.executeCode(
      '(async () => harness.curate())().catch((e) => { throw e })',
      SESSION_ID,
      {commandType: 'curate', taskDescription: 'degradation-4'},
    )

    // Phase 3 Task 3.2 normalizes thrown errors — stderr carries the
    // wrapped message rather than a raw stack trace.
    expect(exec.stderr).to.match(/curate\(\) failed/)
    expect(await pollForOutcome(harnessStore)).to.equal(true)
    await expectSandboxHealthy(sandboxService)
  })

  it('5. Infinite loop in curate() → vm.Script timeout; session healthy', async function () {
    this.timeout(8000)
    const {harnessStore, sandboxService} = await buildStack()
    const code = `${VALID_META}
      exports.curate = function(ctx) { while(true){} }
    `
    await harnessStore.saveVersion(makeVersion(code, 'v-loop'))

    await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')

    const exec = await sandboxService.executeCode(
      '(async () => harness.curate())().catch((e) => { throw e })',
      SESSION_ID,
      {commandType: 'curate', taskDescription: 'degradation-5'},
    )
    expect(exec.stderr).to.match(/curate\(\) failed/)
    expect(await pollForOutcome(harnessStore)).to.equal(true)
    await expectSandboxHealthy(sandboxService)
  })

  it('6. Infinite recursion in curate() → stack overflow; session healthy', async () => {
    const {harnessStore, sandboxService} = await buildStack()
    const code = `${VALID_META}
      function go() { go() }
      exports.curate = function(ctx) { go() }
    `
    await harnessStore.saveVersion(makeVersion(code, 'v-recurse'))

    await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')

    const exec = await sandboxService.executeCode(
      '(async () => harness.curate())().catch((e) => { throw e })',
      SESSION_ID,
      {commandType: 'curate', taskDescription: 'degradation-6'},
    )
    expect(exec.stderr).to.match(/curate\(\) failed/)
    expect(await pollForOutcome(harnessStore)).to.equal(true)
    await expectSandboxHealthy(sandboxService)
  })

  it('7. Never-resolving Promise from curate() → Promise.race timer throws; session healthy', async function () {
    this.timeout(8000)
    const {harnessStore, sandboxService} = await buildStack()
    const code = `${VALID_META}
      exports.curate = function(ctx) { return new Promise(function(){}) }
    `
    await harnessStore.saveVersion(makeVersion(code, 'v-hang'))

    await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')

    const exec = await sandboxService.executeCode(
      '(async () => harness.curate())().catch((e) => { throw e })',
      SESSION_ID,
      {commandType: 'curate', taskDescription: 'degradation-7'},
    )
    expect(exec.stderr).to.match(/curate\(\) failed/)
    expect(exec.stderr).to.match(/exceeded/)
    expect(await pollForOutcome(harnessStore)).to.equal(true)
    await expectSandboxHealthy(sandboxService)
  })

  // ── Legitimate non-failure — pin so a future change doesn't flag it ──────

  it('8. curate() returns undefined → resolves cleanly (NOT a degradation case)', async () => {
    const {harnessStore, sandboxService} = await buildStack()
    const code = `${VALID_META}
      exports.curate = async function(ctx) { return undefined }
    `
    await harnessStore.saveVersion(makeVersion(code, 'v-undefined'))

    await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')

    const exec = await sandboxService.executeCode(
      '(async () => harness.curate())()',
      SESSION_ID,
      {commandType: 'curate', taskDescription: 'degradation-8'},
    )
    expect(exec.stderr, 'undefined return must NOT be treated as a failure').to.equal('')
    await expectSandboxHealthy(sandboxService)
  })
})
