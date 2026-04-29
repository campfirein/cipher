import {expect} from 'chai'

import {DreamStateSchema, EMPTY_DREAM_STATE, PendingMergeSchema, StaleSummaryEntrySchema} from '../../../../src/server/infra/dream/dream-state-schema.js'

describe('dream-state-schema', () => {
describe('DreamStateSchema', () => {
  it('should parse a valid full payload', () => {
    const input = {
      curationsSinceDream: 5,
      lastDreamAt: '2026-04-10T12:00:00.000Z',
      lastDreamLogId: 'drm-1712736000000',
      pendingMerges: [
        {
          mergeTarget: 'domain/merged.md',
          reason: 'duplicate content',
          sourceFile: 'domain/old.md',
          suggestedByDreamId: 'drm-1712736000000',
        },
      ],
      staleSummaryPaths: [],
      totalDreams: 3,
      version: 1,
    }

    const result = DreamStateSchema.parse(input)
    expect(result).to.deep.equal(input)
  })

  it('should default pendingMerges to [] when missing', () => {
    const input = {
      curationsSinceDream: 0,
      lastDreamAt: null,
      lastDreamLogId: null,
      totalDreams: 0,
      version: 1,
    }

    const result = DreamStateSchema.parse(input)
    expect(result.pendingMerges).to.deep.equal([])
  })

  it('should reject wrong version', () => {
    const input = {
      curationsSinceDream: 0,
      lastDreamAt: null,
      lastDreamLogId: null,
      pendingMerges: [],
      totalDreams: 0,
      version: 2,
    }

    expect(() => DreamStateSchema.parse(input)).to.throw()
  })

  it('should reject negative totalDreams', () => {
    const input = {
      curationsSinceDream: 0,
      lastDreamAt: null,
      lastDreamLogId: null,
      pendingMerges: [],
      totalDreams: -1,
      version: 1,
    }

    expect(() => DreamStateSchema.parse(input)).to.throw()
  })

  it('should reject negative curationsSinceDream', () => {
    const input = {
      curationsSinceDream: -3,
      lastDreamAt: null,
      lastDreamLogId: null,
      pendingMerges: [],
      totalDreams: 0,
      version: 1,
    }

    expect(() => DreamStateSchema.parse(input)).to.throw()
  })

  it('should reject non-integer curationsSinceDream', () => {
    const input = {
      curationsSinceDream: 1.5,
      lastDreamAt: null,
      lastDreamLogId: null,
      pendingMerges: [],
      totalDreams: 0,
      version: 1,
    }

    expect(() => DreamStateSchema.parse(input)).to.throw()
  })
})

describe('PendingMergeSchema', () => {
  it('should parse a valid pending merge', () => {
    const input = {
      mergeTarget: 'domain/target.md',
      reason: 'similar content',
      sourceFile: 'domain/source.md',
      suggestedByDreamId: 'drm-1712736000000',
    }

    const result = PendingMergeSchema.parse(input)
    expect(result).to.deep.equal(input)
  })

  it('should reject missing required fields', () => {
    expect(() => PendingMergeSchema.parse({sourceFile: 'a.md'})).to.throw()
  })
})

describe('EMPTY_DREAM_STATE', () => {
  it('should pass DreamStateSchema.parse()', () => {
    const result = DreamStateSchema.parse(EMPTY_DREAM_STATE)
    expect(result).to.deep.equal(EMPTY_DREAM_STATE)
  })

  it('should have all expected default values', () => {
    expect(EMPTY_DREAM_STATE.curationsSinceDream).to.equal(0)
    expect(EMPTY_DREAM_STATE.lastDreamAt).to.be.null
    expect(EMPTY_DREAM_STATE.lastDreamLogId).to.be.null
    expect(EMPTY_DREAM_STATE.pendingMerges).to.deep.equal([])
    expect(EMPTY_DREAM_STATE.staleSummaryPaths).to.deep.equal([])
    expect(EMPTY_DREAM_STATE.totalDreams).to.equal(0)
    expect(EMPTY_DREAM_STATE.version).to.equal(1)
  })
})

describe('StaleSummaryEntrySchema', () => {
  it('should parse a valid entry', () => {
    const input = {enqueuedAt: 1_745_539_200_000, path: 'auth/jwt/token.md'}
    const result = StaleSummaryEntrySchema.parse(input)
    expect(result).to.deep.equal(input)
  })

  it('should reject a non-integer enqueuedAt', () => {
    expect(() => StaleSummaryEntrySchema.parse({enqueuedAt: 1.5, path: 'a.md'})).to.throw()
  })

  it('should reject a negative enqueuedAt', () => {
    expect(() => StaleSummaryEntrySchema.parse({enqueuedAt: -1, path: 'a.md'})).to.throw()
  })

  it('should reject a missing path', () => {
    expect(() => StaleSummaryEntrySchema.parse({enqueuedAt: 0})).to.throw()
  })
})

describe('DreamStateSchema staleSummaryPaths', () => {
  it('should default staleSummaryPaths to [] when missing', () => {
    const input = {
      curationsSinceDream: 0,
      lastDreamAt: null,
      lastDreamLogId: null,
      totalDreams: 0,
      version: 1,
    }
    const result = DreamStateSchema.parse(input)
    expect(result.staleSummaryPaths).to.deep.equal([])
  })

  it('should accept a populated staleSummaryPaths array', () => {
    const input = {
      curationsSinceDream: 0,
      lastDreamAt: null,
      lastDreamLogId: null,
      staleSummaryPaths: [
        {enqueuedAt: 1_745_539_200_000, path: 'auth/jwt/token.md'},
        {enqueuedAt: 1_745_546_400_000, path: 'billing/webhooks/stripe.md'},
      ],
      totalDreams: 0,
      version: 1,
    }
    const result = DreamStateSchema.parse(input)
    expect(result.staleSummaryPaths).to.have.lengthOf(2)
  })
})
})
