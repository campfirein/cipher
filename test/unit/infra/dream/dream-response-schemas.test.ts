import {expect} from 'chai'

import {
  ConsolidateResponseSchema,
  PruneResponseSchema,
  SynthesizeResponseSchema,
} from '../../../../src/server/infra/dream/dream-response-schemas.js'

describe('dream-response-schemas', () => {
  describe('ConsolidateResponseSchema', () => {
    it('should parse a MERGE action', () => {
      const input = {
        actions: [{
          files: ['a.md', 'b.md'],
          mergedContent: 'combined text',
          outputFile: 'a.md',
          reason: 'duplicate',
          type: 'MERGE',
        }],
      }
      const result = ConsolidateResponseSchema.parse(input)
      expect(result.actions).to.have.lengthOf(1)
      expect(result.actions[0].type).to.equal('MERGE')
    })

    it('should parse a TEMPORAL_UPDATE action', () => {
      const input = {
        actions: [{
          files: ['a.md'],
          reason: 'conflicting dates',
          type: 'TEMPORAL_UPDATE',
          updatedContent: 'Previously X. As of 2026-04: Y.',
        }],
      }
      const result = ConsolidateResponseSchema.parse(input)
      expect(result.actions[0].type).to.equal('TEMPORAL_UPDATE')
    })

    it('should parse a CROSS_REFERENCE action', () => {
      const input = {
        actions: [{
          files: ['a.md', 'b.md'],
          reason: 'related topics',
          type: 'CROSS_REFERENCE',
        }],
      }
      const result = ConsolidateResponseSchema.parse(input)
      expect(result.actions[0].type).to.equal('CROSS_REFERENCE')
    })

    it('should parse a SKIP action', () => {
      const input = {
        actions: [{
          files: ['a.md', 'b.md'],
          reason: 'unrelated',
          type: 'SKIP',
        }],
      }
      const result = ConsolidateResponseSchema.parse(input)
      expect(result.actions[0].type).to.equal('SKIP')
    })

    it('should reject empty files array', () => {
      const input = {
        actions: [{
          files: [],
          reason: 'test',
          type: 'MERGE',
        }],
      }
      expect(() => ConsolidateResponseSchema.parse(input)).to.throw()
    })

    it('should accept empty actions array', () => {
      const result = ConsolidateResponseSchema.parse({actions: []})
      expect(result.actions).to.have.lengthOf(0)
    })
  })

  describe('SynthesizeResponseSchema', () => {
    it('should parse valid synthesis with all fields', () => {
      const input = {
        syntheses: [{
          claim: 'Both use JWT tokens',
          confidence: 0.85,
          evidence: [
            {domain: 'auth', fact: 'uses JWT for session management'},
            {domain: 'api', fact: 'validates JWT in middleware'},
          ],
          keywords: ['jwt', 'auth'],
          placement: 'api',
          summary: 'Shared JWT validation across auth and api.',
          tags: ['auth', 'api'],
          title: 'Shared auth pattern',
        }],
      }
      const result = SynthesizeResponseSchema.parse(input)
      expect(result.syntheses).to.have.lengthOf(1)
      expect(result.syntheses[0].confidence).to.equal(0.85)
    })

    it('should accept empty syntheses array', () => {
      const result = SynthesizeResponseSchema.parse({syntheses: []})
      expect(result.syntheses).to.have.lengthOf(0)
    })

    it('should reject confidence below 0', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: -0.1,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: [],
          placement: 'a',
          summary: '',
          tags: [],
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.throw()
    })

    it('should reject confidence above 1', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: 1.1,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: [],
          placement: 'a',
          summary: '',
          tags: [],
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.throw()
    })

    it('should accept confidence at boundary 0.0', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: 0,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: [],
          placement: 'a',
          summary: '',
          tags: [],
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.not.throw()
    })

    it('should accept confidence at boundary 1.0', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: 1,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: [],
          placement: 'a',
          summary: '',
          tags: [],
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.not.throw()
    })

    it('should reject summary longer than 500 characters', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: 0.5,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: [],
          placement: 'a',
          summary: 'x'.repeat(501),
          tags: [],
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.throw()
    })

    it('should reject tags array longer than 8 entries', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: 0.5,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: [],
          placement: 'a',
          summary: '',
          tags: Array.from({length: 9}, (_, i) => `tag-${i}`),
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.throw()
    })

    it('should reject keywords array longer than 15 entries', () => {
      const input = {
        syntheses: [{
          claim: 'test',
          confidence: 0.5,
          evidence: [{domain: 'a', fact: 'f'}],
          keywords: Array.from({length: 16}, (_, i) => `kw-${i}`),
          placement: 'a',
          summary: '',
          tags: [],
          title: 'test',
        }],
      }
      expect(() => SynthesizeResponseSchema.parse(input)).to.throw()
    })
  })

  describe('PruneResponseSchema', () => {
    it('should parse an ARCHIVE decision', () => {
      const input = {
        decisions: [{
          decision: 'ARCHIVE',
          file: 'domain/stale.md',
          reason: 'superseded',
        }],
      }
      const result = PruneResponseSchema.parse(input)
      expect(result.decisions[0].decision).to.equal('ARCHIVE')
    })

    it('should parse a KEEP decision', () => {
      const input = {
        decisions: [{
          decision: 'KEEP',
          file: 'domain/important.md',
          reason: 'still useful',
        }],
      }
      const result = PruneResponseSchema.parse(input)
      expect(result.decisions[0].decision).to.equal('KEEP')
    })

    it('should parse a MERGE_INTO decision with mergeTarget', () => {
      const input = {
        decisions: [{
          decision: 'MERGE_INTO',
          file: 'domain/old.md',
          mergeTarget: 'domain/target.md',
          reason: 'overlapping content',
        }],
      }
      const result = PruneResponseSchema.parse(input)
      expect(result.decisions[0].decision).to.equal('MERGE_INTO')
      expect(result.decisions[0].mergeTarget).to.equal('domain/target.md')
    })

    it('should accept MERGE_INTO without mergeTarget (optional)', () => {
      const input = {
        decisions: [{
          decision: 'MERGE_INTO',
          file: 'domain/old.md',
          reason: 'overlapping',
        }],
      }
      const result = PruneResponseSchema.parse(input)
      expect(result.decisions[0].mergeTarget).to.be.undefined
    })

    it('should accept empty decisions array', () => {
      const result = PruneResponseSchema.parse({decisions: []})
      expect(result.decisions).to.have.lengthOf(0)
    })
  })
})
