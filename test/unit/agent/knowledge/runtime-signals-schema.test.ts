import {expect} from 'chai'

import {
  createDefaultRuntimeSignals,
  DEFAULT_ACCESS_COUNT,
  DEFAULT_IMPORTANCE,
  DEFAULT_MATURITY,
  DEFAULT_RECENCY,
  DEFAULT_UPDATE_COUNT,
  RuntimeSignalsSchema,
} from '../../../../src/server/core/domain/knowledge/runtime-signals-schema.js'

describe('runtime-signals-schema', () => {
  describe('RuntimeSignalsSchema', () => {
    it('accepts a fully populated record', () => {
      const result = RuntimeSignalsSchema.parse({
        accessCount: 5,
        importance: 72,
        maturity: 'validated',
        recency: 0.8,
        updateCount: 2,
      })

      expect(result).to.deep.equal({
        accessCount: 5,
        importance: 72,
        maturity: 'validated',
        recency: 0.8,
        updateCount: 2,
      })
    })

    it('fills missing fields with defaults when parsing an empty object', () => {
      const result = RuntimeSignalsSchema.parse({})

      expect(result).to.deep.equal({
        accessCount: DEFAULT_ACCESS_COUNT,
        importance: DEFAULT_IMPORTANCE,
        maturity: DEFAULT_MATURITY,
        recency: DEFAULT_RECENCY,
        updateCount: DEFAULT_UPDATE_COUNT,
      })
    })

    it('rejects importance above 100', () => {
      expect(() => RuntimeSignalsSchema.parse({importance: 101})).to.throw()
    })

    it('rejects importance below 0', () => {
      expect(() => RuntimeSignalsSchema.parse({importance: -1})).to.throw()
    })

    it('rejects recency above 1', () => {
      expect(() => RuntimeSignalsSchema.parse({recency: 1.5})).to.throw()
    })

    it('rejects recency below 0', () => {
      expect(() => RuntimeSignalsSchema.parse({recency: -0.1})).to.throw()
    })

    it('rejects unknown maturity tier', () => {
      expect(() => RuntimeSignalsSchema.parse({maturity: 'mature'})).to.throw()
    })

    it('rejects non-integer accessCount', () => {
      expect(() => RuntimeSignalsSchema.parse({accessCount: 3.5})).to.throw()
    })

    it('rejects negative accessCount', () => {
      expect(() => RuntimeSignalsSchema.parse({accessCount: -1})).to.throw()
    })

    it('rejects non-integer updateCount', () => {
      expect(() => RuntimeSignalsSchema.parse({updateCount: 3.5})).to.throw()
    })

    it('rejects negative updateCount', () => {
      expect(() => RuntimeSignalsSchema.parse({updateCount: -1})).to.throw()
    })
  })

  describe('createDefaultRuntimeSignals', () => {
    it('returns a record with default values for all fields', () => {
      const defaults = createDefaultRuntimeSignals()

      expect(defaults).to.deep.equal({
        accessCount: DEFAULT_ACCESS_COUNT,
        importance: DEFAULT_IMPORTANCE,
        maturity: DEFAULT_MATURITY,
        recency: DEFAULT_RECENCY,
        updateCount: DEFAULT_UPDATE_COUNT,
      })
    })

    it('returns a fresh object on each call (not a shared reference)', () => {
      const a = createDefaultRuntimeSignals()
      const b = createDefaultRuntimeSignals()

      a.importance = 99
      expect(b.importance).to.equal(DEFAULT_IMPORTANCE)
    })

    it('returns values that satisfy the schema', () => {
      const defaults = createDefaultRuntimeSignals()
      expect(() => RuntimeSignalsSchema.parse(defaults)).to.not.throw()
    })
  })
})
