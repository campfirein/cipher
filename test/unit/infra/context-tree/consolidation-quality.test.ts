import {expect} from 'chai'

import {ConsolidationQualityEvaluator} from '../../../../src/server/infra/context-tree/consolidation-quality.js'

describe('ConsolidationQualityEvaluator', () => {
  describe('evaluate()', () => {
    it('should score high dedup quality when consolidated bullets are unique', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = [
        'Use read_file to check configs',
        'Always use read_file to check configs',
        'Check database connections before deploy',
      ]
      const consolidated = [
        'Use read_file to check configs',
        'Check database connections before deploy',
      ]

      const result = evaluator.evaluate(original, consolidated)

      expect(result.dimensions.deduplicationQuality).to.be.greaterThan(0.5)
    })

    it('should score low dedup quality when consolidated bullets are near-duplicates', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = ['Use read_file to check', 'Always use read_file to check', 'Use read_file for checking']
      // Consolidated still has near-duplicates
      const consolidated = ['Use read_file to check', 'Always use read_file to check']

      const result = evaluator.evaluate(original, consolidated)

      // High similarity between remaining bullets = lower dedup score
      expect(result.dimensions.deduplicationQuality).to.be.lessThan(0.5)
    })

    it('should score high coverage when vocabulary is preserved', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = [
        'Use read_file for configuration',
        'Check database connections',
        'Run tests before deploy',
      ]
      const consolidated = [
        'Use read_file for configuration and check database connections',
        'Run tests before deploy',
      ]

      const result = evaluator.evaluate(original, consolidated)

      expect(result.dimensions.coverageRecall).to.be.greaterThan(0.8)
    })

    it('should score low coverage when bullets are aggressively deleted', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = [
        'Use read_file for configuration',
        'Check database connections',
        'Run tests before deploy',
        'Monitor logs after release',
      ]
      // Only one bullet kept — most vocabulary lost
      const consolidated = ['Use read_file for configuration']

      const result = evaluator.evaluate(original, consolidated)

      expect(result.dimensions.coverageRecall).to.be.lessThan(0.5)
    })

    it('should score high actionability when bullets start with action verbs', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = ['Use caching', 'Avoid mutations', 'Check logs']
      const consolidated = ['Use caching for performance', 'Avoid state mutations', 'Check logs daily']

      const result = evaluator.evaluate(original, consolidated)

      expect(result.dimensions.actionability).to.equal(1)
    })

    it('should score low actionability when bullets lack action verbs', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = ['Config is complex', 'Database slow']
      const consolidated = ['The configuration is complex', 'Database performance is slow']

      const result = evaluator.evaluate(original, consolidated)

      expect(result.dimensions.actionability).to.equal(0)
    })

    it('should compute weighted overall score', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const original = ['Use caching', 'Avoid mutations']
      const consolidated = ['Use caching', 'Avoid mutations']

      const result = evaluator.evaluate(original, consolidated)

      // Perfect dedup (unique), perfect coverage, perfect actionability
      expect(result.overallScore).to.be.greaterThan(0.7)
    })

    it('should handle empty consolidated list', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const result = evaluator.evaluate(['bullet1', 'bullet2'], [])

      expect(result.dimensions.coverageRecall).to.equal(0)
      expect(result.dimensions.actionability).to.equal(1) // vacuously true
    })

    it('should handle single consolidated bullet', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      const result = evaluator.evaluate(['Use caching'], ['Use caching'])

      expect(result.dimensions.deduplicationQuality).to.equal(1) // only 1 bullet = no pairs
    })
  })

  describe('shouldTerminate()', () => {
    it('should terminate when quality threshold is met', () => {
      const evaluator = new ConsolidationQualityEvaluator({qualityThreshold: 0.75})

      expect(evaluator.shouldTerminate(0.8, undefined, 1)).to.be.true
    })

    it('should terminate when max rounds reached', () => {
      const evaluator = new ConsolidationQualityEvaluator({maxRounds: 3})

      expect(evaluator.shouldTerminate(0.5, 0.4, 3)).to.be.true
    })

    it('should terminate on plateau (improvement < epsilon)', () => {
      const evaluator = new ConsolidationQualityEvaluator({epsilon: 0.05})

      expect(evaluator.shouldTerminate(0.62, 0.6, 2)).to.be.true
    })

    it('should NOT terminate when improvement is sufficient', () => {
      const evaluator = new ConsolidationQualityEvaluator({epsilon: 0.05, maxRounds: 5, qualityThreshold: 0.9})

      expect(evaluator.shouldTerminate(0.7, 0.5, 2)).to.be.false
    })

    it('should NOT terminate on first round with no previous score', () => {
      const evaluator = new ConsolidationQualityEvaluator({maxRounds: 3, qualityThreshold: 0.9})

      expect(evaluator.shouldTerminate(0.5, undefined, 1)).to.be.false
    })
  })

  describe('constructor defaults', () => {
    it('should use default maxRounds of 3', () => {
      const evaluator = new ConsolidationQualityEvaluator()

      expect(evaluator.maxRounds).to.equal(3)
    })

    it('should accept custom options', () => {
      const evaluator = new ConsolidationQualityEvaluator({maxRounds: 5})

      expect(evaluator.maxRounds).to.equal(5)
    })
  })
})
