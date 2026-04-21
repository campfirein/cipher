import {expect} from 'chai'
import {expectTypeOf} from 'expect-type'

import type {
  HarnessContext,
  HarnessContextEnv,
  HarnessContextTools,
  HarnessLoadResult,
  HarnessModule,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/index.js'
import type {CurateResult} from '../../../../src/agent/core/interfaces/i-curate-service.js'

describe('HarnessContext + module contract', () => {
  describe('HarnessModule', () => {
    it('requires `meta` and makes `curate` / `query` optional', () => {
      // Minimal valid module: just meta.
      const minimal: HarnessModule = {
        meta: () => ({
          capabilities: [],
          commandType: 'curate',
          projectPatterns: [],
          version: 1,
        }),
      }
      expect(minimal.curate).to.equal(undefined)
      expect(minimal.query).to.equal(undefined)
      expectTypeOf(minimal.meta).returns.toMatchTypeOf<{commandType: string}>()
    })

    it('rejects a module missing `meta` at compile time', () => {
      // @ts-expect-error — meta is required
      const broken: HarnessModule = {curate: async () => ({} as CurateResult)}
      expect(broken).to.exist
    })
  })

  describe('HarnessContext readonly enforcement (compile-time only)', () => {
    // `readonly` is a TypeScript-level invariant. The tests below pass
    // iff the `@ts-expect-error` directives are consumed (i.e., TS would
    // report an error without them). Runtime writes still execute —
    // that's fine; the guarantee we're testing is the compile-time one,
    // and Phase 3 Task 3.2's module builder enforces runtime frozenness
    // via `Object.freeze` separately.

    it('rejects reassigning `ctx.env`', () => {
      const ctx: HarnessContext = {
        abort: new AbortController().signal,
        env: {commandType: 'curate', projectType: 'typescript', workingDirectory: '/'},
        tools: {} as HarnessContextTools,
      }
      const replacement: HarnessContextEnv = {
        commandType: 'chat',
        projectType: 'generic',
        workingDirectory: '/other',
      }
      // @ts-expect-error — env is readonly on HarnessContext
      ctx.env = replacement
      expect(ctx).to.exist
    })

    it('rejects reassigning `env.workingDirectory`', () => {
      const env: HarnessContextEnv = {
        commandType: 'curate',
        projectType: 'typescript',
        workingDirectory: '/tmp',
      }
      // @ts-expect-error — workingDirectory is readonly
      env.workingDirectory = '/elsewhere'
      expect(env).to.exist
    })

    it('rejects reassigning `tools.curate`', () => {
      const tools: HarnessContextTools = {
        curate: (async () => ({}) as CurateResult) as HarnessContextTools['curate'],
        readFile: (async () => ({}) as never) as HarnessContextTools['readFile'],
      }
      const replacement = (async () => ({}) as CurateResult) as HarnessContextTools['curate']
      // @ts-expect-error — curate is readonly
      tools.curate = replacement
      expect(tools).to.exist
    })
  })

  describe('HarnessLoadResult discriminated union', () => {
    it('narrows to `module` + `version` when `loaded === true`', () => {
      const result: HarnessLoadResult = {
        loaded: true,
        module: {
          meta: () => ({
            capabilities: [],
            commandType: 'curate',
            projectPatterns: [],
            version: 1,
          }),
        },
        version: {} as HarnessVersion,
      }

      if (result.loaded) {
        expectTypeOf(result.module).toEqualTypeOf<HarnessModule>()
        expectTypeOf(result.version).toEqualTypeOf<HarnessVersion>()
      }
    })

    it('narrows to `reason` when `loaded === false`', () => {
      const result: HarnessLoadResult = {loaded: false, reason: 'no-version'}

      if (!result.loaded) {
        expectTypeOf(result.reason).toEqualTypeOf<
          'meta-invalid' | 'meta-threw' | 'no-version' | 'syntax'
        >()
      }
    })

    it('does NOT expose `module` on the `loaded: false` variant', () => {
      // Type-level assertion: the failure variant's keys exclude `module`.
      // Extracting the failure variant from the union and checking its
      // keys is safer than trying `@ts-expect-error` inside a runtime
      // narrowing block, which is sensitive to unrelated TS lenience.
      type FailureVariant = Extract<HarnessLoadResult, {loaded: false}>
      expectTypeOf<keyof FailureVariant>().toEqualTypeOf<'loaded' | 'reason'>()
    })
  })
})
