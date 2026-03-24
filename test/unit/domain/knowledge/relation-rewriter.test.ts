import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {rewriteRelationsInContent, rewriteRelationsInTree} from '../../../../src/server/core/domain/knowledge/relation-rewriter.js'

describe('relation-rewriter', () => {
  describe('rewriteRelationsInContent', () => {
    it('should rewrite frontmatter related entries', () => {
      const content = '---\ntitle: Test Entry\nkeywords: [auth]\ntags: [security]\nrelated:\n  - old-domain/topic/entry.md\nimportance: 75\nmaturity: validated\n---\n# Content'
      const mapping = new Map([['old-domain/topic/entry.md', 'new-domain/topic/entry.md']])
      const result = rewriteRelationsInContent(content, mapping)
      expect(result).to.not.be.null
      expect(result).to.include('new-domain/topic/entry.md')
      expect(result).to.not.include('old-domain/topic/entry.md')
    })

    it('should rewrite legacy body @relations', () => {
      const content = '---\ntitle: Test\nkeywords: []\ntags: []\nrelated: []\n---\nSee also @old-domain/topic/entry.md for details.'
      const mapping = new Map([['old-domain/topic/entry.md', 'new-domain/topic/entry.md']])
      const result = rewriteRelationsInContent(content, mapping)
      expect(result).to.not.be.null
      expect(result).to.include('@new-domain/topic/entry.md')
    })

    it('should return null when no changes needed', () => {
      const content = '---\ntitle: Test\nkeywords: []\ntags: []\nrelated: []\n---\n# No relations'
      const mapping = new Map([['unrelated/path.md', 'other/path.md']])
      const result = rewriteRelationsInContent(content, mapping)
      expect(result).to.be.null
    })

    it('should preserve scoring metadata after rewrite', () => {
      const content = '---\ntitle: Scored Entry\nkeywords: [test]\ntags: [unit]\nrelated:\n  - old/path/entry.md\nimportance: 85\nmaturity: core\nrecency: 0.95\naccessCount: 12\nupdateCount: 3\n---\n# Body'
      const mapping = new Map([['old/path/entry.md', 'new/path/entry.md']])
      const result = rewriteRelationsInContent(content, mapping)
      expect(result).to.not.be.null
      expect(result).to.include('importance: 85')
      expect(result).to.include('maturity: core')
      expect(result).to.include('accessCount: 12')
      expect(result).to.include('updateCount: 3')
    })
  })

  describe('rewriteRelationsInTree', () => {
    let testDir: string

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'brv-rewrite-'))
      mkdirSync(join(testDir, 'domain', 'topic'), {recursive: true})
    })

    afterEach(() => { rmSync(testDir, {force: true, recursive: true}) })

    it('should rewrite files and return changed paths', async () => {
      writeFileSync(join(testDir, 'domain', 'topic', 'entry.md'), '---\ntitle: Entry\nkeywords: []\ntags: []\nrelated:\n  - old/ref.md\n---\n# Body')
      const mapping = new Map([['old/ref.md', 'new/ref.md']])
      const changed = await rewriteRelationsInTree(testDir, mapping)
      expect(changed).to.have.length(1)
      const content = await readFile(join(testDir, 'domain', 'topic', 'entry.md'), 'utf8')
      expect(content).to.include('new/ref.md')
    })

    it('should skip _index.md files', async () => {
      writeFileSync(join(testDir, 'domain', '_index.md'), '---\ntitle: Summary\nkeywords: []\ntags: []\nrelated:\n  - old/ref.md\n---\n# Summary')
      const mapping = new Map([['old/ref.md', 'new/ref.md']])
      const changed = await rewriteRelationsInTree(testDir, mapping)
      expect(changed).to.have.length(0)
    })
  })
})
