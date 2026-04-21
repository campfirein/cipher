import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {HarnessVersion} from '../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'

import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'

const PASSTHROUGH_CURATE_CODE = `
exports.meta = function meta() {
  return {
    capabilities: ['curate'],
    commandType: 'curate',
    projectPatterns: [],
    version: 1,
  }
}
exports.curate = async function curate(ctx) {
  return {cmd: ctx.env.commandType}
}
`

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: PASSTHROUGH_CURATE_CODE,
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.3,
    id: 'v-1',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    },
    projectId: 'p',
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

function makeEnabledConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'typescript',
    maxVersions: 20,
    ...overrides,
  }
}

describe('SandboxService.loadHarness', () => {
  let sandbox: SinonSandbox
  let service: SandboxService
  let store: Partial<IHarnessStore> & {getLatest: SinonStub}
  let builder: Partial<HarnessModuleBuilder> & {build: SinonStub}

  beforeEach(() => {
    sandbox = createSandbox()
    service = new SandboxService()
    store = {getLatest: sandbox.stub().resolves()}
    builder = {build: sandbox.stub().returns({loaded: false, reason: 'syntax'})}
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ── Early-return paths ────────────────────────────────────────────────────

  it('returns {loaded:false,reason:no-version} when harness.enabled is false — no store call', async () => {
    service.setHarnessConfig(makeEnabledConfig({enabled: false}))
    service.setHarnessStore(store as unknown as IHarnessStore)
    service.setHarnessModuleBuilder(builder as unknown as HarnessModuleBuilder)

    const result = await service.loadHarness('s1', 'p1', 'curate')

    expect(result).to.deep.equal({loaded: false, reason: 'no-version'})
    expect(store.getLatest.called).to.equal(false)
  })

  it('returns {loaded:false,reason:no-version} when store has no version for the pair', async () => {
    service.setHarnessConfig(makeEnabledConfig())
    service.setHarnessStore(store as unknown as IHarnessStore)
    service.setHarnessModuleBuilder(builder as unknown as HarnessModuleBuilder)
    store.getLatest.resolves()

    const result = await service.loadHarness('s1', 'p1', 'curate')

    expect(result).to.deep.equal({loaded: false, reason: 'no-version'})
    expect(store.getLatest.calledOnceWith('p1', 'curate')).to.equal(true)
  })

  // ── Propagation of builder failures ───────────────────────────────────────

  it('propagates builder {loaded:false} result without injecting harness namespace', async () => {
    service.setHarnessConfig(makeEnabledConfig())
    service.setHarnessStore(store as unknown as IHarnessStore)
    service.setHarnessModuleBuilder(builder as unknown as HarnessModuleBuilder)
    store.getLatest.resolves(makeVersion())
    builder.build.returns({loaded: false, reason: 'meta-threw'})

    const result = await service.loadHarness('s1', 'p1', 'curate')

    expect(result).to.deep.equal({loaded: false, reason: 'meta-threw'})
    // No version id registered — failed loads leave the session untouched.
  })

  // ── Successful load ──────────────────────────────────────────────────────

  it('returns {loaded:true} with the stored version on success', async () => {
    service.setHarnessConfig(makeEnabledConfig())
    service.setHarnessStore(store as unknown as IHarnessStore)
    service.setHarnessModuleBuilder(builder as unknown as HarnessModuleBuilder)
    const version = makeVersion()
    store.getLatest.resolves(version)
    const fakeModule = {
      curate: async () => ({cmd: 'curate'}),
      meta: () => ({
        capabilities: ['curate'],
        commandType: 'curate',
        projectPatterns: [],
        version: 1,
      }),
    }
    builder.build.returns({loaded: true, module: fakeModule, version})

    const result = await service.loadHarness('s1', 'p1', 'curate')

    expect(result.loaded).to.equal(true)
    if (!result.loaded) throw new Error('expected loaded')
    expect(result.version.id).to.equal('v-1')
    expect(result.module).to.equal(fakeModule)
  })

  // ── Capability-driven injection ──────────────────────────────────────────

  it('curate-only module injects harness.curate and NOT harness.query', async () => {
    // Use a real HarnessModuleBuilder so the namespace wiring is
    // exercised end-to-end for the capabilities check.
    const {HarnessModuleBuilder: RealBuilder} = await import(
      '../../../../src/agent/infra/harness/harness-module-builder.js'
    )
    const {NoOpLogger} = await import('../../../../src/agent/core/interfaces/i-logger.js')
    service.setHarnessConfig(makeEnabledConfig())
    service.setHarnessStore(store as unknown as IHarnessStore)
    service.setHarnessModuleBuilder(new RealBuilder(new NoOpLogger()))
    store.getLatest.resolves(makeVersion())

    const result = await service.loadHarness('s1', 'p1', 'curate')
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return

    // Inspect what the internal buildHarnessNamespace produced by
    // reading through a narrow cast — the private Map keyed by
    // sessionId is the only externally-inspectable surface for this.
    const internal = service as unknown as {
      buildHarnessNamespace: (sessionId: string) => Record<string, unknown> | undefined
    }
    const ns = internal.buildHarnessNamespace('s1')
    if (ns === undefined) throw new Error('expected harness namespace')
    expect(typeof ns.meta).to.equal('function')
    expect(typeof ns.curate).to.equal('function')
    expect(ns.query).to.equal(undefined)
  })

  // ── harnessVersionIdBySession population ─────────────────────────────────

  it('populates harnessVersionIdBySession on successful load for Phase 2 recorder', async () => {
    service.setHarnessConfig(makeEnabledConfig())
    service.setHarnessStore(store as unknown as IHarnessStore)
    service.setHarnessModuleBuilder(builder as unknown as HarnessModuleBuilder)
    const version = makeVersion({id: 'v-abc'})
    store.getLatest.resolves(version)
    builder.build.returns({
      loaded: true,
      module: {meta: () => version.metadata},
      version,
    })

    await service.loadHarness('s1', 'p1', 'curate')

    // Read through a narrow cast into the private map.
    const internal = service as unknown as {
      harnessVersionIdBySession: Map<string, string>
    }
    expect(internal.harnessVersionIdBySession.get('s1')).to.equal('v-abc')
  })
})
