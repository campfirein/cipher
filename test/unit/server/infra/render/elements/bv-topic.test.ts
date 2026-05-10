/**
 * bv-topic validator tests.
 *
 * The root container element. Carries file-level metadata as attributes:
 *   - `path` — required; non-empty string identifying the topic
 *   - `importance` — optional; integer string "0".."100"
 *   - `maturity` — optional; one of {"draft","validated","core"}
 *   - `recency` — optional; numeric string "0".."1"
 *   - `updatedat` — optional; ISO-8601 datetime
 *
 * Light validation per M1 (ADR-007 §13 strict validation is M2).
 * Unknown attributes are tolerated (warn-only behaviour); test confirms
 * tolerance, not absence.
 */

import {expect} from 'chai'

import type {ElementNode} from '../../../../../../src/server/core/domain/render/element-types.js'

import {validateBvTopic} from '../../../../../../src/server/infra/render/elements/bv-topic/validator.js'

function makeNode(attributes: Record<string, string>, tagName = 'bv-topic'): ElementNode {
  return {attributes, children: [], tagName, type: 'element'}
}

describe('bv-topic validator', () => {
  describe('valid', () => {
    it('accepts the minimum: only `path` set', () => {
      const result = validateBvTopic(makeNode({path: 'security/auth'}))
      expect(result.valid).to.equal(true)
    })

    it('accepts all optional attributes set together', () => {
      const result = validateBvTopic(makeNode({
        importance: '89',
        maturity: 'core',
        path: 'security/auth',
        recency: '0.97',
        updatedat: '2026-04-27T08:17:42Z',
      }))
      expect(result.valid).to.equal(true)
    })

    it('tolerates unknown attributes (warn-only — M1 light validation)', () => {
      const result = validateBvTopic(makeNode({path: 'x', someFutureAttr: 'whatever'}))
      expect(result.valid).to.equal(true)
    })

    it('accepts importance = "0"', () => {
      const result = validateBvTopic(makeNode({importance: '0', path: 'x'}))
      expect(result.valid).to.equal(true)
    })

    it('accepts importance = "100"', () => {
      const result = validateBvTopic(makeNode({importance: '100', path: 'x'}))
      expect(result.valid).to.equal(true)
    })
  })

  describe('invalid', () => {
    it('rejects missing `path`', () => {
      const result = validateBvTopic(makeNode({}))
      expect(result.valid).to.equal(false)
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'path')).to.equal(true)
      }
    })

    it('rejects empty `path`', () => {
      const result = validateBvTopic(makeNode({path: ''}))
      expect(result.valid).to.equal(false)
    })

    it('rejects non-numeric importance', () => {
      const result = validateBvTopic(makeNode({importance: 'high', path: 'x'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects out-of-range importance (>100)', () => {
      const result = validateBvTopic(makeNode({importance: '101', path: 'x'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects out-of-range importance (negative)', () => {
      const result = validateBvTopic(makeNode({importance: '-1', path: 'x'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects unknown maturity tier', () => {
      const result = validateBvTopic(makeNode({maturity: 'experimental', path: 'x'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects malformed updatedat', () => {
      const result = validateBvTopic(makeNode({path: 'x', updatedat: 'yesterday'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects non-numeric recency', () => {
      const result = validateBvTopic(makeNode({path: 'x', recency: 'high'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects recency outside [0, 1]', () => {
      const result = validateBvTopic(makeNode({path: 'x', recency: '1.5'}))
      expect(result.valid).to.equal(false)
    })

    it('rejects wrong tag name (defensive — registry should never call wrong validator)', () => {
      const result = validateBvTopic(makeNode({path: 'x'}, 'bv-rule'))
      expect(result.valid).to.equal(false)
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'tagName')).to.equal(true)
      }
    })
  })
})
