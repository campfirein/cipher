import {expect} from 'chai'

import {
  canRespondDirectly,
  DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD,
  DIRECT_RESPONSE_MIN_GAP,
  DIRECT_RESPONSE_SCORE_THRESHOLD,
  type DirectSearchResult,
  formatDirectResponse,
  formatNotFoundResponse,
} from '../../../../src/server/infra/executor/direct-search-responder.js'

function makeResult(score: number, title = 'Test'): DirectSearchResult {
  return {content: `Content for ${title}`, path: `test/${title.toLowerCase()}.md`, score, title}
}

describe('Direct Search Responder', () => {
  describe('canRespondDirectly', () => {
    it('should return false for empty results', () => {
      expect(canRespondDirectly([])).to.be.false
    })

    it('should return false when top score is below threshold', () => {
      const results = [makeResult(DIRECT_RESPONSE_SCORE_THRESHOLD - 0.01)]
      expect(canRespondDirectly(results)).to.be.false
    })

    it('should return true for single result at threshold', () => {
      const results = [makeResult(DIRECT_RESPONSE_SCORE_THRESHOLD)]
      expect(canRespondDirectly(results)).to.be.true
    })

    it('should return true for single result above threshold', () => {
      const results = [makeResult(0.9)]
      expect(canRespondDirectly(results)).to.be.true
    })

    it('should return true when top score is high-confidence (skip dominance check)', () => {
      const results = [
        makeResult(DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD),
        makeResult(DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD - 0.01),
      ]
      expect(canRespondDirectly(results)).to.be.true
    })

    it('should return true when gap between top and second is sufficient', () => {
      // Use values with clear gap above DIRECT_RESPONSE_MIN_GAP (0.08)
      const results = [makeResult(0.92), makeResult(0.82)]
      expect(canRespondDirectly(results)).to.be.true
    })

    it('should return false when gap between top and second is too small', () => {
      // Gap of 0.02 is well below DIRECT_RESPONSE_MIN_GAP (0.08)
      const results = [makeResult(0.88), makeResult(0.86)]
      expect(canRespondDirectly(results)).to.be.false
    })

    it('should return true when second score is zero', () => {
      const results = [makeResult(0.9), makeResult(0)]
      expect(canRespondDirectly(results)).to.be.true
    })

    it('should handle multiple results with clear separation', () => {
      const results = [makeResult(0.92), makeResult(0.8), makeResult(0.75)]
      expect(canRespondDirectly(results)).to.be.true
    })

    it('should handle multiple results clustered together', () => {
      const results = [makeResult(0.87), makeResult(0.86), makeResult(0.85)]
      expect(canRespondDirectly(results)).to.be.false
    })

    describe('threshold values are in normalized [0, 1) range', () => {
      it('DIRECT_RESPONSE_SCORE_THRESHOLD should be in [0, 1)', () => {
        expect(DIRECT_RESPONSE_SCORE_THRESHOLD).to.be.greaterThan(0)
        expect(DIRECT_RESPONSE_SCORE_THRESHOLD).to.be.lessThan(1)
      })

      it('DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD should be in [0, 1)', () => {
        expect(DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD).to.be.greaterThan(0)
        expect(DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD).to.be.lessThan(1)
      })

      it('DIRECT_RESPONSE_MIN_GAP should be positive and small', () => {
        expect(DIRECT_RESPONSE_MIN_GAP).to.be.greaterThan(0)
        expect(DIRECT_RESPONSE_MIN_GAP).to.be.lessThan(0.5)
      })
    })
  })

  describe('formatDirectResponse', () => {
    it('should include summary, details, sources and gaps sections', () => {
      const results = [makeResult(0.9, 'Auth')]
      const response = formatDirectResponse('auth patterns', results)

      expect(response).to.include('**Summary**')
      expect(response).to.include('**Details**')
      expect(response).to.include('**Sources**')
      expect(response).to.include('**Gaps**')
    })

    it('should include document content in details', () => {
      const results = [makeResult(0.9, 'Auth')]
      const response = formatDirectResponse('auth', results)

      expect(response).to.include('Content for Auth')
    })

    it('should include source paths', () => {
      const results = [makeResult(0.9, 'Auth')]
      const response = formatDirectResponse('auth', results)

      expect(response).to.include('.brv/context-tree/test/auth.md')
    })
  })

  describe('formatNotFoundResponse', () => {
    it('should include the query in the response', () => {
      const response = formatNotFoundResponse('quantum physics')
      expect(response).to.include('quantum physics')
    })

    it('should indicate no sources', () => {
      const response = formatNotFoundResponse('test')
      expect(response).to.include('None')
    })
  })
})
