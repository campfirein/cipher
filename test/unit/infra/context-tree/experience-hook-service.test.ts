import {expect} from 'chai'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import sinon from 'sinon'

import type {IConsolidationLlm} from '../../../../src/server/core/interfaces/experience/i-consolidation-llm.js'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_CONSOLIDATION_INTERVAL,
  EXPERIENCE_DIR,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
} from '../../../../src/server/constants.js'
import {BackpressureGate} from '../../../../src/server/infra/context-tree/backpressure-gate.js'
import {ExperienceConsolidationService} from '../../../../src/server/infra/context-tree/experience-consolidation-service.js'
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
  const service = new ExperienceHookService({baseDirectory: baseDir})
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

    it('still increments curationCount when one file append fails', async () => {
      const originalAppend = ExperienceStore.prototype.appendBulkToFile
      const appendStub = sinon.stub(ExperienceStore.prototype, 'appendBulkToFile').callsFake(
        async function (this: ExperienceStore, filename: string, section: string, bullets: string[]) {
          if (filename === EXPERIENCE_LESSONS_FILE) {
            throw new Error('disk full')
          }

          return originalAppend.call(this, filename, section, bullets)
        },
      )

      try {
        await service.onCurateComplete(
          buildResponse([
            {text: 'broken lesson write', type: 'lesson'},
            {text: 'hint survives', type: 'hint'},
          ]),
        )

        const meta = await store.readMeta()
        expect(meta.curationCount).to.equal(1)

        const hints = await store.readSectionLines(EXPERIENCE_HINTS_FILE, 'Hints')
        expect(hints).to.include('hint survives')
      } finally {
        appendStub.restore()
      }
    })

    it('still increments curationCount when ensureInitialized fails', async () => {
      const ensureStub = sinon.stub(ExperienceStore.prototype, 'ensureInitialized').rejects(new Error('disk full'))

      try {
        await service.onCurateComplete('no signals')

        const meta = await store.readMeta()
        expect(meta.curationCount).to.equal(1)
      } finally {
        ensureStub.restore()
      }
    })

    it('cross-instance: two instances for the same path share the queue and serialize', async () => {
      const service2 = new ExperienceHookService({baseDirectory: baseDir})

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

    it('prunes the queue map entry after the queue fully drains', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queues = (ExperienceHookService as any).queues as Map<string, Promise<void>>
      const key = resolve(baseDir)

      await service.onCurateComplete('no signals')
      // onCurateComplete() resolves when curation work completes; queue pruning happens
      // on the subsequent turn after the internal tail promise settles.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(queues.has(key)).to.be.false
    })

    it('does not prune the entry while a later task is still in the queue', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queues = (ExperienceHookService as any).queues as Map<string, Promise<void>>
      const key = resolve(baseDir)

      // Enqueue two tasks; only the second (tail) should trigger pruning
      const p1 = service.onCurateComplete('no signals')
      const p2 = service.onCurateComplete('no signals')

      // After the first resolves the tail is still p2 — entry must not be deleted yet
      await p1
      expect(queues.has(key)).to.be.true

      // After the second resolves (and cleanup microtask runs) the entry is pruned
      await p2
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      expect(queues.has(key)).to.be.false
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

  // -------------------------------------------------------------------------
  // Phase 4: consolidation trigger
  // -------------------------------------------------------------------------

  describe('onCurateComplete() — consolidation trigger', () => {
    let consolidateSpy: sinon.SinonStub

    function makeConsolidationService(): ExperienceConsolidationService {
      const llm: IConsolidationLlm = {generate: sinon.stub().resolves('["refined"]')}
      const svc = new ExperienceConsolidationService(llm)
      consolidateSpy = sinon.stub(svc, 'consolidate').resolves()
      return svc
    }

    it('does not call consolidate before the interval threshold', async () => {
      const consolidationService = makeConsolidationService()
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService})

      // Call (INTERVAL - 1) times — consolidation must not fire
      await Promise.all(
        Array.from({length: EXPERIENCE_CONSOLIDATION_INTERVAL - 1}, () => svc.onCurateComplete('no signals')),
      )

      expect(consolidateSpy.called).to.be.false
    })

    it('calls consolidate exactly once when curationCount hits the interval', async () => {
      const consolidationService = makeConsolidationService()
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService})

      await Promise.all(
        Array.from({length: EXPERIENCE_CONSOLIDATION_INTERVAL}, () => svc.onCurateComplete('no signals')),
      )

      // consolidate is fire-and-forget; give microtasks a chance to settle
      await Promise.resolve()
      expect(consolidateSpy.callCount).to.equal(1)
    })

    it('calls consolidate again at the next interval multiple', async () => {
      const consolidationService = makeConsolidationService()
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService})

      await Promise.all(
        Array.from({length: EXPERIENCE_CONSOLIDATION_INTERVAL * 2}, () => svc.onCurateComplete('no signals')),
      )

      await Promise.resolve()
      expect(consolidateSpy.callCount).to.equal(2)
    })

    it('process() resolves before consolidation completes (fire-and-forget)', async () => {
      let consolidationResolved = false
      const llm: IConsolidationLlm = {
        generate: sinon.stub().callsFake(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20)
          })
          consolidationResolved = true
          return '["done"]'
        }),
      }
      const consolidationService = new ExperienceConsolidationService(llm)
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService})

      // Drive curationCount to the threshold; queue serializes internally
      await Promise.all(
        Array.from({length: EXPERIENCE_CONSOLIDATION_INTERVAL}, () => svc.onCurateComplete('no signals')),
      )

      // process() must have resolved already even though consolidation is still in-flight
      expect(consolidationResolved).to.be.false

      // Let the background consolidation finish before teardown removes the temp directory.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })
    })

    it('serializes later curations behind in-flight consolidation', async () => {
      let releaseConsolidation!: () => void
      const llm: IConsolidationLlm = {
        generate: sinon.stub().callsFake(
          () =>
            new Promise<string>((resolve) => {
              releaseConsolidation = () => resolve('["merged lesson"]')
            }),
        ),
      }
      const consolidationService = new ExperienceConsolidationService(llm)
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService})

      await svc.onCurateComplete(buildResponse([{text: 'seed lesson 1', type: 'lesson'}]))
      await svc.onCurateComplete(buildResponse([{text: 'seed lesson 2', type: 'lesson'}]))
      await svc.onCurateComplete('no signals')
      await svc.onCurateComplete('no signals')

      await svc.onCurateComplete('no signals')

      let laterResolved = false
      const laterCuration = svc
        .onCurateComplete(buildResponse([{text: 'post consolidation lesson', type: 'lesson'}]))
        .then(() => {
          laterResolved = true
        })

      await Promise.resolve()
      await Promise.resolve()

      expect(laterResolved).to.be.false
      expect((await store.readMeta()).curationCount).to.equal(EXPERIENCE_CONSOLIDATION_INTERVAL)

      releaseConsolidation()
      await laterCuration

      const lines = await store.readSectionLines(EXPERIENCE_LESSONS_FILE, 'Facts')
      expect(lines).to.include('merged lesson')
      expect(lines).to.include('post consolidation lesson')
      expect((await store.readMeta()).curationCount).to.equal(EXPERIENCE_CONSOLIDATION_INTERVAL + 1)
    })

    it('does not call consolidate without a consolidation service', async () => {
      // Default constructor — no consolidation service
      const svc = new ExperienceHookService({baseDirectory: baseDir})

      await Promise.all(
        Array.from({length: EXPERIENCE_CONSOLIDATION_INTERVAL}, () => svc.onCurateComplete('no signals')),
      )

      // No error and curation counter still incremented
      const meta = await store.readMeta()
      expect(meta.curationCount).to.equal(EXPERIENCE_CONSOLIDATION_INTERVAL)
    })

    it('triggers background consolidation when an injected gate fires', async () => {
      const consolidationService = makeConsolidationService()
      const gate = new BackpressureGate({maxEntriesPerFile: 1, minConsolidationIntervalSec: 0})
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService, gate})

      await svc.onCurateComplete(buildResponse([{text: 'gate-triggered lesson', type: 'lesson'}]))
      await Promise.resolve()

      expect(consolidateSpy.calledOnce).to.be.true
      expect(consolidateSpy.firstCall.args[1]).to.equal(0)
    })

    it('runs cadence consolidation only once when gate and cadence trigger together', async () => {
      const consolidationService = makeConsolidationService()
      const gate = new BackpressureGate({maxEntriesPerFile: 1, minConsolidationIntervalSec: 0})
      const svc = new ExperienceHookService({baseDirectory: baseDir, consolidationService, gate})

      await Promise.all(
        Array.from({length: EXPERIENCE_CONSOLIDATION_INTERVAL - 1}, () => svc.onCurateComplete('no signals')),
      )

      await svc.onCurateComplete(buildResponse([{text: 'boundary lesson', type: 'lesson'}]))
      await Promise.resolve()

      expect(consolidateSpy.callCount).to.equal(1)
      expect(consolidateSpy.firstCall.args[1]).to.equal(EXPERIENCE_CONSOLIDATION_INTERVAL)
    })
  })
})
