import {expect} from 'chai'

import {decodeSearchContent, encodeSearchContent} from '../../../../src/shared/transport/search-content.js'

describe('search-content', () => {
  describe('encodeSearchContent', () => {
    it('encodes query, limit, and scope as JSON', () => {
      const encoded = encodeSearchContent({limit: 5, query: 'auth', scope: 'auth/'})
      const parsed = JSON.parse(encoded)
      expect(parsed.query).to.equal('auth')
      expect(parsed.limit).to.equal(5)
      expect(parsed.scope).to.equal('auth/')
    })

    it('omits undefined limit and scope', () => {
      const encoded = encodeSearchContent({query: 'test'})
      const parsed = JSON.parse(encoded)
      expect(parsed.query).to.equal('test')
      expect(parsed.limit).to.be.undefined
      expect(parsed.scope).to.be.undefined
    })
  })

  describe('decodeSearchContent', () => {
    it('decodes JSON-encoded content', () => {
      const content = JSON.stringify({limit: 5, query: 'auth', scope: 'auth/'})
      const decoded = decodeSearchContent(content)
      expect(decoded.query).to.equal('auth')
      expect(decoded.limit).to.equal(5)
      expect(decoded.scope).to.equal('auth/')
    })

    it('falls back to plain string as query when not JSON', () => {
      const decoded = decodeSearchContent('plain search query')
      expect(decoded.query).to.equal('plain search query')
      expect(decoded.limit).to.be.undefined
      expect(decoded.scope).to.be.undefined
    })

    it('falls back to content string when JSON has no query field', () => {
      const content = JSON.stringify({limit: 5})
      const decoded = decodeSearchContent(content)
      expect(decoded.query).to.equal(content)
    })

    it('ignores non-number limit', () => {
      const content = JSON.stringify({limit: 'ten', query: 'test'})
      const decoded = decodeSearchContent(content)
      expect(decoded.query).to.equal('test')
      expect(decoded.limit).to.be.undefined
    })

    it('ignores non-string scope', () => {
      const content = JSON.stringify({query: 'test', scope: 123})
      const decoded = decodeSearchContent(content)
      expect(decoded.query).to.equal('test')
      expect(decoded.scope).to.be.undefined
    })

    it('roundtrips with encodeSearchContent', () => {
      const original = {limit: 10, query: 'authentication', scope: 'auth/'}
      const decoded = decodeSearchContent(encodeSearchContent(original))
      expect(decoded.query).to.equal(original.query)
      expect(decoded.limit).to.equal(original.limit)
      expect(decoded.scope).to.equal(original.scope)
    })
  })
})
