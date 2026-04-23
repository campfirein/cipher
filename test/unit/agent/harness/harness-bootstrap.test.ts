import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {HarnessVersion} from '../../../../src/agent/core/domain/harness/types.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {HarnessStoreError} from '../../../../src/agent/core/domain/errors/harness-store-error.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessBootstrap} from '../../../../src/agent/infra/harness/harness-bootstrap.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

const PROJECT_ID = 'p1'
const WORKING_DIRECTORY = '/proj'

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    // Concrete override means detectAndPickTemplate skips detection — keeps
    // the filesystem unused and tests fast. Tests that need a specific
    // project type set it here.
    language: 'generic',
    maxVersions: 20,
    ...overrides,
  }
}

function makeStoreStub(sb: SinonSandbox): {
  readonly getLatest: SinonStub
  readonly saveVersion: SinonStub
  readonly store: IHarnessStore
} {
  const getLatest = sb.stub()
  const saveVersion = sb.stub()
  const store = {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub(),
    deleteScenario: sb.stub(),
    getLatest,
    getPin: sb.stub(),
    getVersion: sb.stub(),
    listOutcomes: sb.stub(),
    listScenarios: sb.stub(),
    listVersions: sb.stub(),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion,
    setPin: sb.stub(),
  } satisfies IHarnessStore

  return {getLatest, saveVersion, store}
}

function makeFileSystemStub(sb: SinonSandbox): IFileSystem {
  return {
    editFile: sb.stub(),
    globFiles: sb.stub(),
    initialize: sb.stub(),
    listDirectory: sb.stub(),
    readFile: sb.stub(),
    searchContent: sb.stub(),
    writeFile: sb.stub(),
  } satisfies IFileSystem
}

function makeLoggerStub(sb: SinonSandbox): ILogger & {
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

describe('HarnessBootstrap', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  // ── Config gating ─────────────────────────────────────────────────────────

  it('1. config.enabled=false → no store call, no detector call', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig({enabled: false}), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    expect(getLatest.callCount).to.equal(0)
    expect(saveVersion.callCount).to.equal(0)
  })

  it('2. existing version → early return, no save', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves({id: 'v-existing'} as HarnessVersion)
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig(), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    expect(getLatest.callCount).to.equal(1)
    expect(saveVersion.callCount).to.equal(0)
  })

  // ── Bootstrap flow ────────────────────────────────────────────────────────

  it('3. no existing version → writes v1 with correct shape', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    saveVersion.resolves()
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig({language: 'generic'}), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    expect(saveVersion.callCount).to.equal(1)
    const [saved] = saveVersion.firstCall.args as [HarnessVersion]
    expect(saved.projectId).to.equal(PROJECT_ID)
    expect(saved.commandType).to.equal('curate')
    expect(saved.projectType).to.equal('generic')
    expect(saved.version).to.equal(1)
    expect(saved.heuristic).to.equal(0.3)
    expect(saved.code).to.be.a('string').and.not.empty
    expect(saved.metadata.commandType).to.equal('curate')
    expect(saved.metadata.version).to.equal(1)
    expect(saved.id).to.match(/^[\da-f-]{36}$/)
    expect(saved.createdAt).to.be.a('number')
  })

  it('4. logs info on successful v1 write', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    saveVersion.resolves()
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig({language: 'typescript'}), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    expect(logger.info.callCount).to.equal(1)
    const [message, context] = logger.info.firstCall.args as [string, Record<string, unknown>]
    expect(message).to.include('v1')
    expect(context.projectId).to.equal(PROJECT_ID)
    expect(context.projectType).to.equal('typescript')
  })

  it('5. unexpected storage error → log error + rethrow', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    const boom = new Error('transport down')
    saveVersion.rejects(boom)
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig(), logger)

    let caught: unknown
    try {
      await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)
    } catch (error) {
      caught = error
    }

    expect(caught).to.equal(boom)
    expect(logger.error.callCount).to.equal(1)
  })

  it('6. VERSION_CONFLICT on save → swallowed + debug log', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    const conflict = HarnessStoreError.versionConflict(PROJECT_ID, 'curate', {version: 1})
    saveVersion.rejects(conflict)
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig(), logger)

    // Must not throw.
    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    expect(logger.debug.callCount).to.be.greaterThanOrEqual(1)
    const hasRaceDebug = logger.debug.getCalls().some((call) => {
      const [msg] = call.args
      return typeof msg === 'string' && msg.includes('lost race')
    })
    expect(hasRaceDebug).to.equal(true)
    expect(logger.error.callCount).to.equal(0)
  })

  // ── Detector-driven project type picks the right template ────────────────

  it('7. projectType=typescript → v1 uses curate/typescript template', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    saveVersion.resolves()
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig({language: 'typescript'}), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    const [saved] = saveVersion.firstCall.args as [HarnessVersion]
    expect(saved.projectType).to.equal('typescript')
    // typescript template declares the ts-specific project patterns.
    expect(saved.metadata.projectPatterns).to.include('tsconfig.json')
  })

  it('8. projectType=generic → v1 uses curate/generic template', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    saveVersion.resolves()
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig({language: 'generic'}), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY)

    const [saved] = saveVersion.firstCall.args as [HarnessVersion]
    expect(saved.projectType).to.equal('generic')
    expect(saved.metadata.projectPatterns).to.deep.equal(['**/*'])
  })

  // ── v1.0 scope narrowing: non-curate commandTypes are graceful no-ops ─────

  it('9. non-curate commandType (query) → no save, debug log', async () => {
    const {getLatest, saveVersion, store} = makeStoreStub(sb)
    const fs = makeFileSystemStub(sb)
    const logger = makeLoggerStub(sb)
    getLatest.resolves()
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig(), logger)

    await bootstrap.bootstrapIfNeeded(PROJECT_ID, 'query', WORKING_DIRECTORY)

    expect(saveVersion.callCount).to.equal(0)
    // Guard fires before getLatest, so the store must not be touched at all
    // for no-op commandTypes. Pinning this catches an accidental reorder.
    expect(getLatest.callCount).to.equal(0)
    const skipDebug = logger.debug.getCalls().some((call) => {
      const [msg] = call.args
      return typeof msg === 'string' && msg.includes('no template for commandType')
    })
    expect(skipDebug).to.equal(true)
  })

  // ── Concurrency / idempotence via real store ──────────────────────────────

  it('10. 100 parallel bootstrapIfNeeded on same pair → exactly 1 v1 in store', async () => {
    // Exercises SINGLE-INSTANCE deduplication: 100 callers share one
    // in-flight promise, only one save lands. Uses real
    // FileKeyStorage({inMemory: true}) + real HarnessStore so the full
    // path runs. Cross-instance races (two HarnessBootstrap instances
    // racing on the same pair) rely on VERSION_CONFLICT swallowing,
    // which test 6 covers.
    const keyStorage = new FileKeyStorage({inMemory: true})
    await keyStorage.initialize()
    const store = new HarnessStore(keyStorage, new NoOpLogger())
    const fs = makeFileSystemStub(sb)
    const logger = new NoOpLogger()
    const bootstrap = new HarnessBootstrap(store, fs, makeConfig({language: 'generic'}), logger)

    const calls: Array<Promise<void>> = []
    for (let i = 0; i < 100; i++) {
      calls.push(bootstrap.bootstrapIfNeeded(PROJECT_ID, 'curate', WORKING_DIRECTORY))
    }

    // None should throw — all losers catch VERSION_CONFLICT.
    await Promise.all(calls)

    const versions = await store.listVersions(PROJECT_ID, 'curate')
    expect(versions.length).to.equal(1)
    expect(versions[0].version).to.equal(1)
  })
})
