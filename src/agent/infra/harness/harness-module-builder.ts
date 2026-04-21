/**
 * AutoHarness V2 — module builder.
 *
 * Evaluates a `HarnessVersion.code` string inside `vm.createContext`,
 * validates the exported shape, and returns a callable `HarnessModule`
 * wrapped in a `HarnessLoadResult`. Every failure mode is normalized
 * into a `{loaded: false, reason}` variant — this class never throws.
 *
 * ## Security surface
 *
 * This is the entry point for all template + refined harness code
 * execution. Isolation guarantees enforced here:
 *
 *   - Fresh `vm.createContext` per `build()` call — no state shared
 *     across loads.
 *   - EVERY function invocation (`meta()`, `curate(ctx)`, `query(ctx)`)
 *     runs inside a fresh `vm.Script.runInContext` call with
 *     `{timeout: VM_TIMEOUT_MS}`. This catches synchronous infinite
 *     loops — V8 enforces the wall-clock timeout on sync execution
 *     and throws a `Script execution timed out` error.
 *   - Async results are then raced against a JS-level timer —
 *     `vm` timeout only covers sync execution, so a function that
 *     returns a never-resolving Promise needs the `Promise.race`
 *     safety net.
 *   - Context is `Object.freeze`d at the call boundary so a
 *     compromised harness can't mutate its own view of `ctx`.
 *   - Error normalization strips any captured outer-scope state from
 *     thrown errors before propagating — constructed fresh `Error`
 *     instances carry only message + stack.
 *
 * ## Template format
 *
 * Templates are CommonJS-style strings — the evaluator injects
 * `module.exports` and `exports` (both pointing at the same object)
 * into the VM context and reads `module.exports.{meta,curate,query}`
 * after the script runs. ESM would require a loader hook that
 * `vm.Script` doesn't provide. See `phase_3_4_handoff.md §C7`.
 */

import * as vm from 'node:vm'

import type {
  HarnessContext,
  HarnessLoadResult,
  HarnessMeta,
  HarnessModule,
  HarnessVersion,
  ValidatedHarnessMeta,
} from '../../core/domain/harness/index.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'

import {HarnessMetaSchema} from '../../core/domain/harness/types.js'

/**
 * Hard timeout applied to every VM-backed invocation — `meta()` at
 * build time and `curate()` / `query()` per call. See handoff §C5.
 * The `vm.Script` timeout option enforces this on SYNCHRONOUS
 * execution; the `Promise.race` fallback covers async hangs.
 */
const VM_TIMEOUT_MS = 5000

/**
 * Shape injected into `vm.createContext`. Both `module.exports` and
 * `exports` start pointing at the same object so templates can use
 * either CommonJS idiom. The per-invocation magic slots
 * (`__harnessArg`, `__harnessFn`) carry arguments and function
 * references into each `runInContext` call.
 */
interface ScriptContext {
  __harnessArg?: unknown
  __harnessFn?: (...args: unknown[]) => unknown
  __harnessResult?: unknown
  exports: Record<string, unknown>
  module: {exports: Record<string, unknown>}
}

export class HarnessModuleBuilder {
  constructor(private readonly logger: ILogger) {}

  /**
   * Evaluate a harness version and return its callable module.
   * Never throws — every failure mode is encoded in the returned
   * `HarnessLoadResult`.
   */
  build(version: HarnessVersion): HarnessLoadResult {
    // 1. Syntax parse. Prepend `"use strict"` so harness code runs in
    //    strict mode — assignments to frozen properties throw instead
    //    of silently no-op'ing, which is what makes `Object.freeze(ctx)`
    //    at the invocation boundary a real isolation guarantee.
    //    Functions defined in the original script inherit strict mode,
    //    so later invocations through `invokeInVm` (which uses a
    //    separate script) still run the harness-side code strict.
    let script: vm.Script
    try {
      script = new vm.Script(`"use strict";\n${version.code}`, {
        filename: `harness:${version.id}`,
      })
    } catch (error) {
      this.logger.warn('HarnessModuleBuilder: syntax error', {
        error: error instanceof Error ? error.message : String(error),
        versionId: version.id,
      })
      return {loaded: false, reason: 'syntax'}
    }

    // 2. Evaluate into a fresh VM context. `vm.createContext({})`
    //    gives the harness its own `globalThis`; we inject both
    //    `module.exports` and `exports` pointing at the same object.
    const exportsObj: Record<string, unknown> = {}
    const moduleObj = {exports: exportsObj}
    const scriptContext = vm.createContext({
      __harnessArg: undefined,
      __harnessFn: undefined,
      __harnessResult: undefined,
      exports: exportsObj,
      module: moduleObj,
    } satisfies ScriptContext)
    try {
      script.runInContext(scriptContext, {timeout: VM_TIMEOUT_MS})
    } catch (error) {
      this.logger.warn('HarnessModuleBuilder: script run failed', {
        error: error instanceof Error ? error.message : String(error),
        versionId: version.id,
      })
      return {loaded: false, reason: 'syntax'}
    }

    // 3. Extract and shape-check exports. Read `module.exports` as
    //    canonical — handles the case where the template reassigned
    //    `module.exports = {...}` wholesale.
    const finalExports = moduleObj.exports
    const metaFn = finalExports.meta
    const curateFn = finalExports.curate
    const queryFn = finalExports.query

    if (typeof metaFn !== 'function') {
      this.logger.warn('HarnessModuleBuilder: missing or non-function meta export', {
        versionId: version.id,
      })
      return {loaded: false, reason: 'syntax'}
    }

    if (curateFn !== undefined && typeof curateFn !== 'function') {
      this.logger.warn('HarnessModuleBuilder: curate export is not a function', {
        versionId: version.id,
      })
      return {loaded: false, reason: 'syntax'}
    }

    if (queryFn !== undefined && typeof queryFn !== 'function') {
      this.logger.warn('HarnessModuleBuilder: query export is not a function', {
        versionId: version.id,
      })
      return {loaded: false, reason: 'syntax'}
    }

    // 4. Pre-compile the invoke scripts once per `build()`. Each
    //    maps an exported function name to a `vm.Script` that reads
    //    `module.exports.<name>(__harnessArg)` and writes the result
    //    to `__harnessResult`. Compiling once here saves
    //    `new vm.Script(...)` work on every `curate`/`query`
    //    invocation.
    const metaInvokeScript = this.compileInvokeScript('meta', version.id)
    let rawMeta: unknown
    try {
      rawMeta = this.invokeInVm(scriptContext, metaInvokeScript)
    } catch (error) {
      this.logger.warn('HarnessModuleBuilder: meta() threw', {
        error: error instanceof Error ? error.message : String(error),
        versionId: version.id,
      })
      return {loaded: false, reason: 'meta-threw'}
    }

    const parsed = HarnessMetaSchema.safeParse(rawMeta)
    if (!parsed.success) {
      this.logger.warn('HarnessModuleBuilder: meta() returned invalid value', {
        error: parsed.error.message,
        versionId: version.id,
      })
      return {loaded: false, reason: 'meta-invalid'}
    }

    const meta = parsed.data

    // 5. Build the callable wrappers. Pre-compile curate/query
    //    invoke scripts only when the template actually exported them.
    const curateInvokeScript =
      curateFn === undefined ? undefined : this.compileInvokeScript('curate', version.id)
    const queryInvokeScript =
      queryFn === undefined ? undefined : this.compileInvokeScript('query', version.id)

    const harnessModule: HarnessModule = this.buildModule({
      curateInvokeScript,
      meta,
      queryInvokeScript,
      scriptContext,
      versionId: version.id,
    })

    return {loaded: true, module: harnessModule, version}
  }

  /**
   * Assemble the callable `HarnessModule`. Each exported function
   * becomes a `wrapInvocation`-backed wrapper; `meta()` returns the
   * already-captured value so the VM function is never re-invoked.
   */
  private buildModule(opts: {
    curateInvokeScript: undefined | vm.Script
    meta: ValidatedHarnessMeta
    queryInvokeScript: undefined | vm.Script
    scriptContext: vm.Context
    versionId: string
  }): HarnessModule {
    const built: {
      curate?: HarnessModule['curate']
      meta: HarnessModule['meta']
      query?: HarnessModule['query']
    } = {
      meta: (): HarnessMeta => opts.meta,
    }

    if (opts.curateInvokeScript !== undefined) {
      built.curate = this.wrapInvocation(
        opts.scriptContext,
        opts.curateInvokeScript,
        'curate',
        opts.versionId,
      ) as HarnessModule['curate']
    }

    if (opts.queryInvokeScript !== undefined) {
      built.query = this.wrapInvocation(
        opts.scriptContext,
        opts.queryInvokeScript,
        'query',
        opts.versionId,
      ) as HarnessModule['query']
    }

    return built
  }

  /**
   * Compile once — the invoke script is the same string for a given
   * `name` per `build()` call, so reusing it across invocations saves
   * `new vm.Script(...)` work.
   */
  private compileInvokeScript(name: 'curate' | 'meta' | 'query', versionId: string): vm.Script {
    return new vm.Script(`__harnessResult = module.exports.${name}(__harnessArg)`, {
      filename: `harness:${versionId}#${name}`,
    })
  }

  /**
   * Run a pre-compiled invoke script inside the `scriptContext`.
   * The script reads `module.exports.<name>(__harnessArg)` and writes
   * its return value to `__harnessResult`. V8's wall-clock timeout on
   * `runInContext` catches sync infinite loops; async hang detection
   * is the caller's concern (see `wrapInvocation`).
   */
  private invokeInVm(
    scriptContext: vm.Context,
    invokeScript: vm.Script,
    arg?: unknown,
  ): unknown {
    const contextRef = scriptContext as unknown as ScriptContext
    // Thread the argument through the context. Safe because we
    // assume serial invocations per scriptContext (a harness module
    // is loaded once per session and one code_exec runs at a time).
    contextRef.__harnessArg = arg
    try {
      invokeScript.runInContext(scriptContext, {timeout: VM_TIMEOUT_MS})
      return contextRef.__harnessResult
    } finally {
      contextRef.__harnessArg = undefined
      contextRef.__harnessResult = undefined
    }
  }

  /**
   * Wrap a named VM-resident function so every invocation:
   *   - Freezes the context at the boundary.
   *   - Calls the function via `invokeInVm` (covers sync hangs with
   *     V8's 5s wall-clock timeout on `vm.Script.runInContext`).
   *   - If the return value is a Promise, races it against a JS-level
   *     5s timer (covers async never-resolving promises).
   *   - Normalizes thrown errors via a fresh `Error` construction so
   *     captured outer-scope properties can't escape.
   */
  private wrapInvocation(
    scriptContext: vm.Context,
    invokeScript: vm.Script,
    name: 'curate' | 'query',
    versionId: string,
  ): (ctx: HarnessContext) => Promise<unknown> {
    const {logger} = this
    const invokeInVm = this.invokeInVm.bind(this)
    return async (ctx: HarnessContext): Promise<unknown> => {
      // Deep-freeze at the boundary. `Object.freeze` is shallow, so we
      // also freeze `ctx.env` and `ctx.tools` (both copied via spread so
      // the caller's originals stay untouched). Without this, a harness
      // could mutate `ctx.env.commandType = 'hacked'` or
      // `ctx.tools.curate = evilFn` — the top-level freeze catches
      // `ctx.env = ...` but not nested writes.
      const frozenCtx: HarnessContext = Object.freeze({
        ...ctx,
        env: Object.freeze({...ctx.env}),
        tools: Object.freeze({...ctx.tools}),
      })

      let syncResult: unknown
      try {
        // Sync invocation — vm timeout catches infinite loops.
        syncResult = invokeInVm(scriptContext, invokeScript, frozenCtx)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`HarnessModuleBuilder: ${name}() sync failure`, {error: message, versionId})
        throw new Error(`harness ${name}() failed: ${message}`)
      }

      // If the function returned a Promise, race against a JS timer
      // to catch async hangs (never-resolving promises). `vm`'s
      // `timeout` option only covers sync execution and doesn't track
      // microtask scheduling.
      if (!isPromiseLike(syncResult)) {
        return syncResult
      }

      let timeoutHandle: NodeJS.Timeout | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`harness ${name}() exceeded ${VM_TIMEOUT_MS}ms`))
        }, VM_TIMEOUT_MS)
      })

      try {
        const result = await Promise.race([syncResult, timeoutPromise])
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`HarnessModuleBuilder: ${name}() async failure`, {error: message, versionId})
        throw new Error(`harness ${name}() failed: ${message}`)
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      }
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as {then?: unknown}).then === 'function'
  )
}
