/**
 * Format-detector tests.
 *
 * Two pure functions:
 *   - `getFormatForWrite(config)` reads the `useHtmlContextTree` flag.
 *   - `getFormatForRead(filePath)` reads the file extension.
 *
 * Both must be deterministic and side-effect-free; the curate executor
 * and the search service consume them on the hot path.
 */

import {expect} from 'chai'

import {getFormatForRead, getFormatForWrite} from '../../../../../../src/server/infra/render/format/format-detector.js'

describe('format-detector', () => {
  describe('getFormatForWrite', () => {
    it('returns "html" when useHtmlContextTree is true', () => {
      expect(getFormatForWrite({useHtmlContextTree: true})).to.equal('html')
    })

    it('returns "markdown" when useHtmlContextTree is false', () => {
      expect(getFormatForWrite({useHtmlContextTree: false})).to.equal('markdown')
    })

    it('returns "markdown" when useHtmlContextTree is undefined (default)', () => {
      expect(getFormatForWrite({})).to.equal('markdown')
    })

    it('treats truthy non-true values as markdown (strict-equality default)', () => {
      // Defensive: the flag is typed boolean, but a misconfigured JSON
      // could pass a string. Strict-equality keeps the default branch.
      expect(getFormatForWrite({useHtmlContextTree: 'true' as unknown as boolean})).to.equal('markdown')
    })
  })

  describe('getFormatForRead', () => {
    it('returns "html" for .html files', () => {
      expect(getFormatForRead('/path/to/topic.html')).to.equal('html')
    })

    it('returns "html" for .htm files', () => {
      expect(getFormatForRead('/path/to/topic.htm')).to.equal('html')
    })

    it('returns "markdown" for .md files', () => {
      expect(getFormatForRead('/path/to/topic.md')).to.equal('markdown')
    })

    it('returns "markdown" for unknown extensions', () => {
      expect(getFormatForRead('/path/to/topic.txt')).to.equal('markdown')
    })

    it('returns "markdown" for files with no extension', () => {
      expect(getFormatForRead('/path/to/README')).to.equal('markdown')
    })

    it('is case-insensitive on the extension', () => {
      expect(getFormatForRead('/path/to/Topic.HTML')).to.equal('html')
      expect(getFormatForRead('/path/to/Topic.MD')).to.equal('markdown')
    })

    it('handles relative paths', () => {
      expect(getFormatForRead('topic.html')).to.equal('html')
      expect(getFormatForRead('./nested/topic.html')).to.equal('html')
    })

    it('treats only the final segment\'s extension', () => {
      // A directory named `foo.html/` should not flip a `.md` file to html.
      expect(getFormatForRead('/path/foo.html/inner.md')).to.equal('markdown')
    })
  })
})
