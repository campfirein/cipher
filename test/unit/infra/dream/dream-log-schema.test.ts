import {expect} from 'chai'

import {DreamLogEntrySchema, DreamLogSummarySchema, DreamOperationSchema} from '../../../../src/server/infra/dream/dream-log-schema.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBase() {
  return {
    id: 'drm-1712736000000',
    operations: [],
    startedAt: 1_712_736_000_000,
    summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
    trigger: 'agent-idle' as const,
  }
}

// ── DreamOperationSchema ─────────────────────────────────────────────────────

describe('dream-log-schema', () => {
describe('DreamOperationSchema', () => {
  describe('CONSOLIDATE', () => {
    it('should parse a MERGE action', () => {
      const input = {
        action: 'MERGE',
        inputFiles: ['a.md', 'b.md'],
        needsReview: true,
        outputFile: 'a.md',
        previousTexts: {'a.md': 'old a', 'b.md': 'old b'},
        reason: 'duplicate',
        type: 'CONSOLIDATE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.type).to.equal('CONSOLIDATE')
      expect(result.action).to.equal('MERGE')
    })

    it('should parse a TEMPORAL_UPDATE action', () => {
      const input = {
        action: 'TEMPORAL_UPDATE',
        inputFiles: ['a.md'],
        needsReview: false,
        previousTexts: {'a.md': 'old content'},
        reason: 'conflicting dates',
        type: 'CONSOLIDATE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.action).to.equal('TEMPORAL_UPDATE')
    })

    it('should parse a CROSS_REFERENCE action', () => {
      const input = {
        action: 'CROSS_REFERENCE',
        inputFiles: ['a.md', 'b.md'],
        needsReview: false,
        reason: 'related topics',
        type: 'CONSOLIDATE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.action).to.equal('CROSS_REFERENCE')
    })

    it('should allow optional outputFile and previousTexts', () => {
      const input = {
        action: 'CROSS_REFERENCE',
        inputFiles: ['a.md', 'b.md'],
        needsReview: false,
        reason: 'related',
        type: 'CONSOLIDATE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result).to.not.have.property('outputFile')
    })
  })

  describe('SYNTHESIZE', () => {
    it('should parse a CREATE action', () => {
      const input = {
        action: 'CREATE',
        confidence: 0.85,
        needsReview: true,
        outputFile: 'domain/pattern.md',
        sources: ['domain/a.md', 'other/b.md'],
        type: 'SYNTHESIZE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.type).to.equal('SYNTHESIZE')
      expect(result.action).to.equal('CREATE')
    })

    it('should parse an UPDATE action', () => {
      const input = {
        action: 'UPDATE',
        confidence: 0.7,
        needsReview: false,
        outputFile: 'domain/existing.md',
        sources: ['domain/c.md'],
        type: 'SYNTHESIZE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.action).to.equal('UPDATE')
    })
  })

  describe('PRUNE', () => {
    it('should parse an ARCHIVE action', () => {
      const input = {
        action: 'ARCHIVE',
        file: 'domain/stale.md',
        needsReview: false,
        reason: 'low importance score',
        type: 'PRUNE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.type).to.equal('PRUNE')
      expect(result.action).to.equal('ARCHIVE')
    })

    it('should parse a KEEP action', () => {
      const input = {
        action: 'KEEP',
        file: 'domain/important.md',
        needsReview: false,
        reason: 'high importance',
        type: 'PRUNE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.action).to.equal('KEEP')
    })

    it('should parse a SUGGEST_MERGE action with mergeTarget', () => {
      const input = {
        action: 'SUGGEST_MERGE',
        file: 'domain/candidate.md',
        mergeTarget: 'domain/target.md',
        needsReview: true,
        reason: 'similar content',
        type: 'PRUNE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result.action).to.equal('SUGGEST_MERGE')
      expect((result as {mergeTarget?: string}).mergeTarget).to.equal('domain/target.md')
    })

    it('should allow optional mergeTarget', () => {
      const input = {
        action: 'ARCHIVE',
        file: 'domain/old.md',
        needsReview: false,
        reason: 'stale',
        type: 'PRUNE',
      }
      const result = DreamOperationSchema.parse(input)
      expect(result).to.not.have.property('mergeTarget')
    })
  })

  it('should reject an unknown operation type', () => {
    const input = {
      action: 'MERGE',
      inputFiles: ['a.md'],
      needsReview: false,
      reason: 'test',
      type: 'UNKNOWN',
    }
    expect(() => DreamOperationSchema.parse(input)).to.throw()
  })
})

// ── DreamLogSummarySchema ────────────────────────────────────────────────────

describe('DreamLogSummarySchema', () => {
  it('should parse a valid summary', () => {
    const input = {consolidated: 2, errors: 0, flaggedForReview: 1, pruned: 3, synthesized: 1}
    const result = DreamLogSummarySchema.parse(input)
    expect(result).to.deep.equal(input)
  })

  it('should reject negative values', () => {
    const input = {consolidated: -1, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0}
    expect(() => DreamLogSummarySchema.parse(input)).to.throw()
  })
})

// ── DreamLogEntrySchema ──────────────────────────────────────────────────────

describe('DreamLogEntrySchema', () => {
  it('should parse a completed entry', () => {
    const input = {
      ...makeBase(),
      completedAt: 1_712_736_060_000,
      status: 'completed',
      taskId: 'task-123',
    }
    const result = DreamLogEntrySchema.parse(input)
    expect(result.status).to.equal('completed')
    expect(result.taskId).to.equal('task-123')
  })

  it('should parse a partial entry with abortReason', () => {
    const input = {
      ...makeBase(),
      abortReason: 'timeout',
      completedAt: 1_712_736_060_000,
      status: 'partial',
    }
    const result = DreamLogEntrySchema.parse(input)
    expect(result.status).to.equal('partial')
    expect((result as {abortReason?: string}).abortReason).to.equal('timeout')
  })

  it('should parse an error entry', () => {
    const input = {
      ...makeBase(),
      completedAt: 1_712_736_060_000,
      error: 'LLM call failed',
      status: 'error',
    }
    const result = DreamLogEntrySchema.parse(input)
    expect(result.status).to.equal('error')
    expect((result as {error?: string}).error).to.equal('LLM call failed')
  })

  it('should parse a processing entry', () => {
    const input = {
      ...makeBase(),
      status: 'processing',
    }
    const result = DreamLogEntrySchema.parse(input)
    expect(result.status).to.equal('processing')
  })

  it('should parse an undone entry', () => {
    const input = {
      ...makeBase(),
      completedAt: 1_712_736_060_000,
      status: 'undone',
      undoneAt: 1_712_736_120_000,
    }
    const result = DreamLogEntrySchema.parse(input)
    expect(result.status).to.equal('undone')
    expect((result as {undoneAt?: number}).undoneAt).to.equal(1_712_736_120_000)
  })

  it(String.raw`should reject id not matching drm-\d+ pattern`, () => {
    const input = {
      ...makeBase(),
      id: 'bad-12345',
      status: 'processing',
    }
    expect(() => DreamLogEntrySchema.parse(input)).to.throw()
  })

  it('should reject invalid trigger value', () => {
    const input = {
      ...makeBase(),
      status: 'processing',
      trigger: 'invalid-trigger',
    }
    expect(() => DreamLogEntrySchema.parse(input)).to.throw()
  })

  it('should reject unknown status', () => {
    const input = {
      ...makeBase(),
      status: 'unknown',
    }
    expect(() => DreamLogEntrySchema.parse(input)).to.throw()
  })

  it('should accept entries with operations', () => {
    const input = {
      ...makeBase(),
      operations: [
        {
          action: 'MERGE',
          inputFiles: ['a.md', 'b.md'],
          needsReview: true,
          outputFile: 'a.md',
          reason: 'dup',
          type: 'CONSOLIDATE',
        },
        {
          action: 'ARCHIVE',
          file: 'domain/old.md',
          needsReview: false,
          reason: 'stale',
          type: 'PRUNE',
        },
      ],
      status: 'processing',
      summary: {consolidated: 1, errors: 0, flaggedForReview: 1, pruned: 1, synthesized: 0},
    }
    const result = DreamLogEntrySchema.parse(input)
    expect(result.operations).to.have.lengthOf(2)
  })
})
})
