import {expect} from 'chai'
import {mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {migrateFrontmatter} from '../../../scripts/migrate-frontmatter-complete.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'migrate-fm-'))
}

describe('migrate-frontmatter-complete', () => {
  describe('migrateFrontmatter()', () => {
    it('fills missing required fields with safe defaults', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, 'test.md'), '---\ntags: [auth]\nkeywords: [jwt]\n---\nBody content\n')

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(1)
      expect(result.changed).to.equal(1)

      const content = readFileSync(join(dir, 'test.md'), 'utf8')
      expect(content).to.include('title:')
      expect(content).to.include('summary:')
      expect(content).to.include('related:')
      expect(content).to.include('createdAt:')
      expect(content).to.include('updatedAt:')
      // Existing fields preserved
      expect(content).to.include('tags: [auth]')
      expect(content).to.include('keywords: [jwt]')
    })

    it('uses file birthtime/mtime for timestamp defaults', () => {
      const dir = makeTmpDir()
      const filePath = join(dir, 'test.md')
      writeFileSync(filePath, '---\ntags: []\nkeywords: []\n---\nBody\n')

      const stat = statSync(filePath)
      migrateFrontmatter(dir, {dryRun: false})

      const content = readFileSync(filePath, 'utf8')
      // createdAt should use birthtime, falling back to mtime
      const expectedCreated = (stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime).toISOString()
      expect(content).to.include(`createdAt: '${expectedCreated}'`)
    })

    it('does not modify files that already have all required fields', () => {
      const dir = makeTmpDir()
      const complete = `---
title: Test
summary: A summary
tags: [tag]
related: [domain/file.md]
keywords: [kw]
createdAt: '2026-01-01T00:00:00.000Z'
updatedAt: '2026-01-02T00:00:00.000Z'
---
Body content
`
      writeFileSync(join(dir, 'test.md'), complete)

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(1)
      expect(result.changed).to.equal(0)

      const content = readFileSync(join(dir, 'test.md'), 'utf8')
      expect(content).to.equal(complete)
    })

    it('is idempotent — second run changes zero files', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, 'test.md'), '---\ntags: []\nkeywords: []\n---\nBody\n')

      migrateFrontmatter(dir, {dryRun: false})
      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.changed).to.equal(0)
    })

    it('excludes _index.md files', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, '_index.md'), '---\ntype: summary\n---\nSummary\n')

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(0)
      // File should be unchanged
      const content = readFileSync(join(dir, '_index.md'), 'utf8')
      expect(content).to.include('type: summary')
      expect(content).not.to.include('title:')
    })

    it('excludes .stub.md files', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, 'old.stub.md'), '---\nstub: true\n---\nArchive stub\n')

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(0)
    })

    it('excludes files under _archived/ directories', () => {
      const dir = makeTmpDir()
      const archiveDir = join(dir, '_archived')
      mkdirSync(archiveDir)
      writeFileSync(join(archiveDir, 'old.md'), '---\ntags: []\nkeywords: []\n---\nOld\n')

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(0)
    })

    it('walks subdirectories recursively', () => {
      const dir = makeTmpDir()
      const subDir = join(dir, 'domain', 'topic')
      mkdirSync(subDir, {recursive: true})
      writeFileSync(join(subDir, 'deep.md'), '---\ntags: []\nkeywords: []\n---\nDeep\n')

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(1)
      expect(result.changed).to.equal(1)

      const content = readFileSync(join(subDir, 'deep.md'), 'utf8')
      expect(content).to.include('title:')
    })

    describe('dry-run mode', () => {
      it('prints a summary but writes no files', () => {
        const dir = makeTmpDir()
        writeFileSync(join(dir, 'test.md'), '---\ntags: []\nkeywords: []\n---\nBody\n')

        const result = migrateFrontmatter(dir, {dryRun: true})

        expect(result.scanned).to.equal(1)
        expect(result.changed).to.equal(1)
        expect(result.missingFields).to.have.property('title', 1)
        expect(result.missingFields).to.have.property('summary', 1)
        expect(result.missingFields).to.have.property('related', 1)
        expect(result.missingFields).to.have.property('createdAt', 1)
        expect(result.missingFields).to.have.property('updatedAt', 1)

        // File should be unchanged
        const content = readFileSync(join(dir, 'test.md'), 'utf8')
        expect(content).not.to.include('title:')
      })
    })

    it('skips files without frontmatter', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, 'no-fm.md'), 'Just plain markdown, no frontmatter.\n')

      const result = migrateFrontmatter(dir, {dryRun: false})

      expect(result.scanned).to.equal(1)
      expect(result.changed).to.equal(0)

      const content = readFileSync(join(dir, 'no-fm.md'), 'utf8')
      expect(content).to.equal('Just plain markdown, no frontmatter.\n')
    })

    it('preserves body content after frontmatter migration', () => {
      const dir = makeTmpDir()
      const body = `## Raw Concept
**Task:**
Do something

## Narrative
### Structure
Some structure
`
      writeFileSync(join(dir, 'test.md'), `---\ntitle: My Title\ntags: [auth]\nkeywords: [jwt]\n---\n${body}`)

      migrateFrontmatter(dir, {dryRun: false})

      const content = readFileSync(join(dir, 'test.md'), 'utf8')
      expect(content).to.include('## Raw Concept')
      expect(content).to.include('Do something')
      expect(content).to.include('## Narrative')
    })
  })
})
