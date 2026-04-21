/**
 * AutoHarness V2 — Phase 3 Task 3.5 dual-VM isolation integration test.
 *
 * Closes brutal-review item A3: the five enumerated attack vectors
 * that MUST NOT cross between a harness's `vm.createContext` and the
 * outer Node process. These tests are Phase 3's security proof of
 * work — if any scenario regresses, the harness sandbox is
 * structurally compromised.
 *
 * Each attack is exercised end-to-end against the real pipeline:
 * real `HarnessStore` (in-memory-backed `FileKeyStorage`), real
 * `HarnessModuleBuilder`, real `SandboxService.loadHarness`. The
 * test runs `result.module.curate(ctx)` so the wrapper's deep-freeze
 * + strict-mode + VM timeout apply at every invocation boundary.
 *
 * Invariants per attack:
 *
 *   1. The attempted leak does NOT reach the outer Node scope (or
 *      the test's object-literal prototype, as appropriate).
 *   2. The loader pipeline stays healthy after the attack — a
 *      subsequent `expectSandboxHealthy()` confirms no state
 *      corruption.
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {
  HarnessContext,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

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

// Unique sentinels per attack so cross-test contamination (if any
// security failure leaks) surfaces in the right test, not a random one.
const ATTACK_1_GLOBAL_KEY = '__HARNESS_ISOLATION_TEST_1_LEAK__'
const ATTACK_4_PROTO_KEY = '__harnessIsolationTest4Pollution__'

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
      // Stubs — attacks 2 and 3 reference `ctx.tools` as a capture
      // target, but no attack actually calls a real tool. A future
      // attack that exercises a live tool call should replace these
      // with session-bound fixtures.
      curate: (async () => ({})) as unknown as HarnessContext['tools']['curate'],
      readFile: (async () => ({})) as unknown as HarnessContext['tools']['readFile'],
    },
  }
}

function makeEnabledConfig(): ValidatedHarnessConfig {
  return {autoLearn: true, enabled: true, language: 'typescript', maxVersions: 20}
}

function makeStubFileSystem(sb: SinonSandbox): IFileSystem {
  // Matches the established sandbox-test stub pattern. None of the
  // isolation attacks invoke file-system methods through the sandbox.
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

describe('dual-VM isolation — brutal-review A3', () => {
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
    // Defensive cleanup — if a security failure somehow let the attack
    // succeed, we don't want the pollution bleeding into other tests
    // (or the broader test suite).
    delete (globalThis as Record<string, unknown>)[ATTACK_1_GLOBAL_KEY]
    delete (Object.prototype as Record<string, unknown>)[ATTACK_4_PROTO_KEY]
  })

  async function seedAndLoad(code: string) {
    await store.saveVersion(makeVersion(code))
    return service.loadHarness('s1', 'p', 'curate')
  }

  async function expectSandboxHealthy(): Promise<void> {
    // Prove two things in one check: JS evaluation is intact AND the
    // tools namespace is still wired. The AC for A3 says "subsequent
    // raw tools.* calls still work" — this snapshot captures both
    // properties without needing async-Promise gymnastics inside
    // the sandbox.
    const result = await service.executeCode(
      `({math: 2 + 2, hasTools: typeof tools === 'object' && typeof tools.readFile === 'function'})`,
      's1',
    )
    expect(result.returnValue).to.deep.equal(
      {hasTools: true, math: 4},
      'sandbox must stay healthy after attack: JS + tools namespace intact',
    )
  }

  // ── Attack 1: Global pollution ────────────────────────────────────────────

  it('1. Global pollution: harness `globalThis.X = ...` does NOT reach Node globalThis', async () => {
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) {
        globalThis.${ATTACK_1_GLOBAL_KEY} = 'touched'
        return 'ok'
      }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return // unreachable: Chai assertion above throws first — TypeScript narrowing only
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    await result.module.curate(makeCtx())

    // The harness set `globalThis.<KEY>` inside its own VM context.
    // V8's `vm.createContext({})` gives each context its own
    // globalThis, so Node's globalThis must remain unmodified.
    expect((globalThis as Record<string, unknown>)[ATTACK_1_GLOBAL_KEY]).to.equal(
      undefined,
      'harness global-pollution must not reach Node globalThis',
    )

    await expectSandboxHealthy()
  })

  // ── Attack 2: Closure leak ────────────────────────────────────────────────

  it('2. Closure leak: returned closure cannot mutate captured ctx.tools', async () => {
    // The attack: harness returns a closure that closes over
    // `ctx.tools` and attempts to rebind `stolen.curate = hijackFn`.
    // Deep-freeze at the invocation boundary (HarnessModuleBuilder
    // wrapper) means `stolen` is a frozen object — the mutation
    // throws in strict mode.
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) {
        const stolen = ctx.tools
        return function hijackAttempt() {
          stolen.curate = function() { return 'hijacked' }
          return 'should-not-reach-here'
        }
      }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return // unreachable: Chai assertion above throws first — TypeScript narrowing only
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    const returned = await result.module.curate(makeCtx())
    expect(typeof returned).to.equal('function', 'harness should return the closure')

    // Invoke the closure from outer test scope. Because `stolen`
    // references the frozen `ctx.tools`, the `stolen.curate = ...`
    // assignment throws TypeError synchronously. The return type of
    // `module.curate` is declared as `CurateResult` but the harness
    // intentionally returns a function here — double cast required
    // to cross the declared/actual type boundary.
    //
    // Assertion note: the thrown `TypeError` comes from the VM's
    // realm, not Node's outer realm, so `instanceof TypeError`
    // against Node's class fails (distinct prototypes). Checking
    // `error.name` is realm-agnostic and captures the exact intent:
    // "a TypeError is thrown due to strict-mode frozen-property write."
    try {
      ;(returned as unknown as () => void)()
      expect.fail('expected closure to throw on frozen mutation')
    } catch (error) {
      expect(error).to.be.an('error')
      const err = error as Error
      expect(err.name).to.equal('TypeError')
      expect(err.message).to.match(/read.?only/i)
    }

    await expectSandboxHealthy()
  })

  // ── Attack 3: Mutable parameter / frozen context ─────────────────────────

  it('3. Mutable parameter: harness cannot mutate its own ctx.env', async () => {
    // In our architecture, the user doesn't pass their own object
    // into `harness.curate(state)` — the module receives a
    // deep-frozen HarnessContext built per-invocation. This test
    // verifies mutation attempts on the received ctx fail, which is
    // the architectural analog of "mutable parameter can't be
    // weaponized."
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) {
        ctx.env.commandType = 'hacked'
        return 'ok'
      }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return // unreachable: Chai assertion above throws first — TypeScript narrowing only
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    // What actually reaches this catch is a plain `Error` from the
    // wrapper (`new Error('harness curate() failed: ' + msg)`), NOT a
    // TypeError — the underlying TypeError is caught inside
    // `wrapInvocation` and normalized before the async boundary. The
    // underlying message is preserved in the wrapper's string, so
    // asserting on `/read.?only/i` proves the root cause was a
    // frozen-property write specifically — not just any harness
    // failure that happened to bubble through.
    try {
      await result.module.curate(makeCtx())
      expect.fail('expected wrapped Error — ctx.env is frozen (TypeError inside VM)')
    } catch (error) {
      expect((error as Error).message).to.match(/curate\(\) failed.*read.?only/i)
    }

    await expectSandboxHealthy()
  })

  // ── Attack 4: Prototype pollution ────────────────────────────────────────

  it('4. Prototype pollution: harness `Object.prototype.X = ...` does NOT reach outer Object.prototype', async () => {
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) {
        Object.prototype.${ATTACK_4_PROTO_KEY} = 'polluted'
        return 'ok'
      }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return // unreachable: Chai assertion above throws first — TypeScript narrowing only
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    await result.module.curate(makeCtx())

    // V8 gives each `vm.createContext` its own realm with an
    // independent Object.prototype. Mutations to the harness-side
    // Object.prototype must not cross into Node's.
    expect(({} as Record<string, unknown>)[ATTACK_4_PROTO_KEY]).to.equal(
      undefined,
      'harness prototype-pollution must not reach outer Object.prototype',
    )

    await expectSandboxHealthy()
  })

  // ── Attack 5: Stack-trace escape ─────────────────────────────────────────

  it('5. Stack-trace escape: attached properties on thrown errors do NOT escape the wrapper', async () => {
    // The attack: harness throws an Error with a custom property
    // (e.g. `capturedThis = globalThis`) attached. Without
    // normalization, that property would reach outer `catch` blocks
    // and give user-facing code a handle to the VM's globalThis.
    // The wrapper's `throw new Error('harness curate() failed: ' + msg)`
    // constructs a fresh Error — only the message survives.
    const code = `${VALID_META}
      exports.curate = async function curate(ctx) {
        const err = new Error('boom')
        err.capturedThis = globalThis
        err.capturedArbitrary = { secret: 'do-not-leak' }
        throw err
      }
    `
    const result = await seedAndLoad(code)
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return // unreachable: Chai assertion above throws first — TypeScript narrowing only
    if (result.module.curate === undefined) throw new Error('fixture must export curate')

    try {
      await result.module.curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
      const caught = error as Error & {capturedArbitrary?: unknown; capturedThis?: unknown}
      expect(caught.message).to.match(/curate\(\) failed/)
      expect(caught.capturedThis).to.equal(
        undefined,
        'wrapper must not propagate captured globalThis reference',
      )
      expect(caught.capturedArbitrary).to.equal(
        undefined,
        'wrapper must not propagate arbitrary captured properties',
      )
    }

    await expectSandboxHealthy()
  })
})
