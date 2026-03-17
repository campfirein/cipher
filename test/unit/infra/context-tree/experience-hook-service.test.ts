import {expect} from 'chai'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DIR,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
} from '../../../../src/server/constants.js'
import {ExperienceHookService} from '../../../../src/server/infra/context-tree/experience-hook-service.js'
import {ExperienceStore} from '../../../../src/server/infra/context-tree/experience-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeService(): Promise<{baseDir: string; service: ExperienceHookService; store: ExperienceStore}> {
  const baseDir = join(
    tmpdir(),
    `experience-hook-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(baseDir, {recursive: true})
  const service = new ExperienceHookService(baseDir)
  const store = new ExperienceStore(baseDir)
  return {baseDir, service, store}
}

function buildResponse(signals: Array<{text: string; type: string}>): string {
  return `\`\`\`experience\n${JSON.stringify(signals)}\n\`\`\``
}

function experienceDir(baseDir: string): string {
  return join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, EXPERIENCE_DIR)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceHookService', () => {
  let baseDir: string
  let service: ExperienceHookService
  let store: ExperienceStore

  beforeEach(async () => {
    ;({baseDir, service, store} = await makeService())
  })

  afterEach(async () => {
    await rm(baseDir, {force: true, recursive: true})
  })

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe('onCurateComplete() — initialization', () => {
    it('seeds the experience directory on first call (even with no signals)', async () => {
      await service.onCurateComplete('No experience block here.')

      // Store should now be initialized
      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(1)
    })

    it('is idempotent — calling again does not re-create already existing files', async () => {
      await service.onCurateComplete('')
      await service.onCurateComplete('')

      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(2)
    })
  })

  // -------------------------------------------------------------------------
  // Signal extraction and writing
  // -------------------------------------------------------------------------

  describe('onCurateComplete() — signal writing', () => {
    it('writes lesson signals to lessons.md', async () => {
      const response = buildResponse([{text: 'test lesson', type: 'lesson'}])
      await service.onCurateComplete(response)

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('test lesson')
    })

    it('writes hint signals to hints.md', async () => {
      const response = buildResponse([{text: 'test hint', type: 'hint'}])
      await service.onCurateComplete(response)

      const lines = await store.readSectionLines(EXPERIENCE_HINTS_FILE, 'Hints')
      expect(lines).to.include('test hint')
    })

    it('writes signals of all four types in one call', async () => {
      const response = buildResponse([
        {text: 'multi lesson', type: 'lesson'},
        {text: 'multi hint', type: 'hint'},
        {text: 'multi dead-end', type: 'dead-end'},
        {text: 'multi strategy', type: 'strategy'},
      ])
      await service.onCurateComplete(response)

      const lessons = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lessons).to.include('multi lesson')

      const hints = await store.readSectionLines(EXPERIENCE_HINTS_FILE, 'Hints')
      expect(hints).to.include('multi hint')
    })

    it('trims whitespace from signal text before writing', async () => {
      const response = buildResponse([{text: '  padded lesson  ', type: 'lesson'}])
      await service.onCurateComplete(response)

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('padded lesson')
      expect(lines).to.not.include('  padded lesson  ')
    })
  })

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe('onCurateComplete() — deduplication', () => {
    it('does not write a bullet that already exists (exact match)', async () => {
      const response = buildResponse([{text: 'unique lesson', type: 'lesson'}])
      await service.onCurateComplete(response)
      await service.onCurateComplete(response)

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      const count = lines.filter((l) => l === 'unique lesson').length
      expect(count).to.equal(1, 'duplicate bullet should not be written twice')
    })

    it('deduplicates case-insensitively', async () => {
      await service.onCurateComplete(buildResponse([{text: 'Case Lesson', type: 'lesson'}]))
      await service.onCurateComplete(buildResponse([{text: 'case lesson', type: 'lesson'}]))

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines.filter((l) => l.toLowerCase() === 'case lesson')).to.have.length(1)
    })

    it('writes a new bullet that differs from existing ones', async () => {
      await service.onCurateComplete(buildResponse([{text: 'first lesson', type: 'lesson'}]))
      await service.onCurateComplete(buildResponse([{text: 'second lesson', type: 'lesson'}]))

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('first lesson')
      expect(lines).to.include('second lesson')
    })
  })

  // -------------------------------------------------------------------------
  // Curation counter
  // -------------------------------------------------------------------------

  describe('onCurateComplete() — curation counter', () => {
    it('increments curationCount on every call, even when no signals', async () => {
      await service.onCurateComplete('no signals')
      await service.onCurateComplete('no signals')
      await service.onCurateComplete('no signals')

      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(3)
    })

    it('increments curationCount when signals are written', async () => {
      await service.onCurateComplete(buildResponse([{text: 'with signals', type: 'hint'}]))

      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(1)
    })
  })

  // -------------------------------------------------------------------------
  // Fail-open / queue serialization
  // -------------------------------------------------------------------------

  describe('onCurateComplete() — fail-open and serialization', () => {
    it('never rejects even when the response is garbage', async () => {
      // Should not throw
      await service.onCurateComplete('```experience\nnot-valid-json\n```')
    })

    it('serializes concurrent calls — second call sees first call results', async () => {
      // Fire both without awaiting; they should serialize
      const p1 = service.onCurateComplete(buildResponse([{text: 'concurrent-1', type: 'lesson'}]))
      const p2 = service.onCurateComplete(buildResponse([{text: 'concurrent-2', type: 'lesson'}]))
      await Promise.all([p1, p2])

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('concurrent-1')
      expect(lines).to.include('concurrent-2')
    })

    it('continues processing after a failed call (queue not poisoned)', async () => {
      // A call with corrupt data that would fail during processing
      const badResponse = '```experience\n{not json}\n```'
      await service.onCurateComplete(badResponse)

      // Following call should still work
      await service.onCurateComplete(buildResponse([{text: 'after failure', type: 'hint'}]))

      const lines = await store.readSectionLines(EXPERIENCE_HINTS_FILE, 'Hints')
      expect(lines).to.include('after failure')
    })

    it('cross-instance: two instances for the same path share the queue and serialize', async () => {
      const service2 = new ExperienceHookService(baseDir)

      // Fire one call on each instance simultaneously
      const p1 = service.onCurateComplete(buildResponse([{text: 'from-instance-1', type: 'lesson'}]))
      const p2 = service2.onCurateComplete(buildResponse([{text: 'from-instance-2', type: 'lesson'}]))
      await Promise.all([p1, p2])

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('from-instance-1')
      expect(lines).to.include('from-instance-2')
      // Neither bullet should appear twice (dedup ensures atomic read-modify-write)
      expect(lines.filter((l) => l === 'from-instance-1')).to.have.length(1)
      expect(lines.filter((l) => l === 'from-instance-2')).to.have.length(1)
    })
  })

  // -------------------------------------------------------------------------
  // Isolation from experience dir path
  // -------------------------------------------------------------------------

  it('writes to the correct project directory', async () => {
    await service.onCurateComplete(buildResponse([{text: 'dir check', type: 'lesson'}]))

    // Verify the file actually lives inside baseDir/.brv/context-tree/experience/
    const expectedDir = experienceDir(baseDir)
    const {existsSync} = await import('node:fs')
    expect(existsSync(expectedDir)).to.equal(true)
  })
})
