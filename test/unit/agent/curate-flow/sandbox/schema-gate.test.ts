/**
 * Phase 2 Task 2.2 — schema validation gate.
 *
 * Per Phase 2 plan §11 finding F5: hard-failing on every schema mismatch
 * risks silent data loss while real-world LLM output variance is still
 * being mapped against the static Zod shapes. The gate therefore supports
 * both strict (throws `SchemaValidationError`) and soft (returns
 * `{ok: false, issues}` without throwing) modes. Phase 2 uses soft mode
 * end-to-end; Phase 3 promotes to strict once the schemas are battle-tested.
 *
 * What the tests assert:
 *   - strict mode: throws `SchemaValidationError` on input/output failure;
 *     `fn` is NOT invoked when input fails.
 *   - soft mode: returns a discriminated union without throwing.
 *   - happy path returns the fn's output (both modes).
 *   - Errors carry the slot name + zod issue paths.
 */

import {expect} from 'chai'
import {z} from 'zod'

import {
  SchemaValidationError,
  validateAndRun,
} from '../../../../../src/agent/core/curation/flow/sandbox/schema-gate.js'

describe('validateAndRun (schema gate)', () => {
  describe('strict mode (throws)', () => {
    it('input matches → fn invoked, output validated, value returned', async () => {
      const inputSchema = z.object({n: z.number()})
      const outputSchema = z.object({double: z.number()})

      let invoked = false
      const result = await validateAndRun({
        async fn(input) {
          invoked = true
          return {double: input.n * 2}
        },
        input: {n: 5},
        inputSchema,
        mode: 'strict',
        outputSchema,
        slot: 'extract',
      })

      expect(invoked).to.be.true
      expect(result).to.deep.equal({ok: true, value: {double: 10}})
    })

    it('input fails schema → throws SchemaValidationError BEFORE fn invocation', async () => {
      const inputSchema = z.object({n: z.number()})
      const outputSchema = z.object({double: z.number()})

      let invoked = false
      let thrown: SchemaValidationError | undefined

      try {
        await validateAndRun({
          async fn() {
            invoked = true
            return {double: 0}
          },
          input: {n: 'not-a-number'},
          inputSchema,
          mode: 'strict',
          outputSchema,
          slot: 'extract',
        })
      } catch (error) {
        thrown = error as SchemaValidationError
      }

      expect(invoked, 'fn must NOT run when input is invalid').to.be.false
      expect(thrown).to.be.instanceOf(SchemaValidationError)
      expect(thrown?.slot).to.equal('extract')
      expect(thrown?.phase).to.equal('input')
      expect(thrown?.issues).to.have.length.greaterThan(0)
    })

    it('output fails schema → throws SchemaValidationError', async () => {
      const inputSchema = z.object({n: z.number()})
      const outputSchema = z.object({double: z.number()})

      let thrown: SchemaValidationError | undefined
      try {
        await validateAndRun({
          fn: async () => ({double: 'not-a-number'}) as unknown as {double: number},
          input: {n: 5},
          inputSchema,
          mode: 'strict',
          outputSchema,
          slot: 'extract',
        })
      } catch (error) {
        thrown = error as SchemaValidationError
      }

      expect(thrown).to.be.instanceOf(SchemaValidationError)
      expect(thrown?.phase).to.equal('output')
    })
  })

  describe('soft mode (returns discriminated union)', () => {
    it('input matches → returns ok=true with output', async () => {
      const inputSchema = z.object({n: z.number()})
      const outputSchema = z.object({double: z.number()})

      const result = await validateAndRun({
        fn: async (input) => ({double: input.n * 2}),
        input: {n: 3},
        inputSchema,
        mode: 'soft',
        outputSchema,
        slot: 'extract',
      })

      expect(result).to.deep.equal({ok: true, value: {double: 6}})
    })

    it('input fails schema → returns ok=false with issues, fn NOT invoked', async () => {
      const inputSchema = z.object({n: z.number()})
      const outputSchema = z.object({double: z.number()})

      let invoked = false
      const result = await validateAndRun({
        async fn() {
          invoked = true
          return {double: 0}
        },
        input: {n: 'bad'},
        inputSchema,
        mode: 'soft',
        outputSchema,
        slot: 'extract',
      })

      expect(invoked).to.be.false
      expect(result.ok).to.be.false
      if (!result.ok) {
        expect(result.phase).to.equal('input')
        expect(result.issues).to.have.length.greaterThan(0)
      }
    })

    it('output fails schema → returns ok=false with issues + fn output for fallback use', async () => {
      const inputSchema = z.object({n: z.number()})
      const outputSchema = z.object({double: z.number()})

      const result = await validateAndRun({
        fn: async () => ({double: 'oops'}) as unknown as {double: number},
        input: {n: 1},
        inputSchema,
        mode: 'soft',
        outputSchema,
        slot: 'extract',
      })

      expect(result.ok).to.be.false
      if (!result.ok) {
        expect(result.phase).to.equal('output')
        expect(result.rawOutput).to.deep.equal({double: 'oops'})
      }
    })
  })

  describe('error metadata', () => {
    it('SchemaValidationError carries zod issue paths', () => {
      const err = new SchemaValidationError('extract', 'input', [
        {message: 'expected number', path: ['n']},
      ])
      expect(err.issues[0].path).to.deep.equal(['n'])
      expect(err.message).to.include('expected number')
    })
  })
})
