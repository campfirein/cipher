import {expect} from 'chai'
import {type SinonFakeTimers, useFakeTimers} from 'sinon'

import {parseTimeFilter} from '../../../../src/oclif/lib/time-filter.js'

describe('parseTimeFilter', () => {
  let clock: SinonFakeTimers

  beforeEach(() => {
    // Fix Date.now() to a known value for deterministic relative-time tests
    clock = useFakeTimers({now: 1_700_000_000_000, toFake: ['Date']})
  })

  afterEach(() => {
    clock.restore()
  })

  // ==========================================================================
  // Relative time parsing
  // ==========================================================================

  describe('relative time', () => {
    it('should parse minutes ("30m")', () => {
      const result = parseTimeFilter('30m')
      expect(result).to.equal(1_700_000_000_000 - 30 * 60_000)
    })

    it('should parse hours ("1h")', () => {
      const result = parseTimeFilter('1h')
      expect(result).to.equal(1_700_000_000_000 - 1 * 3_600_000)
    })

    it('should parse "24h"', () => {
      const result = parseTimeFilter('24h')
      expect(result).to.equal(1_700_000_000_000 - 24 * 3_600_000)
    })

    it('should parse days ("7d")', () => {
      const result = parseTimeFilter('7d')
      expect(result).to.equal(1_700_000_000_000 - 7 * 86_400_000)
    })

    it('should parse weeks ("2w")', () => {
      const result = parseTimeFilter('2w')
      expect(result).to.equal(1_700_000_000_000 - 2 * 604_800_000)
    })

    it('should handle "0m" as Date.now()', () => {
      const result = parseTimeFilter('0m')
      expect(result).to.equal(1_700_000_000_000)
    })

    it('should handle large values ("999d")', () => {
      const result = parseTimeFilter('999d')
      expect(result).to.equal(1_700_000_000_000 - 999 * 86_400_000)
    })
  })

  // ==========================================================================
  // Absolute time parsing
  // ==========================================================================

  describe('absolute time', () => {
    it('should parse ISO date ("2024-01-15")', () => {
      const result = parseTimeFilter('2024-01-15')
      expect(result).to.equal(new Date('2024-01-15').getTime())
    })

    it('should parse ISO datetime ("2024-01-15T12:00:00Z")', () => {
      const result = parseTimeFilter('2024-01-15T12:00:00Z')
      expect(result).to.equal(new Date('2024-01-15T12:00:00Z').getTime())
    })
  })

  // ==========================================================================
  // Invalid input
  // ==========================================================================

  describe('invalid input', () => {
    it('should return undefined for non-parseable string', () => {
      expect(parseTimeFilter('invalid')).to.be.undefined
    })

    it('should return undefined for empty string', () => {
      expect(parseTimeFilter('')).to.be.undefined
    })

    it('should return undefined for partial relative format ("h")', () => {
      expect(parseTimeFilter('h')).to.be.undefined
    })

    it('should return undefined for unsupported unit ("5y")', () => {
      expect(parseTimeFilter('5y')).to.be.undefined
    })
  })
})
