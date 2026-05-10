/**
 * Element registry tests.
 *
 * The registry is the single source of truth for the M1 element
 * vocabulary. Every consumer (curate writer, query reader, prompt
 * template generator) walks the registry generically. M2 vocabulary
 * expansion is purely additive — new entries only.
 */

import {expect} from 'chai'

import type {ElementName, ElementNode} from '../../../../../../src/server/core/domain/render/element-types.js'

import {ELEMENT_NAMES} from '../../../../../../src/server/core/domain/render/element-types.js'
import {ELEMENT_REGISTRY} from '../../../../../../src/server/infra/render/elements/registry.js'

function makeNode(tagName: string, attributes: Record<string, string> = {}): ElementNode {
  return {attributes, children: [], tagName, type: 'element'}
}

describe('ELEMENT_REGISTRY', () => {
  describe('shape', () => {
    it('contains exactly 5 entries (M1 vocabulary)', () => {
      expect(Object.keys(ELEMENT_REGISTRY)).to.have.lengthOf(5)
    })

    it('has one entry per `ElementName` listed in `ELEMENT_NAMES`', () => {
      for (const name of ELEMENT_NAMES) {
        expect(ELEMENT_REGISTRY[name], `expected entry for ${name}`).to.not.equal(undefined)
      }
    })

    it('every entry exposes `name`, `validator`, `description`, `requiredAttributes`, `optionalAttributes`, `allowedChildren`', () => {
      for (const name of ELEMENT_NAMES) {
        const entry = ELEMENT_REGISTRY[name]
        expect(entry.name).to.equal(name)
        expect(typeof entry.validator).to.equal('function')
        expect(typeof entry.description).to.equal('string')
        expect(entry.description.length).to.be.greaterThan(0)
        expect(Array.isArray(entry.requiredAttributes)).to.equal(true)
        expect(Array.isArray(entry.optionalAttributes)).to.equal(true)
        expect(['any', 'block', 'inline', 'none']).to.include(entry.allowedChildren)
      }
    })
  })

  describe('validators are wired correctly', () => {
    it('bv-topic validator accepts a valid bv-topic node', () => {
      const result = ELEMENT_REGISTRY['bv-topic'].validator(makeNode('bv-topic', {path: 'x'}))
      expect(result.valid).to.equal(true)
    })

    it('bv-topic validator rejects a wrong-tag node', () => {
      const result = ELEMENT_REGISTRY['bv-topic'].validator(makeNode('bv-rule'))
      expect(result.valid).to.equal(false)
    })

    it('bv-rule validator accepts an empty bv-rule node', () => {
      const result = ELEMENT_REGISTRY['bv-rule'].validator(makeNode('bv-rule'))
      expect(result.valid).to.equal(true)
    })

    it('bv-decision validator accepts a bv-decision node with id', () => {
      const result = ELEMENT_REGISTRY['bv-decision'].validator(makeNode('bv-decision', {id: 'd1'}))
      expect(result.valid).to.equal(true)
    })

    it('bv-bug validator accepts a bv-bug node with severity', () => {
      const result = ELEMENT_REGISTRY['bv-bug'].validator(makeNode('bv-bug', {severity: 'high'}))
      expect(result.valid).to.equal(true)
    })

    it('bv-fix validator accepts a bv-fix node', () => {
      const result = ELEMENT_REGISTRY['bv-fix'].validator(makeNode('bv-fix'))
      expect(result.valid).to.equal(true)
    })
  })

  describe('metadata for downstream consumers', () => {
    it('bv-topic declares `path` as a required attribute', () => {
      expect(ELEMENT_REGISTRY['bv-topic'].requiredAttributes).to.include('path')
    })

    it('bv-rule declares `severity` as an optional attribute', () => {
      expect(ELEMENT_REGISTRY['bv-rule'].optionalAttributes).to.include('severity')
    })

    it('bv-bug declares `severity` as an optional attribute', () => {
      expect(ELEMENT_REGISTRY['bv-bug'].optionalAttributes).to.include('severity')
    })

    it('every element has a non-trivial description for the prompt template generator', () => {
      for (const name of ELEMENT_NAMES) {
        expect(ELEMENT_REGISTRY[name].description.length).to.be.greaterThan(20)
      }
    })
  })

  describe('readonly contract', () => {
    it('registry is structurally Readonly<Record<ElementName, ElementSchema>>', () => {
      // Compile-time guard via the type. Runtime sanity check: keys are exactly ELEMENT_NAMES.
      const keys = Object.keys(ELEMENT_REGISTRY).sort() as ElementName[]
      const expected = [...ELEMENT_NAMES].sort()
      expect(keys).to.deep.equal(expected)
    })
  })
})
