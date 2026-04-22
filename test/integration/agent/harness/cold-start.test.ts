/**
 * Integration test — Phase 4 cold-start flow.
 *
 * Exercises Phase 3 + Phase 4 end to end with real components: fresh
 * tmpdir → bootstrap fires → v1 lands in store → Phase 3 loader injects
 * `harness.curate` → `executeCode` runs → outcome recorded by the
 * recorder. Four scenarios:
 *
 *   1. First code_exec in a fresh TypeScript project.
 *   2. 100 parallel bootstrapIfNeeded on the same pair → exactly one v1.
 *   3. Polyglot project (tsconfig + pyproject) → generic + warn-once.
 *   4. `config.language: 'typescript'` override beats a python-only repo.
 *
 * No stubs of harness internals: real `HarnessModuleBuilder`, real
 * `HarnessStore` (`FileKeyStorage({inMemory: true})`), real
 * `HarnessBootstrap`, real `SandboxService`. Only `ILogger` is stubbed
 * in scenario 3 so warn messages can be inspected.
 */

import {expect} from 'chai'
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {EnvironmentContext} from '../../../../src/agent/core/domain/environment/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {FileSystemService} from '../../../../src/agent/infra/file-system/file-system-service.js'
import {_clearPolyglotWarningState} from '../../../../src/agent/infra/harness/detect-and-pick-template.js'
import {
  HarnessBootstrap,
  HarnessModuleBuilder,
  HarnessOutcomeRecorder,
  HarnessStore,
} from '../../../../src/agent/infra/harness/index.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

const SESSION_ID = 'sess-1'

// `FileKeyStorage` rejects path separators in key segments, so `projectId`
// must be a slug. In production the recorder derives projectId from
// `environmentContext.workingDirectory` — that path-to-key incompatibility
// is a known gap tracked in outcome-collection.test.ts:32. For this test,
// we set `workingDirectory = PROJECT_ID` (slug) on the EnvironmentContext
// so recorder writes and bootstrap writes land in the same partition, and
// pass the real tempDir as the DETECTION workingDirectory to
// `bootstrap.bootstrapIfNeeded`. Once the slug/path gap is resolved, both
// can unify on the real path.
const PROJECT_ID = 'cold-start-test'

function makeHarnessConfig(overrides?: Partial<ValidatedHarnessConfig>): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

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

function makeSpyLogger(sb: SinonSandbox): ILogger & {
  debug: SinonStub
  error: SinonStub
  info: SinonStub
  warn: SinonStub
} {
  return {
    debug: sb.stub(),
    error: sb.stub(),
    info: sb.stub(),
    warn: sb.stub(),
  }
}

/**
 * Wires the same component graph `service-initializer.ts` builds for
 * the harness subsystem: FileSystemService → HarnessStore → builder →
 * bootstrap → recorder → SandboxService. Real components throughout.
 */
async function createColdStartStack(
  projectId: string,
  detectionCwd: string,
  config: ValidatedHarnessConfig,
  logger: ILogger,
): Promise<{
  bootstrap: HarnessBootstrap
  fileSystem: FileSystemService
  harnessStore: HarnessStore
  sandboxService: SandboxService
}> {
  const fileSystem = new FileSystemService({
    allowedPaths: [detectionCwd],
    workingDirectory: detectionCwd,
  })
  await fileSystem.initialize()

  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()

  const harnessStore = new HarnessStore(keyStorage, logger)
  const builder = new HarnessModuleBuilder(logger)
  const bootstrap = new HarnessBootstrap(harnessStore, fileSystem, config, logger)

  const sandboxService = new SandboxService()
  sandboxService.setHarnessConfig(config)
  // EnvironmentContext.workingDirectory feeds `projectId` into the recorder
  // (sandbox-service.ts:222). Use the slug so store keys are valid; the
  // real tempDir stays on FileSystemService for detection.
  sandboxService.setEnvironmentContext(makeEnvironmentContext(projectId))
  sandboxService.setHarnessStore(harnessStore)
  sandboxService.setHarnessModuleBuilder(builder)
  sandboxService.setFileSystem(fileSystem)

  const recorder = new HarnessOutcomeRecorder(
    harnessStore,
    new SessionEventBus(),
    logger,
    config,
  )
  sandboxService.setHarnessOutcomeRecorder(recorder, logger)

  return {bootstrap, fileSystem, harnessStore, sandboxService}
}

describe('AutoHarness V2 — cold-start integration (Phase 3 + Phase 4)', function () {
  this.timeout(15_000)

  let tempDir: string
  let sb: SinonSandbox
  let activeSandboxService: SandboxService | undefined

  beforeEach(() => {
    // `realpathSync` unwraps macOS `/var` → `/private/var` symlink so path
    // comparisons (e.g. warn-once keying on workingDirectory) stay stable.
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-cold-start-')))
    sb = createSandbox()
    activeSandboxService = undefined
    _clearPolyglotWarningState()
  })

  afterEach(async () => {
    // Mirror service-initializer's shutdown contract: clears session state
    // and stops any background timers in the recorder. Benign for the
    // current recorder but guards against future changes that hold live
    // resources.
    if (activeSandboxService !== undefined) {
      await activeSandboxService.cleanup()
    }

    sb.restore()
    rmSync(tempDir, {force: true, recursive: true})
  })

  // ── Scenario 1: fresh TS project — full cold-start flow ──────────────────

  it('1. fresh TypeScript project: bootstrap → loadHarness → executeCode → outcome recorded', async () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}')

    const {bootstrap, harnessStore, sandboxService} = await createColdStartStack(
      PROJECT_ID,
      tempDir,
      makeHarnessConfig(),
      new NoOpLogger(),
    )
    activeSandboxService = sandboxService

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', tempDir)

    // v1 landed
    const v1 = await harnessStore.getLatest(PROJECT_ID, 'curate')
    expect(v1, 'bootstrap must have written v1').to.not.equal(undefined)
    if (v1 === undefined) throw new Error('unreachable: chai asserted above')
    expect(v1.projectType).to.equal('typescript')
    expect(v1.version).to.equal(1)
    // The typescript curate template declares the ts-specific patterns;
    // the generic template uses ['**/*']. This check discriminates.
    expect(v1.metadata.projectPatterns).to.include('tsconfig.json')

    // Phase 3 loader sees the newly-written v1
    const loadResult = await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, 'curate')
    expect(loadResult.loaded).to.equal(true)

    // executeCode runs against the injected harness namespace
    const exec = await sandboxService.executeCode(
      `typeof harness !== 'undefined' && typeof harness.curate === 'function'`,
      SESSION_ID,
      {commandType: 'curate', taskDescription: 'cold-start-smoke'},
    )
    expect(exec.returnValue).to.equal(true)

    // The recorder is fire-and-forget — poll until the outcome lands
    // rather than a flat sleep, so the test stays fast when the write
    // completes in <50ms but doesn't false-negative on slow CI.
    const deadline = Date.now() + 2000
    let outcomes = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 10)
    while (outcomes.length === 0 && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => {
        setTimeout(r, 50)
      })
      // eslint-disable-next-line no-await-in-loop
      outcomes = await harnessStore.listOutcomes(PROJECT_ID, 'curate', 10)
    }

    expect(outcomes.length).to.be.greaterThan(0)
  })

  // ── Scenario 2: idempotent bootstrap under 100-way concurrency ───────────

  it('2. 100 parallel bootstrapIfNeeded on same pair → exactly 1 v1', async () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}')

    const {bootstrap, harnessStore, sandboxService} = await createColdStartStack(
      PROJECT_ID,
      tempDir,
      makeHarnessConfig(),
      new NoOpLogger(),
    )
    activeSandboxService = sandboxService

    const calls: Array<Promise<void>> = []
    for (let i = 0; i < 100; i++) {
      calls.push(bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', tempDir))
    }

    await Promise.all(calls)

    const versions = await harnessStore.listVersions(PROJECT_ID, 'curate')
    expect(versions.length).to.equal(1)
    const [only] = versions
    if (only === undefined) throw new Error('unreachable: length asserted above')
    expect(only.version).to.equal(1)
  })

  // ── Scenario 3: polyglot → generic + warn-once ───────────────────────────

  it('3. polyglot repo: projectType=generic + warn-once with both types listed', async () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}')
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname="x"\n')

    const spyLogger = makeSpyLogger(sb)
    const {bootstrap, harnessStore, sandboxService} = await createColdStartStack(
      PROJECT_ID,
      tempDir,
      makeHarnessConfig(),
      spyLogger,
    )
    activeSandboxService = sandboxService

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', tempDir)

    const v1 = await harnessStore.getLatest(PROJECT_ID, 'curate')
    expect(v1, 'bootstrap must have written v1').to.not.equal(undefined)
    if (v1 === undefined) throw new Error('unreachable: chai asserted above')
    expect(v1.projectType).to.equal('generic')

    // Warn fired exactly once with types listed + override path.
    const polyglotWarnCalls = spyLogger.warn.getCalls().filter((call) => {
      const [msg] = call.args
      return typeof msg === 'string' && /polyglot/i.test(msg)
    })
    expect(polyglotWarnCalls.length).to.equal(1)
    const rawMsg = polyglotWarnCalls[0].args[0]
    if (typeof rawMsg !== 'string') {
      throw new TypeError('expected warn message to be a string')
    }

    expect(rawMsg).to.include('typescript')
    expect(rawMsg).to.include('python')
    expect(rawMsg).to.include('config.harness.language')

    // Warn-once: second call on the same path should NOT re-warn.
    // Use a fresh bootstrap call but note that `getLatest` now returns v1
    // (idempotence short-circuits before reaching detection), so we need
    // to exercise detection directly. The warn-once invariant is
    // orthogonally tested in the Task 4.4 unit tests; here we confirm
    // that ONE bootstrap call produces ONE warn, not multiple.
  })

  // ── Scenario 4: `config.language` override beats python-only detection ───

  it('4. config.language=typescript beats python-only project detection', async () => {
    // Fixture has ONLY pyproject.toml — detector would return ['python'].
    // If the override is broken and detection runs, v1.projectType would
    // be 'python'. The typescript value below proves override precedence.
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname="x"\n')

    const {bootstrap, harnessStore, sandboxService} = await createColdStartStack(
      PROJECT_ID,
      tempDir,
      makeHarnessConfig({language: 'typescript'}),
      new NoOpLogger(),
    )
    activeSandboxService = sandboxService

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', tempDir)

    const v1 = await harnessStore.getLatest(PROJECT_ID, 'curate')
    expect(v1, 'bootstrap must have written v1').to.not.equal(undefined)
    if (v1 === undefined) throw new Error('unreachable: chai asserted above')
    expect(v1.projectType).to.equal('typescript')
  })
})
