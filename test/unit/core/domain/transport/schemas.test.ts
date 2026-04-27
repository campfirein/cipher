import {expect} from 'chai'

import {
  TaskClearCompletedRequestSchema,
  TaskCreatedSchema,
  TaskDeleteBulkRequestSchema,
  TaskDeletedEventSchema,
  TaskDeleteRequestSchema,
  TaskGetRequestSchema,
  TaskGetResponseSchema,
  TaskListItemSchema,
  TaskListRequestSchema,
  TaskListResponseSchema,
} from '../../../../../src/server/core/domain/transport/schemas.js'

describe('task transport schemas', () => {
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

  // ========================================================================
  // M2.08 — pagination, get, delete events
  // ========================================================================

  describe('TaskListRequest / TaskListResponse pagination', () => {
    it('TaskListRequest accepts before + limit', () => {
      const result = TaskListRequestSchema.safeParse({
        before: 1_745_432_125_000,
        limit: 50,
        projectPath: '/p',
      })
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.before).to.equal(1_745_432_125_000)
        expect(result.data.limit).to.equal(50)
      }
    })

    it('TaskListResponse accepts nextCursor', () => {
      const result = TaskListResponseSchema.safeParse({
        nextCursor: 1_745_432_120_000,
        tasks: [],
      })
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.nextCursor).to.equal(1_745_432_120_000)
      }
    })

    it('Old TaskList shape (no pagination) still parses (back-compat)', () => {
      expect(TaskListRequestSchema.safeParse({}).success).to.equal(true)
      expect(TaskListRequestSchema.safeParse({projectPath: '/p'}).success).to.equal(true)
      expect(TaskListResponseSchema.safeParse({tasks: []}).success).to.equal(true)
    })

    it('TaskListRequest enforces limit bounds (1..1000)', () => {
      expect(TaskListRequestSchema.safeParse({limit: 1}).success).to.equal(true)
      expect(TaskListRequestSchema.safeParse({limit: 1000}).success).to.equal(true)
      expect(TaskListRequestSchema.safeParse({limit: 0}).success).to.equal(false)
      expect(TaskListRequestSchema.safeParse({limit: 1001}).success).to.equal(false)
    })
  })

  describe('task:get', () => {
    it('TaskGet round-trips', () => {
      expect(TaskGetRequestSchema.safeParse({taskId: 'a'}).success).to.equal(true)
      expect(TaskGetResponseSchema.safeParse({task: null}).success).to.equal(true)

      const fullEntry = {
        completedAt: 1_745_432_002_000,
        content: 'x',
        createdAt: 1_745_432_000_000,
        id: 'tsk-1',
        model: 'gpt-5-pro',
        projectPath: '/p',
        provider: 'openai',
        result: 'done',
        schemaVersion: 1,
        startedAt: 1_745_432_001_000,
        status: 'completed',
        taskId: 'a',
        type: 'curate',
      }
      expect(TaskGetResponseSchema.safeParse({task: fullEntry}).success).to.equal(true)
    })
  })

  describe('task delete events', () => {
    it('TaskDelete / DeleteBulk / ClearCompleted parse valid shapes', () => {
      expect(TaskDeleteRequestSchema.safeParse({taskId: 'a'}).success).to.equal(true)
      expect(TaskDeleteBulkRequestSchema.safeParse({taskIds: ['a', 'b', 'c']}).success).to.equal(true)
      expect(TaskClearCompletedRequestSchema.safeParse({}).success).to.equal(true)
      expect(TaskClearCompletedRequestSchema.safeParse({projectPath: '/p'}).success).to.equal(true)
    })
  })

  describe('task:deleted broadcast', () => {
    it('TaskDeleted broadcast schema parses', () => {
      const result = TaskDeletedEventSchema.safeParse({taskId: 'a'})
      expect(result.success).to.equal(true)
      if (result.success) {
        expect(result.data.taskId).to.equal('a')
      }
    })
  })
})
