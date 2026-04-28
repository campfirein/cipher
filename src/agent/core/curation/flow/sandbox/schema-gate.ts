/**
 * Schema validation gate for slot I/O.
 *
 * Wraps a slot function with Zod `safeParse` on input and output. Two
 * modes:
 *
 *   - `strict` — throws `SchemaValidationError` on either side.
 *   - `soft`   — returns `{ok: false, phase, issues, rawOutput?}` so
 *                callers can record + continue (Phase 2 semantics per
 *                §11 finding F5; promoted to strict in Phase 3).
 *
 * Both modes share the same input-validation-before-fn-invocation
 * contract: a schema-invalid input is never handed to `fn`.
 */

import type {z} from 'zod'

import type {NodeSlot} from '../types.js'

import {SchemaValidationError} from './errors.js'

export {SchemaValidationError} from './errors.js'

export interface ValidateAndRunArgs<In, Out> {
  fn: (input: In) => Promise<Out>
  input: unknown
  inputSchema: z.ZodType<In>
  mode: 'soft' | 'strict'
  outputSchema: z.ZodType<Out>
  slot: NodeSlot
}

export type ValidateAndRunResult<Out> =
  | {issues: ReadonlyArray<{message: string; path: ReadonlyArray<number | string>}>; ok: false; phase: 'input' | 'output'; rawOutput?: unknown}
  | {ok: true; value: Out}

export async function validateAndRun<In, Out>(
  args: ValidateAndRunArgs<In, Out>,
): Promise<ValidateAndRunResult<Out>> {
  const {fn, input, inputSchema, mode, outputSchema, slot} = args

  const inputResult = inputSchema.safeParse(input)
  if (!inputResult.success) {
    const issues = inputResult.error.issues.map((i) => ({
      message: i.message,
      path: i.path,
    }))

    if (mode === 'strict') {
      throw new SchemaValidationError(slot, 'input', issues)
    }

    return {issues, ok: false, phase: 'input'}
  }

  const rawOutput = await fn(inputResult.data)

  const outputResult = outputSchema.safeParse(rawOutput)
  if (!outputResult.success) {
    const issues = outputResult.error.issues.map((i) => ({
      message: i.message,
      path: i.path,
    }))

    if (mode === 'strict') {
      throw new SchemaValidationError(slot, 'output', issues)
    }

    return {issues, ok: false, phase: 'output', rawOutput}
  }

  return {ok: true, value: outputResult.data}
}
