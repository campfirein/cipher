import {expect} from 'chai'
import {mkdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_META_FILE,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_PERFORMANCE_LOG_FILE,
} from '../../../../src/server/constants.js'
import {computeContentHash, ExperienceStore, generateEntryFilename} from '../../../../src/server/infra/context-tree/experience-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeStore(): Promise<{baseDir: string; store: ExperienceStore}> {
  const baseDir = join(tmpdir(), `experience-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(baseDir, {recursive: true})

  return {baseDir, store: new ExperienceStore(baseDir)}
}

function experienceDir(baseDir: string): string {
  return join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, EXPERIENCE_DIR)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceStore (v2 entry-based)', () => {
  let baseDir: string
  let store: ExperienceStore

  beforeEach(async () => {
    ({baseDir, store} = await makeStore())
  })

  afterEach(async () => {
    await rm(baseDir, {force: true, recursive: true})
  })

  describe('ensureInitialized()', () => {
    it('creates all subfolders and _meta.json', async () => {
      const created = await store.ensureInitialized()
      expect(created).to.equal(true)

      const expDir = experienceDir(baseDir)
      const metaPath = join(expDir, EXPERIENCE_META_FILE)
      const metaRaw = await readFile(metaPath, 'utf8')
      const meta = JSON.parse(metaRaw)
      expect(meta.curationCount).to.equal(0)

      // Check subfolders exist
      const {existsSync} = await import('node:fs')
      expect(existsSync(join(expDir, 'lessons'))).to.equal(true)
      expect(existsSync(join(expDir, 'hints'))).to.equal(true)
      expect(existsSync(join(expDir, 'dead-ends'))).to.equal(true)
      expect(existsSync(join(expDir, 'strategies'))).to.equal(true)
      expect(existsSync(join(expDir, 'reflections'))).to.equal(true)
      expect(existsSync(join(expDir, 'performance'))).to.equal(true)
    })

    it('is idempotent on second call', async () => {
      await store.ensureInitialized()
      const created2 = await store.ensureInitialized()
      expect(created2).to.equal(false)
    })
  })

  describe('createEntry()', () => {
    it('creates an entry file with frontmatter', async () => {
      await store.ensureInitialized()
      const iso = new Date().toISOString()
      const filename = await store.createEntry(EXPERIENCE_LESSONS_DIR, 'Test lesson body', {
        contentHash: computeContentHash('Test lesson body'),
        createdAt: iso,
        importance: 50,
        maturity: 'draft',
        recency: 1,
        tags: ['experience', 'lesson'],
        title: 'Test lesson',
        type: 'lesson',
        updatedAt: iso,
      })

      expect(filename).to.match(/^\d{4}-\d{2}-\d{2}--test-lesson\.md$/)
      const content = await store.readEntry(EXPERIENCE_LESSONS_DIR, filename)
      expect(content).to.include('title: "Test lesson"')
      expect(content).to.include('type: lesson')
      expect(content).to.include('Test lesson body')
    })

    it('sanitizes newlines in titles before writing frontmatter', async () => {
      await store.ensureInitialized()
      const iso = new Date().toISOString()
      const filename = await store.createEntry(EXPERIENCE_LESSONS_DIR, 'Body', {
        contentHash: computeContentHash('Body'),
        createdAt: iso,
        importance: 50,
        maturity: 'draft',
        recency: 1,
        tags: ['experience', 'lesson'],
        title: 'Line 1\nLine 2\rLine 3',
        type: 'lesson',
        updatedAt: iso,
      })

      const content = await store.readEntry(EXPERIENCE_LESSONS_DIR, filename)
      expect(content).to.include('title: "Line 1 Line 2Line 3"')
      expect(content).not.to.include('title: "Line 1\nLine 2')
    })

    it('appends flat numeric suffixes on repeated filename collisions', async () => {
      await store.ensureInitialized()
      const iso = new Date().toISOString()
      const baseFrontmatter = {
        createdAt: iso,
        importance: 50,
        maturity: 'draft' as const,
        recency: 1,
        tags: ['experience', 'lesson'],
        title: 'Repeated title',
        type: 'lesson' as const,
        updatedAt: iso,
      }

      const first = await store.createEntry(EXPERIENCE_LESSONS_DIR, 'First body', {
        ...baseFrontmatter,
        contentHash: computeContentHash('First body'),
      })
      const second = await store.createEntry(EXPERIENCE_LESSONS_DIR, 'Second body', {
        ...baseFrontmatter,
        contentHash: computeContentHash('Second body'),
      })
      const third = await store.createEntry(EXPERIENCE_LESSONS_DIR, 'Third body', {
        ...baseFrontmatter,
        contentHash: computeContentHash('Third body'),
      })

      expect(first).to.match(/^\d{4}-\d{2}-\d{2}--repeated-title\.md$/)
      expect(second).to.match(/^\d{4}-\d{2}-\d{2}--repeated-title-2\.md$/)
      expect(third).to.match(/^\d{4}-\d{2}-\d{2}--repeated-title-3\.md$/)
      expect(third).not.to.include('-2-3')
    })
  })

  describe('listEntries()', () => {
    it('lists only .md files excluding _index.md', async () => {
      await store.ensureInitialized()
      const iso = new Date().toISOString()
      await store.createEntry(EXPERIENCE_LESSONS_DIR, 'entry1', {
        contentHash: 'aaa',
        createdAt: iso,
        importance: 50,
        maturity: 'draft',
        recency: 1,
        tags: [],
        title: 'entry1',
        type: 'lesson',
        updatedAt: iso,
      })

      const entries = await store.listEntries(EXPERIENCE_LESSONS_DIR)
      expect(entries).to.have.length(1)
      expect(entries[0]).to.match(/\.md$/)
    })

    it('returns empty array for non-existent subfolder', async () => {
      const entries = await store.listEntries('nonexistent')
      expect(entries).to.deep.equal([])
    })
  })

  describe('readEntryContentHashes()', () => {
    it('returns content hashes from entry frontmatter', async () => {
      await store.ensureInitialized()
      const iso = new Date().toISOString()
      const hash = computeContentHash('test content')
      await store.createEntry(EXPERIENCE_LESSONS_DIR, 'test content', {
        contentHash: hash,
        createdAt: iso,
        importance: 50,
        maturity: 'draft',
        recency: 1,
        tags: [],
        title: 'test',
        type: 'lesson',
        updatedAt: iso,
      })

      const hashes = await store.readEntryContentHashes(EXPERIENCE_LESSONS_DIR)
      expect(hashes.has(hash)).to.equal(true)
    })
  })

  describe('appendPerformanceLog()', () => {
    it('creates JSONL file and appends entry', async () => {
      await store.ensureInitialized()
      await store.appendPerformanceLog({
        curationId: 1,
        domain: 'test',
        score: 0.8,
        summary: 'good',
        ts: '2026-03-30T10:00:00Z',
      })

      const logPath = join(experienceDir(baseDir), EXPERIENCE_PERFORMANCE_DIR, EXPERIENCE_PERFORMANCE_LOG_FILE)
      const raw = await readFile(logPath, 'utf8')
      const parsed = JSON.parse(raw.trim())
      expect(parsed.score).to.equal(0.8)
      expect(parsed.domain).to.equal('test')
    })
  })

  describe('readPerformanceLog()', () => {
    it('returns empty array when no log exists', async () => {
      const entries = await store.readPerformanceLog()
      expect(entries).to.deep.equal([])
    })

    it('returns last N entries', async () => {
      await store.ensureInitialized()
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.appendPerformanceLog({
          curationId: i,
          domain: 'test',
          score: i / 10,
          summary: `entry ${i}`,
          ts: new Date().toISOString(),
        })
      }

      const last2 = await store.readPerformanceLog(2)
      expect(last2).to.have.length(2)
      expect(last2[0].curationId).to.equal(3)
      expect(last2[1].curationId).to.equal(4)
    })

    it('returns last N entries when the requested tail spans multiple read chunks', async () => {
      await store.ensureInitialized()
      const largeSummary = 'x'.repeat(40_000)

      for (let i = 0; i < 4; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.appendPerformanceLog({
          curationId: i,
          domain: 'test',
          score: i / 10,
          summary: `${largeSummary}-${i}`,
          ts: new Date().toISOString(),
        })
      }

      const last2 = await store.readPerformanceLog(2)
      expect(last2).to.have.length(2)
      expect(last2[0].curationId).to.equal(2)
      expect(last2[1].curationId).to.equal(3)
    })
  })

  describe('meta operations', () => {
    it('incrementCurationCount increments and returns updated meta', async () => {
      await store.ensureInitialized()
      const meta = await store.incrementCurationCount()
      expect(meta.curationCount).to.equal(1)
      const meta2 = await store.incrementCurationCount()
      expect(meta2.curationCount).to.equal(2)
    })
  })

  describe('generateEntryFilename()', () => {
    it('creates a date-prefixed slug', () => {
      const name = generateEntryFilename('Hello World Test')
      expect(name).to.match(/^\d{4}-\d{2}-\d{2}--hello-world-test\.md$/)
    })

    it('strips repeated leading and trailing dashes after slug normalization', () => {
      const name = generateEntryFilename('---hello---')
      expect(name).to.match(/^\d{4}-\d{2}-\d{2}--hello\.md$/)
    })

    it('truncates slug to 50 chars', () => {
      const longText = 'a'.repeat(100)
      const name = generateEntryFilename(longText)
      // date (10) + -- (2) + slug (50) + .md (3) = 65
      expect(name.length).to.be.at.most(65)
    })
  })

  describe('computeContentHash()', () => {
    it('returns consistent hash for same normalized text', () => {
      expect(computeContentHash('Hello World')).to.equal(computeContentHash('  hello world  '))
    })

    it('returns 12-char hex string', () => {
      const hash = computeContentHash('test')
      expect(hash).to.match(/^[a-f0-9]{12}$/)
    })
  })

})
