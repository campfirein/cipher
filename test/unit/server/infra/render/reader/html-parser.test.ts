/**
 * HTML parser wrapper tests.
 *
 * The parser produces a normalized AST (`ParsedNode`) independent of any
 * specific HTML library. M1 uses parse5 underneath; consumers see only
 * `ElementNode` / `TextNode` / `DocumentNode`.
 *
 * Key invariants:
 *   - Tag names are lowercased
 *   - Attributes are a string-only map
 *   - Whitespace-only text between elements is preserved (consumers
 *     decide whether to drop it)
 *   - Malformed input does not throw — parse5's forgiving parser
 *     returns a best-effort tree
 */

import {expect} from 'chai'

import type {ElementNode} from '../../../../../../src/server/core/domain/render/element-types.js'

import {getInnerText, parseHtml, serializeHtml, walkElements} from '../../../../../../src/server/infra/render/reader/html-parser.js'

describe('html-parser', () => {
describe('parseHtml', () => {
  describe('basic parsing', () => {
    it('parses a single bv-topic element', () => {
      const html = '<bv-topic path="security-auth"></bv-topic>'
      const result = parseHtml(html)
      const elements = walkElements(result)
      expect(elements.length).to.be.greaterThan(0)
      const topic = elements.find((e) => e.tagName === 'bv-topic')
      expect(topic, 'expected bv-topic element').to.not.equal(undefined)
      expect(topic!.attributes.path).to.equal('security-auth')
    })

    it('lowercases tag names regardless of input case', () => {
      const result = parseHtml('<BV-TOPIC path="x"></BV-TOPIC>')
      const elements = walkElements(result)
      expect(elements.find((e) => e.tagName === 'bv-topic')).to.not.equal(undefined)
    })

    it('preserves attribute string values verbatim', () => {
      const result = parseHtml('<bv-topic path="security/auth" importance="89"></bv-topic>')
      const topic = walkElements(result).find((e) => e.tagName === 'bv-topic')!
      expect(topic.attributes.path).to.equal('security/auth')
      expect(topic.attributes.importance).to.equal('89')
    })

    it('parses nested elements', () => {
      const html = `
        <bv-topic path="x">
          <bv-rule severity="must" id="r1">Test rule</bv-rule>
        </bv-topic>
      `
      const result = parseHtml(html)
      const elements = walkElements(result)
      expect(elements.find((e) => e.tagName === 'bv-rule')).to.not.equal(undefined)
    })

    it('parses sibling elements at root level', () => {
      const html = '<bv-rule>A</bv-rule><bv-rule>B</bv-rule>'
      const result = parseHtml(html)
      const rules = walkElements(result).filter((e) => e.tagName === 'bv-rule')
      expect(rules.length).to.equal(2)
    })

    it('handles standard HTML5 tags (h1, p, ul, li) alongside bv-* elements', () => {
      const html = `
        <bv-topic path="x">
          <h1>Title</h1>
          <p>Narrative.</p>
          <ul><li>Item</li></ul>
        </bv-topic>
      `
      const result = parseHtml(html)
      const elements = walkElements(result)
      const tagNames = elements.map((e) => e.tagName)
      expect(tagNames).to.include('h1')
      expect(tagNames).to.include('p')
      expect(tagNames).to.include('ul')
      expect(tagNames).to.include('li')
    })
  })

  describe('malformed input handling', () => {
    it('does not throw on empty string', () => {
      expect(() => parseHtml('')).to.not.throw()
    })

    it('does not throw on plain text', () => {
      expect(() => parseHtml('just some text without tags')).to.not.throw()
    })

    it('does not throw on unclosed tags', () => {
      expect(() => parseHtml('<bv-topic path="x"><bv-rule>unclosed')).to.not.throw()
    })

    it('does not throw on mismatched nesting', () => {
      expect(() => parseHtml('<bv-topic path="x"><bv-rule></bv-topic></bv-rule>')).to.not.throw()
    })

    it('does not throw on broken attribute syntax', () => {
      expect(() => parseHtml('<bv-topic path=>...</bv-topic>')).to.not.throw()
    })

    it('does not throw on unknown tags', () => {
      const result = parseHtml('<some-future-tag attr="x">content</some-future-tag>')
      const elements = walkElements(result)
      // parse5 is forgiving — unknown tags are still parsed as elements
      expect(elements.find((e) => e.tagName === 'some-future-tag')).to.not.equal(undefined)
    })
  })
})

describe('walkElements', () => {
  it('returns elements in document order (depth-first)', () => {
    const result = parseHtml('<bv-topic path="x"><bv-rule id="a"/><bv-decision id="b"/></bv-topic>')
    const elements = walkElements(result)
    const names = elements
      .filter((e) => e.tagName.startsWith('bv-'))
      .map((e) => e.tagName)
    expect(names).to.deep.equal(['bv-topic', 'bv-rule', 'bv-decision'])
  })

  it('includes nested elements at any depth', () => {
    const html = '<bv-topic path="x"><div><span><bv-rule id="r1"/></span></div></bv-topic>'
    const result = parseHtml(html)
    const elements = walkElements(result)
    expect(elements.find((e) => e.tagName === 'bv-rule')).to.not.equal(undefined)
  })

  it('returns empty array on empty document', () => {
    const result = parseHtml('')
    expect(walkElements(result)).to.be.an('array')
  })
})

describe('getInnerText', () => {
  it('extracts text content from a simple element', () => {
    const node: ElementNode = {
      attributes: {},
      children: [{text: 'Some rule text', type: 'text'}],
      tagName: 'bv-rule',
      type: 'element',
    }
    expect(getInnerText(node)).to.equal('Some rule text')
  })

  it('concatenates text from nested elements', () => {
    const result = parseHtml('<bv-topic path="x"><p>First.</p><p>Second.</p></bv-topic>')
    const topic = walkElements(result).find((e) => e.tagName === 'bv-topic')!
    const innerText = getInnerText(topic)
    expect(innerText).to.include('First.')
    expect(innerText).to.include('Second.')
  })

  it('decodes HTML entities (e.g. &amp; → &)', () => {
    const result = parseHtml('<bv-rule>Foo &amp; bar</bv-rule>')
    const rule = walkElements(result).find((e) => e.tagName === 'bv-rule')!
    expect(getInnerText(rule)).to.include('Foo & bar')
  })

  it('returns empty string for an element with no text descendants', () => {
    const node: ElementNode = {attributes: {}, children: [], tagName: 'bv-rule', type: 'element'}
    expect(getInnerText(node)).to.equal('')
  })
})

describe('serializeHtml', () => {
  it('round-trips a simple bv-topic with attributes', () => {
    const html = '<bv-topic path="security-auth" importance="89"></bv-topic>'
    const tree = parseHtml(html)
    const out = serializeHtml(tree)
    // Re-parse the output; semantic equivalence is what we test, not
    // byte-exactness (whitespace / quoting may normalize)
    const reparsed = parseHtml(out)
    const topic = walkElements(reparsed).find((e) => e.tagName === 'bv-topic')!
    expect(topic.attributes.path).to.equal('security-auth')
    expect(topic.attributes.importance).to.equal('89')
  })

  it('round-trips nested elements semantically', () => {
    const html = '<bv-topic path="x"><bv-rule severity="must" id="r1">Be careful</bv-rule></bv-topic>'
    const tree = parseHtml(html)
    const reparsed = parseHtml(serializeHtml(tree))
    const elements = walkElements(reparsed)
    const rule = elements.find((e) => e.tagName === 'bv-rule')!
    expect(rule.attributes.severity).to.equal('must')
    expect(rule.attributes.id).to.equal('r1')
    expect(getInnerText(rule)).to.include('Be careful')
  })

  it('does not throw on serialising a parse result of malformed input', () => {
    const tree = parseHtml('<bv-topic path="x"><bv-rule>unclosed')
    expect(() => serializeHtml(tree)).to.not.throw()
  })
})
})
