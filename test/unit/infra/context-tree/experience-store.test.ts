import {expect} from 'chai'
import {mkdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_DIR,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_META_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../../../src/server/constants.js'
import {parseFrontmatterScoring} from '../../../../src/server/core/domain/knowledge/markdown-writer.js'
import {EXPERIENCE_SECTIONS, ExperienceStore} from '../../../../src/server/infra/context-tree/experience-store.js'

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

function experienceFile(baseDir: string, filename: string): string {
  return join(experienceDir(baseDir), filename)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceStore', () => {
  let baseDir: string
  let store: ExperienceStore

  beforeEach(async () => {
    ;({baseDir, store} = await makeStore())
  })

  afterEach(async () => {
    await rm(baseDir, {force: true, recursive: true})
  })

  // -------------------------------------------------------------------------
  // ensureInitialized
  // -------------------------------------------------------------------------

  describe('ensureInitialized()', () => {
    it('creates all four .md files and _meta.json on first call', async () => {
      const created = await store.ensureInitialized()

      expect(created).to.equal(true)

      await Promise.all(
        [
          EXPERIENCE_LESSONS_FILE,
          EXPERIENCE_HINTS_FILE,
          EXPERIENCE_DEAD_ENDS_FILE,
          EXPERIENCE_PLAYBOOK_FILE,
          EXPERIENCE_META_FILE,
        ].map(async (filename) => {
          const content = await readFile(experienceFile(baseDir, filename), 'utf8')
          expect(content.length).to.be.greaterThan(0, `${filename} should not be empty`)
        }),
      )
    })

    it('each .md seed file has valid frontmatter with importance 70 and maturity validated', async () => {
      await store.ensureInitialized()

      await Promise.all(
        [EXPERIENCE_LESSONS_FILE, EXPERIENCE_HINTS_FILE, EXPERIENCE_DEAD_ENDS_FILE, EXPERIENCE_PLAYBOOK_FILE].map(
          async (filename) => {
            const content = await readFile(experienceFile(baseDir, filename), 'utf8')
            const scoring = parseFrontmatterScoring(content)

            expect(scoring, `${filename} should have frontmatter`).to.not.be.undefined
            expect(scoring!.importance).to.equal(70, `${filename} importance should be 70`)
            expect(scoring!.maturity).to.equal('validated', `${filename} maturity should be validated`)
          },
        ),
      )
    })

    it('each .md seed file contains its expected section header', async () => {
      await store.ensureInitialized()

      await Promise.all(
        Object.entries(EXPERIENCE_SECTIONS).map(async ([filename, section]) => {
          const content = await readFile(experienceFile(baseDir, filename), 'utf8')
          expect(content).to.include(`## ${section}`, `${filename} should contain ## ${section}`)
        }),
      )
    })

    it('_meta.json seeds with curationCount 0', async () => {
      await store.ensureInitialized()

      const raw = await readFile(experienceFile(baseDir, EXPERIENCE_META_FILE), 'utf8')
      const meta = JSON.parse(raw)

      expect(meta.curationCount).to.equal(0)
      expect(meta.lastConsolidatedAt).to.equal('')
    })

    it('is idempotent — second call returns false and does not overwrite files', async () => {
      await store.ensureInitialized()

      // Write a sentinel to lessons.md so we can detect an overwrite
      const lessonsPath = experienceFile(baseDir, EXPERIENCE_LESSONS_FILE)
      const original = await readFile(lessonsPath, 'utf8')
      const sentinel = original + '\n<!-- sentinel -->'
      await (await import('node:fs/promises')).writeFile(lessonsPath, sentinel, 'utf8')

      const created = await store.ensureInitialized()

      expect(created).to.equal(false)
      const after = await readFile(lessonsPath, 'utf8')
      expect(after).to.equal(sentinel, 'existing file should not be overwritten')
    })
  })

  // -------------------------------------------------------------------------
  // appendBulkToFile
  // -------------------------------------------------------------------------

  describe('appendBulkToFile()', () => {
    beforeEach(async () => {
      await store.ensureInitialized()
    })

    it('inserts all bullets under the correct section', async () => {
      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['first lesson', 'second lesson'])

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('first lesson')
      expect(lines).to.include('second lesson')
    })

    it('preserves insertion order across successive appends', async () => {
      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['first lesson'])
      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['second lesson'])

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.deep.equal(['first lesson', 'second lesson'])
    })

    it('applies recordCurateUpdate() exactly once regardless of bullet count', async () => {
      const beforeContent = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      const beforeScoring = parseFrontmatterScoring(beforeContent)
      const beforeUpdateCount = beforeScoring?.updateCount ?? 0

      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['a', 'b', 'c'])

      const afterContent = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      const afterScoring = parseFrontmatterScoring(afterContent)

      expect(afterScoring!.updateCount).to.equal(beforeUpdateCount + 1)
    })

    it('increases importance by UPDATE_IMPORTANCE_BONUS after write', async () => {
      const beforeContent = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      const beforeScoring = parseFrontmatterScoring(beforeContent)
      const beforeImportance = beforeScoring?.importance ?? 70

      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['lesson'])

      const afterContent = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      const afterScoring = parseFrontmatterScoring(afterContent)

      expect(afterScoring!.importance).to.be.greaterThan(beforeImportance)
    })

    it('is a no-op when bullets array is empty', async () => {
      const before = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')

      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', [])

      const after = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      expect(after).to.equal(before)
    })

    it('throws when the section header is missing', async () => {
      const filePath = experienceFile(baseDir, EXPERIENCE_LESSONS_FILE)
      await (await import('node:fs/promises')).writeFile(
        filePath,
        '---\ntitle: "test"\ntags: []\nkeywords: []\n---\n\n## Wrong Section\n\n',
        'utf8',
      )

      try {
        await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['bullet'])
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.match(/Section "## Facts" not found/)
      }
    })

    it('throws when the file has no frontmatter', async () => {
      const filePath = experienceFile(baseDir, EXPERIENCE_LESSONS_FILE)
      await (await import('node:fs/promises')).writeFile(
        filePath,
        '## Facts\n\nsome content without frontmatter\n',
        'utf8',
      )

      try {
        await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['bullet'])
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.match(/missing frontmatter/)
      }
    })
  })

  // -------------------------------------------------------------------------
  // readSectionLines
  // -------------------------------------------------------------------------

  describe('readSectionLines()', () => {
    beforeEach(async () => {
      await store.ensureInitialized()
    })

    it('returns empty array when file does not exist', async () => {
      const lines = await store.readSectionLines('nonexistent.md', 'Facts')
      expect(lines).to.deep.equal([])
    })

    it('returns empty array when section has no bullets', async () => {
      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.deep.equal([])
    })

    it('returns bullet texts stripped of "- " prefix', async () => {
      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['alpha', 'beta'])
      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.deep.equal(['alpha', 'beta'])
    })

    it('does not leak lines from adjacent sections', async () => {
      // Append to hints and then read only lessons — should see no cross-bleed
      await store.appendBulkToFile(EXPERIENCE_HINTS_FILE, 'Hints', ['hint text'])
      const lessons = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lessons).to.deep.equal([])
    })
  })

  // -------------------------------------------------------------------------
  // writeFile
  // -------------------------------------------------------------------------

  describe('writeFile()', () => {
    beforeEach(async () => {
      await store.ensureInitialized()
    })

    it('persists content that has valid frontmatter', async () => {
      const content = '---\ntitle: "test"\ntags: []\nkeywords: []\n---\n\n## Facts\n\n'
      await store.writeFile(EXPERIENCE_LESSONS_FILE, content)

      const read = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      expect(read).to.equal(content)
    })

    it('throws when content is missing frontmatter', async () => {
      try {
        await store.writeFile(EXPERIENCE_LESSONS_FILE, '## Facts\n\n- bullet\n')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.match(/missing.*frontmatter/)
      }
    })

    it('throws when --- appears only in the body, not at file start', async () => {
      const bodyOnly = '## Facts\n\nsome text\n\n---\n\nmore text\n'
      try {
        await store.writeFile(EXPERIENCE_LESSONS_FILE, bodyOnly)
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.match(/missing a valid frontmatter block/)
      }
    })

    it('accepts CRLF frontmatter and normalizes to LF on disk', async () => {
      const crlf = '---\r\ntitle: "test"\r\ntags: []\r\nkeywords: []\r\n---\r\n\r\n## Facts\r\n\r\n'
      await store.writeFile(EXPERIENCE_LESSONS_FILE, crlf)

      const written = await readFile(experienceFile(baseDir, EXPERIENCE_LESSONS_FILE), 'utf8')
      expect(written).to.not.include('\r\n', 'CRLF should be normalized to LF on disk')
      expect(written).to.include('## Facts')
    })

    it('round-trip: writeFile with CRLF → readSectionLines → appendBulkToFile all work', async () => {
      const crlf = '---\r\ntitle: "test"\r\ntags: []\r\nkeywords: []\r\nimportance: 70\r\nrecency: 1\r\nmaturity: validated\r\naccessCount: 0\r\nupdateCount: 0\r\ncreatedAt: "2026-01-01T00:00:00.000Z"\r\nupdatedAt: "2026-01-01T00:00:00.000Z"\r\n---\r\n\r\n## Facts\r\n\r\n'

      // Step 1: write CRLF content — should normalize to LF
      await store.writeFile(EXPERIENCE_LESSONS_FILE, crlf)

      // Step 2: readSectionLines should return empty (no bullets yet), not throw
      const before = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(before).to.deep.equal([])

      // Step 3: appendBulkToFile should find the section header and succeed
      await store.appendBulkToFile(EXPERIENCE_LESSONS_FILE, 'Facts', ['round-trip bullet'])
      const after = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(after).to.deep.equal(['round-trip bullet'])
    })
  })

  // -------------------------------------------------------------------------
  // Meta operations
  // -------------------------------------------------------------------------

  describe('readMeta() / incrementCurationCount() / writeMeta()', () => {
    beforeEach(async () => {
      await store.ensureInitialized()
    })

    it('readMeta() returns defaults when meta file is missing', async () => {
      await rm(experienceFile(baseDir, EXPERIENCE_META_FILE), {force: true})

      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(0)
      expect(meta.lastConsolidatedAt).to.equal('')
    })

    it('readMeta() throws on malformed JSON — does not silently reset counter', async () => {
      await (await import('node:fs/promises')).writeFile(
        experienceFile(baseDir, EXPERIENCE_META_FILE),
        '{not valid json',
        'utf8',
      )

      try {
        await store.readMeta()
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SyntaxError)
      }
    })

    it('incrementCurationCount() increments monotonically', async () => {
      const first = await store.incrementCurationCount()
      expect(first.curationCount).to.equal(1)

      const second = await store.incrementCurationCount()
      expect(second.curationCount).to.equal(2)
    })

    it('writeMeta() persists lastConsolidatedAt', async () => {
      const iso = '2026-03-16T12:00:00.000Z'
      await store.writeMeta({lastConsolidatedAt: iso})

      const meta = await store.readMeta()
      expect(meta.lastConsolidatedAt).to.equal(iso)
    })

    it('writeMeta() merges patch with existing values', async () => {
      await store.incrementCurationCount()
      await store.writeMeta({lastConsolidatedAt: '2026-03-16T12:00:00.000Z'})

      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(1)
      expect(meta.lastConsolidatedAt).to.equal('2026-03-16T12:00:00.000Z')
    })
  })
})
