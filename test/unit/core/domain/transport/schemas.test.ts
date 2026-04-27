import {expect} from 'chai'

import {
  TaskCreatedSchema,
  TaskListItemSchema,
} from '../../../../../src/server/core/domain/transport/schemas.js'

describe('transport schemas — provider/model fields', () => {
  describe('TaskListItemSchema', () => {
    const baseEntry = {
      content: 'test',
      createdAt: 1_745_432_123_456,
      status: 'completed' as const,
      taskId: 'abc-123',
      type: 'curate',
    }

    it('accepts entry with provider + model and preserves both fields', () => {
      const result = TaskListItemSchema.safeParse({
        ...baseEntry,
        model: 'gpt-5-pro',
        provider: 'openai',
      })
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.provider).to.equal('openai')
        expect(result.data.model).to.equal('gpt-5-pro')
      }
    })

    it('accepts entry with provider only (ByteRover internal — no model)', () => {
      const result = TaskListItemSchema.safeParse({
        ...baseEntry,
        provider: 'byterover',
      })
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.provider).to.equal('byterover')
        expect(result.data.model).to.equal(undefined)
      }
    })

    it('accepts entry without provider + model (back-compat)', () => {
      const result = TaskListItemSchema.safeParse(baseEntry)
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.provider).to.equal(undefined)
        expect(result.data.model).to.equal(undefined)
      }
    })
  })

  describe('TaskCreatedSchema', () => {
    const baseCreated = {
      content: 'test',
      taskId: 'abc-123',
      type: 'curate' as const,
    }

    it('accepts payload with provider + model and preserves both fields', () => {
      const result = TaskCreatedSchema.safeParse({
        ...baseCreated,
        model: 'gpt-5-pro',
        provider: 'openai',
      })
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.provider).to.equal('openai')
        expect(result.data.model).to.equal('gpt-5-pro')
      }
    })

    it('accepts payload with provider only (ByteRover internal — no model)', () => {
      const result = TaskCreatedSchema.safeParse({
        ...baseCreated,
        provider: 'byterover',
      })
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.provider).to.equal('byterover')
        expect(result.data.model).to.equal(undefined)
      }
    })

    it('accepts payload without provider + model (back-compat)', () => {
      const result = TaskCreatedSchema.safeParse(baseCreated)
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.provider).to.equal(undefined)
        expect(result.data.model).to.equal(undefined)
      }
    })
  })
})
