import {expect} from 'chai'

import type {NodeSlot} from '../../../../../src/agent/core/curation/flow/types.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {NODE_SLOT_ORDER} from '../../../../../src/agent/core/curation/flow/types.js'

describe('slotContracts', () => {
  describe('completeness', () => {
    it('defines a contract for every NodeSlot', () => {
      for (const slot of NODE_SLOT_ORDER) {
        expect(slotContracts[slot], `missing contract for slot "${slot}"`).to.exist
      }
    })

    it('every contract has inputSchema, outputSchema, toolAllowlist, timeoutMs', () => {
      for (const slot of NODE_SLOT_ORDER) {
        const contract = slotContracts[slot]
        expect(contract.inputSchema, `${slot}.inputSchema`).to.exist
        expect(contract.outputSchema, `${slot}.outputSchema`).to.exist
        expect(contract.toolAllowlist, `${slot}.toolAllowlist`).to.be.an('array')
        expect(contract.timeoutMs, `${slot}.timeoutMs`).to.be.a('number').greaterThan(0)
      }
    })
  })

  describe('schema round-trips', () => {
    // Slot inputs now MIRROR the predecessor slot's output shape (so slots
    // chain cleanly through the runner). recon's input is the user's
    // initial input; the rest each take the preceding slot's output.
    const reconOutFixture = {
      headPreview: 'sample',
      history: {domains: {}, totalProcessed: 0},
      meta: {charCount: 11, lineCount: 1, messageCount: 0},
      suggestedChunkCount: 1,
      suggestedMode: 'single-pass' as const,
      tailPreview: 'text',
    }

    const chunkOutFixture = {
      boundaries: [{end: 11, start: 0}],
      chunks: ['sample text'],
      totalChunks: 1,
    }

    const extractOutFixture = {
      facts: [{statement: 'JWT expires in 24h', subject: 'auth'}],
      failed: 0,
      succeeded: 1,
      total: 1,
    }

    const groupOutFixture = {
      grouped: {auth: [{statement: 'JWT expires', subject: 'auth'}]},
    }

    const dedupOutFixture = {
      deduped: [{statement: 'JWT expires', subject: 'auth'}],
    }

    const conflictOutFixture = {
      decisions: [
        {action: 'add' as const, fact: {statement: 'JWT expires in 24h', subject: 'auth'}},
      ],
    }

    const writeOutFixture = {
      applied: [],
      summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    }

    const fixtures: Record<NodeSlot, {input: unknown; output: unknown}> = {
      chunk: {input: reconOutFixture, output: chunkOutFixture},
      conflict: {input: dedupOutFixture, output: conflictOutFixture},
      dedup: {input: groupOutFixture, output: dedupOutFixture},
      extract: {input: chunkOutFixture, output: extractOutFixture},
      group: {input: extractOutFixture, output: groupOutFixture},
      recon: {
        input: {context: 'sample text', history: {}, meta: {}},
        output: reconOutFixture,
      },
      write: {
        input: {
          decisions: [
            {action: 'add', fact: {statement: 'JWT expires', subject: 'auth'}},
          ],
        },
        output: writeOutFixture,
      },
    }

    for (const slot of NODE_SLOT_ORDER) {
      it(`${slot}: inputSchema accepts valid fixture`, () => {
        const result = slotContracts[slot].inputSchema.safeParse(fixtures[slot].input)
        if (!result.success) {
          throw new Error(`${slot} input parse failed: ${JSON.stringify(result.error.issues, null, 2)}`)
        }
      })

      it(`${slot}: outputSchema accepts valid fixture`, () => {
        const result = slotContracts[slot].outputSchema.safeParse(fixtures[slot].output)
        if (!result.success) {
          throw new Error(`${slot} output parse failed: ${JSON.stringify(result.error.issues, null, 2)}`)
        }
      })
    }
  })

  describe('schema rejects invalid input', () => {
    it('extract.outputSchema rejects facts missing the statement field', () => {
      const result = slotContracts.extract.outputSchema.safeParse({
        facts: [{subject: 'auth'}],
      })
      expect(result.success).to.be.false
      if (!result.success) {
        const paths = result.error.issues.map((issue: {path: ReadonlyArray<number | string>}) =>
          issue.path.join('.'),
        )
        expect(paths.some((p: string) => p.includes('statement'))).to.be.true
      }
    })

    it('recon.outputSchema rejects unknown suggestedMode value', () => {
      const result = slotContracts.recon.outputSchema.safeParse({
        headPreview: '',
        history: {domains: {}, totalProcessed: 0},
        meta: {charCount: 0, lineCount: 0, messageCount: 0},
        suggestedChunkCount: 1,
        suggestedMode: 'whatever',
        tailPreview: '',
      })
      expect(result.success).to.be.false
    })

    it('write.outputSchema rejects non-array applied field', () => {
      const result = slotContracts.write.outputSchema.safeParse({
        applied: 'not-an-array',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
      })
      expect(result.success).to.be.false
    })

    it('write.outputSchema rejects missing summary field', () => {
      const result = slotContracts.write.outputSchema.safeParse({
        applied: [],
      })
      expect(result.success).to.be.false
    })

    it('extract.outputSchema requires succeeded/failed/total counts', () => {
      const result = slotContracts.extract.outputSchema.safeParse({
        facts: [],
      })
      expect(result.success).to.be.false
    })

    it('write.outputSchema accepts a realistic OperationResult shape', () => {
      // Mirrors what executeCurate() actually returns
      // (curate-tool.ts:403 OperationResult).
      const result = slotContracts.write.outputSchema.safeParse({
        applied: [
          {
            confidence: 'high',
            filePath: '/abs/path/to/file.md',
            impact: 'low',
            message: 'Created',
            needsReview: false,
            path: 'auth/jwt.md',
            reason: 'Documenting JWT expiry',
            status: 'success',
            summary: 'JWT tokens expire in 24h',
            type: 'ADD',
          },
        ],
        summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0},
      })
      if (!result.success) {
        throw new Error(`expected success, got: ${JSON.stringify(result.error.issues, null, 2)}`)
      }
    })

    it('write.outputSchema rejects status values other than success/failed', () => {
      const result = slotContracts.write.outputSchema.safeParse({
        applied: [
          {
            confidence: 'high',
            impact: 'low',
            needsReview: false,
            path: 'auth/jwt.md',
            reason: 'x',
            status: 'pending', // not a real status
            type: 'ADD',
          },
        ],
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
      })
      expect(result.success).to.be.false
    })

    it('write.outputSchema rejects applied op missing required confidence/impact/needsReview/reason', () => {
      const result = slotContracts.write.outputSchema.safeParse({
        applied: [
          {
            path: 'auth/jwt.md',
            status: 'success',
            type: 'ADD',
          },
        ],
        summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0},
      })
      expect(result.success).to.be.false
      if (!result.success) {
        const missing = new Set(
          result.error.issues.map((i: {path: ReadonlyArray<number | string>}) => i.path.join('.')),
        )
        expect(missing.has('applied.0.confidence')).to.be.true
        expect(missing.has('applied.0.impact')).to.be.true
        expect(missing.has('applied.0.needsReview')).to.be.true
        expect(missing.has('applied.0.reason')).to.be.true
      }
    })
  })

  describe('tool allowlists', () => {
    it('pure-JS slots (chunk, group, dedup) have empty allowlist', () => {
      expect(slotContracts.chunk.toolAllowlist).to.deep.equal([])
      expect(slotContracts.group.toolAllowlist).to.deep.equal([])
    })

    it('extract slot allows tools.curation.mapExtract', () => {
      expect(slotContracts.extract.toolAllowlist).to.include('tools.curation.mapExtract')
    })

    it('write slot allows tools.curate', () => {
      expect(slotContracts.write.toolAllowlist).to.include('tools.curate')
    })
  })
})
