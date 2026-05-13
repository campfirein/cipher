/**
 * query-retrieval tests — T1 (ENG-2811) placeholder surface.
 *
 * Locks the wire-envelope shape that SKILL.md (T4 / ENG-2814) will
 * key off. Once T4 ships against this contract, renaming a key here
 * is a breaking change.
 *
 * T2 (ENG-2812) replaces `runRetrievalPlaceholder` with a real
 * `SearchKnowledgeService` call; the envelope shape contract carried
 * by these tests stays stable across the swap.
 */

import {expect} from 'chai'

import {
  type QueryToolModeEnvelope,
  runRetrievalPlaceholder,
} from '../../../../src/oclif/lib/query-retrieval.js'

describe('query-retrieval (T1 placeholder)', () => {
  describe('runRetrievalPlaceholder', () => {
    it('always returns an empty-matches results envelope', async () => {
      const envelope = await runRetrievalPlaceholder({
        limit: 10,
        projectRoot: '/tmp/anywhere',
        query: 'anything',
      })

      expect(envelope.ok).to.be.true
      expect(envelope.status).to.equal('results')
      expect(envelope.matches).to.deep.equal([])
      expect(envelope.synthesisPrompt).to.be.undefined
      expect(envelope.errors).to.be.undefined
    })

    it('ignores the projectRoot argument at the placeholder stage (T2 wires real retrieval)', async () => {
      const envelopeA = await runRetrievalPlaceholder({
        limit: 1,
        projectRoot: '/dev/null',
        query: 'a',
      })
      const envelopeB = await runRetrievalPlaceholder({
        limit: 50,
        projectRoot: '/nonexistent/path',
        query: 'b',
      })

      expect(envelopeA).to.deep.equal(envelopeB)
    })

    it('returns a Promise', () => {
      const result = runRetrievalPlaceholder({
        limit: 10,
        projectRoot: '/tmp',
        query: 'x',
      })
      expect(result).to.be.instanceOf(Promise)
    })
  })

  describe('envelope-shape contract', () => {
    /**
     * These cases instantiate every valid envelope shape to assert
     * the type definition admits them. Catches accidental
     * tightening of `QueryToolModeEnvelope` that would break the
     * documented protocol surface.
     */
    it('admits a results envelope with empty matches', () => {
      const envelope: QueryToolModeEnvelope = {
        matches: [],
        ok: true,
        status: 'results',
      }
      expect(envelope.status).to.equal('results')
    })

    it('admits a results envelope with populated matches + synthesisPrompt', () => {
      const envelope: QueryToolModeEnvelope = {
        matches: [
          {
            format: 'html',
            path: 'security/auth.html',
            rawContent: '<bv-topic path="security/auth"></bv-topic>',
            renderedContent: '# Authentication',
            score: 0.847,
          },
          {
            format: 'markdown',
            path: 'legacy/notes.md',
            rawContent: '# Old notes',
            renderedContent: '# Old notes',
            score: 0.412,
          },
        ],
        ok: true,
        status: 'results',
        synthesisPrompt: 'Use only the matches below…',
      }
      expect(envelope.matches).to.have.lengthOf(2)
      expect(envelope.matches?.[0].format).to.equal('html')
      expect(envelope.matches?.[1].format).to.equal('markdown')
    })

    it('admits a failed envelope with missing-query error', () => {
      const envelope: QueryToolModeEnvelope = {
        errors: [{kind: 'missing-query', message: 'Tool-mode query requires a question argument.'}],
        ok: false,
        status: 'failed',
      }
      expect(envelope.status).to.equal('failed')
      expect(envelope.errors?.[0].kind).to.equal('missing-query')
    })

    it('admits the reserved error kinds T2 will use', () => {
      // index-unavailable is the kind T2 will emit when
      // SearchKnowledgeService cannot load the BM25 index. Asserting
      // it compiles today means T2 can wire it without revisiting
      // the protocol surface.
      const envelope: QueryToolModeEnvelope = {
        errors: [{kind: 'index-unavailable', message: 'Index missing.'}],
        ok: false,
        status: 'failed',
      }
      expect(envelope.errors?.[0].kind).to.equal('index-unavailable')
    })
  })
})
