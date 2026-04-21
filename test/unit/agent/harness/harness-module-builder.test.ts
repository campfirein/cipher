import {expect} from 'chai'

import type {
  HarnessContext,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/index.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'

function makeVersion(code: string, overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code,
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.3,
    id: 'v-default',
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

function makeCtx(overrides: Partial<HarnessContext> = {}): HarnessContext {
  return {
    abort: new AbortController().signal,
    env: {commandType: 'curate', projectType: 'typescript', workingDirectory: '/'},
    tools: {
      curate: (async () => ({})) as unknown as HarnessContext['tools']['curate'],
      readFile: (async () => ({})) as unknown as HarnessContext['tools']['readFile'],
    },
    ...overrides,
  }
}

// Well-formed pass-through template code — shape mirrors what Phase 4
// Task 4.3 will ship (CommonJS `exports.foo = ...`).
const PASSTHROUGH_CURATE = `
exports.meta = function meta() {
  return {
    capabilities: ['curate'],
    commandType: 'curate',
    projectPatterns: [],
    version: 1,
  }
}
exports.curate = async function curate(ctx) {
  return {ok: true, cmd: ctx.env.commandType}
}
`

describe('HarnessModuleBuilder', () => {
  let builder: HarnessModuleBuilder

  beforeEach(() => {
    builder = new HarnessModuleBuilder(new NoOpLogger())
  })

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('valid template returns {loaded: true} with callable meta()', () => {
    const result = builder.build(makeVersion(PASSTHROUGH_CURATE))
    expect(result.loaded).to.equal(true)
    if (!result.loaded) return
    expect(typeof result.module.meta).to.equal('function')
  })

  it('module.meta() returns the validated HarnessMeta', () => {
    const result = builder.build(makeVersion(PASSTHROUGH_CURATE))
    if (!result.loaded) throw new Error('expected loaded')
    const meta = result.module.meta()
    expect(meta.capabilities).to.deep.equal(['curate'])
    expect(meta.commandType).to.equal('curate')
    expect(meta.version).to.equal(1)
  })

  it('module.curate(ctx) returns the template result', async () => {
    const result = builder.build(makeVersion(PASSTHROUGH_CURATE))
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate to be exported')
    const out = await curate(makeCtx())
    expect(out).to.deep.equal({cmd: 'curate', ok: true})
  })

  it('curate-only template has module.query === undefined', () => {
    const result = builder.build(makeVersion(PASSTHROUGH_CURATE))
    if (!result.loaded) throw new Error('expected loaded')
    expect(result.module.query).to.equal(undefined)
  })

  it('template exporting both curate+query produces both wrappers that route through the VM', async () => {
    // Symmetry check with the curate path — same wrapInvocation
    // machinery applies to query. The pass-through invokes a
    // different branch inside the function body so we can confirm the
    // right script ran.
    const code = `
      exports.meta = function meta() {
        return {
          capabilities: ['curate'],
          commandType: 'curate',
          projectPatterns: [],
          version: 1,
        }
      }
      exports.curate = async function curate(ctx) { return {fn: 'curate'} }
      exports.query  = async function query(ctx)  { return {fn: 'query'}  }
    `
    const result = builder.build(makeVersion(code))
    if (!result.loaded) throw new Error('expected loaded')
    const {curate, query} = result.module
    if (!curate || !query) throw new Error('expected both curate and query')
    expect(await curate(makeCtx())).to.deep.equal({fn: 'curate'})
    expect(await query(makeCtx())).to.deep.equal({fn: 'query'})
  })

  it('module.meta() caches — subsequent calls return the same reference', () => {
    // Proof-by-identity that the VM function is called exactly once at
    // build(). Re-invoking the VM for every meta() call would produce
    // a structurally-equal but non-identical object per call.
    const result = builder.build(makeVersion(PASSTHROUGH_CURATE))
    if (!result.loaded) throw new Error('expected loaded')
    const first = result.module.meta()
    const second = result.module.meta()
    expect(first).to.equal(second)
  })

  // ── Error categorization ─────────────────────────────────────────────────

  it('syntax error → {loaded: false, reason: syntax}', () => {
    const result = builder.build(makeVersion('exports.meta = function {{ broken'))
    expect(result).to.deep.equal({loaded: false, reason: 'syntax'})
  })

  it('missing meta export → {loaded: false, reason: syntax}', () => {
    const result = builder.build(
      makeVersion(`exports.curate = async function curate(ctx) { return {} }`),
    )
    expect(result).to.deep.equal({loaded: false, reason: 'syntax'})
  })

  it('meta() throws → {loaded: false, reason: meta-threw}', () => {
    const result = builder.build(
      makeVersion(`exports.meta = function meta() { throw new Error('bad meta') }`),
    )
    expect(result).to.deep.equal({loaded: false, reason: 'meta-threw'})
  })

  it('meta() returns null → {loaded: false, reason: meta-invalid}', () => {
    const result = builder.build(
      makeVersion(`exports.meta = function meta() { return null }`),
    )
    expect(result).to.deep.equal({loaded: false, reason: 'meta-invalid'})
  })

  it('meta() returns object missing commandType → {loaded: false, reason: meta-invalid}', () => {
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: [], projectPatterns: [], version: 1} }`,
      ),
    )
    expect(result).to.deep.equal({loaded: false, reason: 'meta-invalid'})
  })

  // ── Timeout ──────────────────────────────────────────────────────────────

  it('meta() infinite loop → {loaded: false, reason: meta-threw}', () => {
    // vm.Script timeout surfaces as a thrown `Error: Script execution
    // timed out` during the meta() invocation, which the builder
    // categorizes as `meta-threw`.
    const result = builder.build(
      makeVersion(`exports.meta = function meta() { while(true){} }`),
    )
    expect(result).to.deep.equal({loaded: false, reason: 'meta-threw'})
  }).timeout(8000)

  it('curate() infinite loop → wrapper throws; module stays loaded', async () => {
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1} }
         exports.curate = function curate(ctx) { while(true){} }`,
      ),
    )
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate')

    try {
      await curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.match(/curate\(\) failed/)
    }
  }).timeout(8000)

  it('curate() never-resolving Promise → Promise.race timer throws at 5s', async () => {
    // Covers the async-hang path: the function returns a Promise that
    // never resolves, so V8's vm timeout can't catch it (sync returned
    // quickly). The JS-level Promise.race timer is what fires.
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1} }
         exports.curate = function curate(ctx) { return new Promise(function(){}) }`,
      ),
    )
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate')

    try {
      await curate(makeCtx())
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.match(/curate\(\) failed/)
      expect((error as Error).message).to.match(/exceeded/)
    }
  }).timeout(8000)

  // ── Context freezing ─────────────────────────────────────────────────────

  it('curate(ctx) cannot mutate ctx at runtime (Object.freeze boundary)', async () => {
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1} }
         exports.curate = async function curate(ctx) {
           ctx.env = {commandType: 'chat', projectType: 'generic', workingDirectory: '/hacked'}
           return 'ok'
         }`,
      ),
    )
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate')

    // Strict-mode assignment to a frozen property throws TypeError.
    try {
      await curate(makeCtx())
      expect.fail('expected throw — ctx should be frozen')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }
  })

  it('curate(ctx) cannot mutate nested ctx.env properties (deep freeze)', async () => {
    // Shallow Object.freeze on ctx alone would leave ctx.env mutable —
    // a harness could silently rewrite env.commandType or env.workingDirectory.
    // The deep-freeze at the invocation boundary is what closes this gap.
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1} }
         exports.curate = async function curate(ctx) {
           ctx.env.commandType = 'hacked'
           return 'ok'
         }`,
      ),
    )
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate')

    try {
      await curate(makeCtx())
      expect.fail('expected throw — ctx.env should be deep-frozen')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }
  })

  it('curate(ctx) cannot replace ctx.tools members (deep freeze)', async () => {
    // Same concern as ctx.env, but for the tool surface — a harness
    // rebinding `ctx.tools.curate = evilFn` would hijack subsequent
    // pass-through templates that call `ctx.tools.curate(...)`.
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1} }
         exports.curate = async function curate(ctx) {
           ctx.tools.curate = function() { return 'hijacked' }
           return 'ok'
         }`,
      ),
    )
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate')

    try {
      await curate(makeCtx())
      expect.fail('expected throw — ctx.tools should be deep-frozen')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }
  })

  it('curate(ctx) cannot add properties to ctx at runtime', async () => {
    const result = builder.build(
      makeVersion(
        `exports.meta = function meta() { return {capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1} }
         exports.curate = async function curate(ctx) {
           ctx.injected = 'leaked'
           return 'ok'
         }`,
      ),
    )
    if (!result.loaded) throw new Error('expected loaded')
    const {curate} = result.module
    if (!curate) throw new Error('expected curate')

    try {
      await curate(makeCtx())
      expect.fail('expected throw — ctx should be frozen')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }
  })
})
