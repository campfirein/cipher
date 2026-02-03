import {expect} from 'chai'
import {restore} from 'sinon'

import {BrvCurateInputSchema} from '../../../../../src/server/infra/mcp/tools/brv-curate-tool.js'

describe('brv-curate-tool', () => {
  afterEach(() => {
    restore()
  })

  describe('BrvCurateInputSchema', () => {
    it('should accept context without cwd', () => {
      const result = BrvCurateInputSchema.safeParse({context: 'Auth uses JWT'})
      expect(result.success).to.be.true
    })

    it('should accept context with cwd', () => {
      const result = BrvCurateInputSchema.safeParse({
        context: 'Auth uses JWT',
        cwd: '/path/to/project',
      })
      expect(result.success).to.be.true
    })

    it('should accept files without cwd', () => {
      const result = BrvCurateInputSchema.safeParse({files: ['src/auth.ts']})
      expect(result.success).to.be.true
    })

    it('should accept files with cwd', () => {
      const result = BrvCurateInputSchema.safeParse({
        cwd: '/path/to/project',
        files: ['src/auth.ts'],
      })
      expect(result.success).to.be.true
    })

    it('should reject when neither context nor files provided', () => {
      const result = BrvCurateInputSchema.safeParse({cwd: '/path'})
      expect(result.success).to.be.false
    })

    it('should reject empty context with no files', () => {
      const result = BrvCurateInputSchema.safeParse({context: '   '})
      expect(result.success).to.be.false
    })

    it('should accept optional cwd as undefined', () => {
      const result = BrvCurateInputSchema.safeParse({context: 'test'})
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.data.cwd).to.be.undefined
      }
    })

    it('should enforce max 5 files', () => {
      const result = BrvCurateInputSchema.safeParse({
        files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
      })
      expect(result.success).to.be.false
    })
  })

  describe('schema shape', () => {
    it('should expose cwd in the input schema', () => {
      // Access the inner object shape (before .refine())
      // BrvCurateInputSchema is a ZodEffects wrapping a ZodObject
      const {schema: innerSchema} = BrvCurateInputSchema._def
      const {shape} = innerSchema
      expect(shape).to.have.property('cwd')
      expect(shape).to.have.property('context')
      expect(shape).to.have.property('files')
    })
  })
})
