/* eslint-disable camelcase */
import {expect} from 'chai'

import {
  generateArchiveStubContent,
  generateSummaryContent,
  parseArchiveStubFrontmatter,
  parseSummaryFrontmatter,
} from '../../../../src/server/infra/context-tree/summary-frontmatter.js'

describe('summary-frontmatter', () => {
  describe('parseSummaryFrontmatter', () => {
    it('should parse valid summary frontmatter', () => {
      const content = `---
type: summary
condensation_order: 2
summary_level: d2
covers:
  - auth.md
  - api.md
children_hash: abc123
covers_token_total: 500
token_count: 100
compression_ratio: 0.2
---
This is the summary body.`

      const result = parseSummaryFrontmatter(content)
      expect(result).to.not.be.null
      expect(result!.type).to.equal('summary')
      expect(result!.condensation_order).to.equal(2)
      expect(result!.summary_level).to.equal('d2')
      expect(result!.covers).to.deep.equal(['auth.md', 'api.md'])
      expect(result!.children_hash).to.equal('abc123')
      expect(result!.covers_token_total).to.equal(500)
      expect(result!.token_count).to.equal(100)
      expect(result!.compression_ratio).to.equal(0.2)
    })

    it('should return null for non-summary type', () => {
      const content = `---
type: archive_stub
---
Body`
      expect(parseSummaryFrontmatter(content)).to.be.null
    })

    it('should return null for missing frontmatter', () => {
      expect(parseSummaryFrontmatter('Just some text')).to.be.null
    })

    it('should return null for empty string', () => {
      expect(parseSummaryFrontmatter('')).to.be.null
    })

    it('should return null for invalid condensation_order', () => {
      const content = `---
type: summary
condensation_order: 5
---
Body`
      expect(parseSummaryFrontmatter(content)).to.be.null
    })

    it('should accept all valid condensation orders (0-3)', () => {
      for (const order of [0, 1, 2, 3]) {
        const content = `---
type: summary
condensation_order: ${order}
---
Body`
        const result = parseSummaryFrontmatter(content)
        expect(result).to.not.be.null
        expect(result!.condensation_order).to.equal(order)
      }
    })

    it('should handle missing optional fields with defaults', () => {
      const content = `---
type: summary
condensation_order: 1
---
Body`
      const result = parseSummaryFrontmatter(content)
      expect(result).to.not.be.null
      expect(result!.children_hash).to.equal('')
      expect(result!.compression_ratio).to.equal(0)
      expect(result!.covers).to.deep.equal([])
      expect(result!.covers_token_total).to.equal(0)
      expect(result!.token_count).to.equal(0)
    })

    it('should handle CRLF line endings', () => {
      const content = '---\r\ntype: summary\r\ncondensation_order: 1\r\n---\r\nBody'
      const result = parseSummaryFrontmatter(content)
      expect(result).to.not.be.null
      expect(result!.type).to.equal('summary')
    })

    it('should return null for malformed YAML', () => {
      const content = `---
type: summary
bad yaml: [unclosed
---
Body`
      expect(parseSummaryFrontmatter(content)).to.be.null
    })

    it('should return null when frontmatter closing delimiter is missing', () => {
      const content = `---
type: summary
condensation_order: 1
Body without closing`
      expect(parseSummaryFrontmatter(content)).to.be.null
    })
  })

  describe('generateSummaryContent', () => {
    it('should produce parseable output', () => {
      const frontmatter = {
        children_hash: 'abc123',
        compression_ratio: 0.25,
        condensation_order: 2 as const,
        covers: ['auth.md', 'api.md'],
        covers_token_total: 400,
        summary_level: 'd2' as const,
        token_count: 100,
        type: 'summary' as const,
      }

      const content = generateSummaryContent(frontmatter, 'Summary body here.')
      const parsed = parseSummaryFrontmatter(content)
      expect(parsed).to.not.be.null
      expect(parsed!.condensation_order).to.equal(2)
      expect(parsed!.children_hash).to.equal('abc123')
      expect(parsed!.covers).to.deep.equal(['auth.md', 'api.md'])
    })

    it('should include the body text after frontmatter', () => {
      const frontmatter = {
        children_hash: '',
        compression_ratio: 0,
        condensation_order: 0 as const,
        covers: [],
        covers_token_total: 0,
        summary_level: 'd0' as const,
        token_count: 0,
        type: 'summary' as const,
      }

      const content = generateSummaryContent(frontmatter, 'My summary body')
      expect(content).to.include('My summary body')
      expect(content.startsWith('---\n')).to.be.true
    })

    it('should produce YAML keys in object-literal insertion order', () => {
      const frontmatter = {
        children_hash: 'hash',
        compression_ratio: 0.5,
        condensation_order: 1 as const,
        covers: ['a.md'],
        covers_token_total: 200,
        summary_level: 'd1' as const,
        token_count: 50,
        type: 'summary' as const,
      }

      const content = generateSummaryContent(frontmatter, 'Body')
      const yamlSection = content.split('---\n')[1]
      const keys = yamlSection.split('\n')
        .filter((line) => /^\w/.test(line))
        .map((line) => line.split(':')[0])
      // Keys should follow the insertion order from generateSummaryContent,
      // not be force-sorted alphabetically (sortKeys: false).
      expect(keys).to.deep.equal([
        'children_hash', 'compression_ratio', 'condensation_order',
        'covers', 'covers_token_total', 'summary_level', 'token_count', 'type',
      ])
    })
  })

  describe('parseArchiveStubFrontmatter', () => {
    it('should parse valid archive stub frontmatter', () => {
      const content = `---
type: archive_stub
original_path: auth/jwt-tokens/refresh-flow.md
points_to: _archived/auth/jwt-tokens/refresh-flow.full.md
original_token_count: 1500
evicted_at: "2026-03-01T00:00:00.000Z"
evicted_importance: 25
---
Ghost cue text here.`

      const result = parseArchiveStubFrontmatter(content)
      expect(result).to.not.be.null
      expect(result!.type).to.equal('archive_stub')
      expect(result!.original_path).to.equal('auth/jwt-tokens/refresh-flow.md')
      expect(result!.points_to).to.equal('_archived/auth/jwt-tokens/refresh-flow.full.md')
      expect(result!.original_token_count).to.equal(1500)
      expect(result!.evicted_importance).to.equal(25)
    })

    it('should return null for non-archive_stub type', () => {
      const content = `---
type: summary
---
Body`
      expect(parseArchiveStubFrontmatter(content)).to.be.null
    })

    it('should return null for missing frontmatter', () => {
      expect(parseArchiveStubFrontmatter('Plain text')).to.be.null
    })

    it('should return null for empty string', () => {
      expect(parseArchiveStubFrontmatter('')).to.be.null
    })

    it('should handle missing optional fields with defaults', () => {
      const content = `---
type: archive_stub
---
Body`
      const result = parseArchiveStubFrontmatter(content)
      expect(result).to.not.be.null
      expect(result!.original_path).to.equal('')
      expect(result!.points_to).to.equal('')
      expect(result!.original_token_count).to.equal(0)
      expect(result!.evicted_importance).to.equal(0)
      expect(result!.evicted_at).to.equal('')
    })
  })

  describe('generateArchiveStubContent', () => {
    it('should produce parseable output', () => {
      const frontmatter = {
        evicted_at: '2026-03-01T00:00:00.000Z',
        evicted_importance: 30,
        original_path: 'auth/tokens.md',
        original_token_count: 1200,
        points_to: '_archived/auth/tokens.full.md',
        type: 'archive_stub' as const,
      }

      const content = generateArchiveStubContent(frontmatter, 'Ghost cue here.')
      const parsed = parseArchiveStubFrontmatter(content)
      expect(parsed).to.not.be.null
      expect(parsed!.original_path).to.equal('auth/tokens.md')
      expect(parsed!.points_to).to.equal('_archived/auth/tokens.full.md')
      expect(parsed!.original_token_count).to.equal(1200)
    })

    it('should include the ghost cue after frontmatter', () => {
      const frontmatter = {
        evicted_at: '2026-03-01T00:00:00.000Z',
        evicted_importance: 20,
        original_path: 'test.md',
        original_token_count: 500,
        points_to: '_archived/test.full.md',
        type: 'archive_stub' as const,
      }

      const content = generateArchiveStubContent(frontmatter, 'Ghost cue text')
      expect(content).to.include('Ghost cue text')
      expect(content.startsWith('---\n')).to.be.true
    })

    it('should produce YAML keys in object-literal insertion order', () => {
      const frontmatter = {
        evicted_at: '2026-03-01T00:00:00.000Z',
        evicted_importance: 25,
        original_path: 'test.md',
        original_token_count: 500,
        points_to: '_archived/test.full.md',
        type: 'archive_stub' as const,
      }

      const content = generateArchiveStubContent(frontmatter, 'Cue')
      const yamlSection = content.split('---\n')[1]
      const keys = yamlSection.split('\n')
        .filter((line) => /^\w/.test(line))
        .map((line) => line.split(':')[0])
      // Keys should follow the insertion order from generateArchiveStubContent,
      // not be force-sorted alphabetically (sortKeys: false).
      expect(keys).to.deep.equal([
        'evicted_at', 'evicted_importance', 'original_path',
        'original_token_count', 'points_to', 'type',
      ])
    })
  })
})
