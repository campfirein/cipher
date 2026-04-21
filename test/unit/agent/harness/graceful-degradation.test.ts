/**
 * AutoHarness V2 — Phase 3 Task 3.4 graceful-degradation tests.
 *
 * Closes brutal-review item A4: the seven enumerated harness-failure
 * cases that must all degrade to "continue with raw `tools.*`" or
 * "surface a clean per-invocation error" instead of crashing the
 * sandbox or leaving a partial harness state.
 *
 * Each test wires a real `SandboxService` + real `HarnessStore` +
 * real `HarnessModuleBuilder` end-to-end, seeds a fixture harness
 * version, calls `loadHarness`, then asserts the degradation shape.
 * Three invariants per scenario:
 *
 *   1. `loadHarness` returns a typed `HarnessLoadResult` — either
 *      `{loaded: false, reason}` for build-time failures or
 *      `{loaded: true}` for templates that load successfully but
 *      misbehave per-invocation.
 *   2. For build-time failures, `harness.*` is NOT in the sandbox
 *      context. For per-invocation failures, the harness IS loaded
 *      but calling it throws (or resolves to `undefined` for the one
 *      legitimate-undefined case) without corrupting the sandbox.
 *   3. The sandbox continues to execute unrelated code correctly
 *      after the harness has misbehaved — verified by evaluating
 *      a plain JS expression that touches neither harness nor
 *      tools.
 *
 * Tests that exercise the 5-second vm / Promise.race timeout each
 * wait ~5s; total test-file runtime ≈ 15-20s.
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {
  HarnessContext,
  HarnessLoadResult,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

// Valid meta block used by per-invocation failure fixtures — `meta`
// must parse cleanly so the module builder reaches the curate wrapper.
const VALID_META = `
  exports.meta = function meta() {
    return {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    }
  }
`

function makeVersion(code: string): HarnessVersion {
  return {
    code,
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
  }
}

function makeCtx(): HarnessContext {
  return {
    abort: new AbortController().signal,
    env: {commandType: 'curate', projectType: 'typescript', workingDirectory: '/'},
    tools: {
      // Stubs — none of the 7 tested failure scenarios invoke
      // `ctx.tools.*` through the harness. A future scenario that
      // exercises a successful tool call should replace these with
      // properly-typed fixtures.
      curate: (async () => ({})) as unknown as HarnessContext['tools']['curate'],
      readFile: (async () => ({})) as unknown as HarnessContext['tools']['readFile'],
    },
  }
}

function makeEnabledConfig(): ValidatedHarnessConfig {
  return {autoLearn: true, enabled: true, language: 'typescript', maxVersions: 20}
}

function makeStubFileSystem(sb: SinonSandbox): IFileSystem {
  // `as unknown as IFileSystem` matches the pattern used by the
  // existing sandbox test files — the `IFileSystem` surface is wider
  // than what these tests need, and none of the 7 degradation
  // scenarios invoke file-system methods through the sandbox. If a
  // future scenario does, the missing stub will fail at runtime with
  // a clear "is not a function" — acceptable because these tests are
  // the failure-invariant harness, not the sandbox-behavior one.
  return {
    editFile: sb.stub().resolves({bytesWritten: 0, path: '/'}),
    globFiles: sb.stub().resolves({files: [], totalFound: 0, truncated: false}),
    initialize: sb.stub(),
    listDirectory: sb.stub().resolves({files: [], tree: '', truncated: false}),
    readFile: sb.stub().resolves({content: '', exists: true, path: '/'}),
    searchContent: sb.stub().resolves({matches: [], totalMatches: 0, truncated: false}),
    writeFile: sb.stub().resolves({bytesWritten: 0, path: '/'}),
  } as unknown as IFileSystem
}

describe('graceful degradation — brutal-review A4', () => {
  let sb: SinonSandbox
  let service: SandboxService
  let store: HarnessStore

  beforeEach(async () => {
    sb = createSandbox()
    const keyStorage = new FileKeyStorage({inMemory: true})
    await keyStorage.initialize()
    store = new HarnessStore(keyStorage, new NoOpLogger())
    const builder = new HarnessModuleBuilder(new NoOpLogger())

    service = new SandboxService()
    service.setHarnessConfig(makeEnabledConfig())
    service.setHarnessStore(store)
    service.setHarnessModuleBuilder(builder)
    service.setFileSystem(makeStubFileSystem(sb))
  })

  afterEach(() => {
    sb.restore()
  })

  async function seedAndLoad(code: string): Promise<HarnessLoadResult> {
    await store.saveVersion(makeVersion(code))
    return service.loadHarness('s1', 'p', 'curate')
  }

  /**
   * Proves the sandbox is healthy after a harness failure by
   * executing a plain JS expression that touches neither harness
   * nor tools. If the harness failure somehow corrupted sandbox
   * state, this assertion surfaces it.
   */
  async function expectSandboxHealthy(): Promise<void> {
    const result = await service.executeCode('2 + 2', 's1')
    expect(result.returnValue).to.equal(4)
  }

  // ── Build-time failures (harness NOT loaded) ──────────────────────────────

  it('1. Syntax error at module load → {loaded:false, reason:syntax}', async () => {
    const result = await seedAndLoad('function {{ invalid syntax')
    expect(result).to.deep.equal({loaded: false, reason: 'syntax'})

    const hasHarness = await service.executeCode(`typeof harness !== 'undefined'`, 's1')
    expect(hasHarness.returnValue).to.equal(
      false,
      'harness namespace must not be injected on build-time failure',
    )
    await expectSandboxHealthy()
  })

  it('2. Throw in meta() → {loaded:false, reason:meta-threw}', async () => {
    const code = `exports.meta = function meta() { throw new Error('bad meta') }`
    const result = await seedAndLoad(code)
    expect(result).to.deep.equal({loaded: false, reason: 'meta-threw'})

    const hasHarness = await service.executeCode(`typeof harness !== 'undefined'`, 's1')
    expect(hasHarness.returnValue).to.equal(
      false,
      'harness namespace must not be injected on build-time failure',
    )
    await expectSandboxHealthy()
  })

  // ── Per-invocation failures (harness loaded; per-call wrapper throws) ────

  it('3. Throw in curate() → wrapper throws; module stays loaded', async () => {
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) { throw new Error('user error') }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    try {
      await result.module.curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect((error as Error).message).to.match(/curate\(\) failed/)
    }

    await expectSandboxHealthy()
  })

  it('4. Infinite loop in curate() → vm timeout; wrapper throws', async () => {
    const code = `${VALID_META}
      exports.curate = function curate(ctx) { while(true){} }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    try {
      await result.module.curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect((error as Error).message).to.match(/curate\(\) failed/)
    }

    await expectSandboxHealthy()
  }).timeout(8000)

  it('5. Infinite recursion in curate() → stack overflow; wrapper throws', async () => {
    const code = `${VALID_META}
      function go() { go() }
      exports.curate = function curate(ctx) { go() }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    try {
      await result.module.curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect((error as Error).message).to.match(/curate\(\) failed/)
    }

    await expectSandboxHealthy()
  })

  // ── Legitimate non-failure: returns undefined ────────────────────────────

  it('6. Returns undefined from curate() → resolves to undefined (not a failure)', async () => {
    // A template can legally return undefined. The caller (LLM-written
    // sandbox code) is responsible for handling that. Test pins this
    // as a non-warning case so a future "warn on undefined returns"
    // drift would break here.
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) { return undefined }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return

    if (result.module.curate === undefined) throw new Error('fixture must export curate')
    const out = await result.module.curate(makeCtx())
    expect(out).to.equal(undefined)

    await expectSandboxHealthy()
  })

  it('7. Never-resolving Promise from curate() → Promise.race timer throws', async () => {
    const code = `${VALID_META}
      exports.curate = function curate(ctx) { return new Promise(function(){}) }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    try {
      await result.module.curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect((error as Error).message).to.match(/curate\(\) failed/)
      expect((error as Error).message).to.match(/exceeded/)
    }

    await expectSandboxHealthy()
  }).timeout(8000)
})
