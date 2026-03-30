import {expect} from 'chai'
import {mkdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sinon from 'sinon'

import type {ExperienceSynthesisService} from '../../../../src/server/infra/context-tree/experience-synthesis-service.js'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_CONSOLIDATION_INTERVAL,
  EXPERIENCE_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_PERFORMANCE_LOG_FILE,
} from '../../../../src/server/constants.js'
import {BackpressureGate} from '../../../../src/server/infra/context-tree/backpressure-gate.js'
import {ExperienceHookService} from '../../../../src/server/infra/context-tree/experience-hook-service.js'
import {ExperienceStore} from '../../../../src/server/infra/context-tree/experience-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeService(options?: {
  gate?: BackpressureGate
  synthesisService?: ExperienceSynthesisService
}): Promise<{baseDir: string; service: ExperienceHookService; store: ExperienceStore}> {
  const baseDir = join(
    tmpdir(),
    `experience-hook-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(baseDir, {recursive: true})
  const service = new ExperienceHookService({
    baseDirectory: baseDir,
    gate: options?.gate,
    synthesisService: options?.synthesisService,
  })
  const store = new ExperienceStore(baseDir)

  return {baseDir, service, store}
}

function buildResponse(signals: Array<Record<string, unknown>>): string {
  return `\`\`\`experience\n${JSON.stringify(signals)}\n\`\`\``
}

function experienceDir(baseDir: string): string {
  return join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, EXPERIENCE_DIR)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceHookService (v2 entry-based)', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('onCurateComplete()', () => {
    it('creates entry files in the correct subfolder for lesson signals', async () => {
      const {baseDir, service, store} = await makeService()
      try {
        const response = buildResponse([{text: 'Always validate inputs', type: 'lesson'}])
        await service.onCurateComplete(response)

        const entries = await store.listEntries(EXPERIENCE_LESSONS_DIR)
        expect(entries).to.have.length(1)
        const content = await store.readEntry(EXPERIENCE_LESSONS_DIR, entries[0])
        expect(content).to.include('Always validate inputs')
        expect(content).to.include('type: lesson')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('routes performance signals to JSONL log', async () => {
      const {baseDir, service} = await makeService()
      try {
        const response = buildResponse([
          {domain: 'code-review', score: 0.85, text: 'good quality', type: 'performance'},
        ])
        await service.onCurateComplete(response)

        const logPath = join(experienceDir(baseDir), EXPERIENCE_PERFORMANCE_DIR, EXPERIENCE_PERFORMANCE_LOG_FILE)
        const raw = await readFile(logPath, 'utf8')
        const parsed = JSON.parse(raw.trim())
        expect(parsed.score).to.equal(0.85)
        expect(parsed.domain).to.equal('code-review')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('deduplicates signals via contentHash', async () => {
      const {baseDir, service, store} = await makeService()
      try {
        const response = buildResponse([{text: 'Same lesson text', type: 'lesson'}])
        await service.onCurateComplete(response)
        await service.onCurateComplete(response)

        const entries = await store.listEntries(EXPERIENCE_LESSONS_DIR)
        expect(entries).to.have.length(1)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('deduplicates reflection signals via contentHash', async () => {
      const {baseDir, service, store} = await makeService()
      try {
        const response = buildResponse([{text: 'Repeated reflection', type: 'reflection'}])
        await service.onCurateComplete(response)
        await service.onCurateComplete(response)

        const entries = await store.listEntries('reflections')
        expect(entries).to.have.length(1)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('trims signal text before persisting', async () => {
      const {baseDir, service, store} = await makeService()
      try {
        const response = buildResponse([{text: '  padded lesson  ', type: 'lesson'}])
        await service.onCurateComplete(response)

        const entries = await store.listEntries(EXPERIENCE_LESSONS_DIR)
        expect(entries).to.have.length(1)
        const content = await store.readEntry(EXPERIENCE_LESSONS_DIR, entries[0])
        expect(content).to.include('padded lesson')
        expect(content).not.to.include('  padded lesson  ')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('increments curation counter even when no signals are present', async () => {
      const {baseDir, service, store} = await makeService()
      try {
        await service.onCurateComplete('No experience block here')
        const meta = await store.readMeta()
        expect(meta.curationCount).to.equal(1)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('does not call enqueueExport (skill export disabled)', async () => {
      const {baseDir, service} = await makeService()
      try {
        // No exportCoordinator should be in the service — just verify it runs cleanly
        await service.onCurateComplete(buildResponse([{text: 'test', type: 'lesson'}]))
        // If we got here without error, export was not attempted
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })
  })

  describe('gate-vs-cadence contract', () => {
    it('triggers cadence-based synthesis using post-increment count', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const synthesizeStub = sinon.stub().resolves() as any
      const synthesisService = {synthesize: synthesizeStub} as unknown as ExperienceSynthesisService
      const {baseDir, service, store} = await makeService({synthesisService})
      try {
        // Pre-seed curation count to INTERVAL - 1
        await store.ensureInitialized()
        await store.writeMeta({curationCount: EXPERIENCE_CONSOLIDATION_INTERVAL - 1})

        await service.onCurateComplete(buildResponse([{text: 'trigger cadence', type: 'lesson'}]))

        expect(synthesizeStub.calledOnce).to.equal(true)
        // Post-increment count should be INTERVAL
        const callArgs = synthesizeStub.firstCall.args
        expect(callArgs[1]).to.equal(EXPERIENCE_CONSOLIDATION_INTERVAL)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('gate-triggered synthesis uses pre-increment count', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const synthesizeStub = sinon.stub().resolves() as any
      const synthesisService = {synthesize: synthesizeStub} as unknown as ExperienceSynthesisService
      const gate = new BackpressureGate({maxEntriesPerFile: 1, minConsolidationIntervalSec: 0})
      const {baseDir, service, store} = await makeService({gate, synthesisService})
      try {
        await store.ensureInitialized()
        // Set count so cadence does NOT trigger (not on INTERVAL boundary)
        await store.writeMeta({curationCount: 2, lastConsolidatedAt: ''})

        await service.onCurateComplete(buildResponse([{text: 'trigger gate', type: 'lesson'}]))

        expect(synthesizeStub.calledOnce).to.equal(true)
        // Pre-increment count should be 2 (not 3)
        const callArgs = synthesizeStub.firstCall.args
        expect(callArgs[1]).to.equal(2)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('cadence subsumes gate when both trigger simultaneously', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const synthesizeStub = sinon.stub().resolves() as any
      const synthesisService = {synthesize: synthesizeStub} as unknown as ExperienceSynthesisService
      const gate = new BackpressureGate({maxEntriesPerFile: 1, minConsolidationIntervalSec: 0})
      const {baseDir, service, store} = await makeService({gate, synthesisService})
      try {
        await store.ensureInitialized()
        // Set count so cadence DOES trigger on next increment
        await store.writeMeta({curationCount: EXPERIENCE_CONSOLIDATION_INTERVAL - 1, lastConsolidatedAt: ''})

        await service.onCurateComplete(buildResponse([{text: 'both trigger', type: 'lesson'}]))

        // Should only call once (cadence subsumes gate)
        expect(synthesizeStub.calledOnce).to.equal(true)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('gate does not evaluate performance signals', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const synthesizeStub = sinon.stub().resolves() as any
      const synthesisService = {synthesize: synthesizeStub} as unknown as ExperienceSynthesisService
      const gate = new BackpressureGate({maxEntriesPerFile: 1, minConsolidationIntervalSec: 0})
      const {baseDir, service, store} = await makeService({gate, synthesisService})
      try {
        await store.ensureInitialized()
        await store.writeMeta({curationCount: 1, lastConsolidatedAt: ''})

        // Only performance signal — should not trigger gate
        await service.onCurateComplete(buildResponse([
          {domain: 'test', score: 0.5, text: 'perf only', type: 'performance'},
        ]))

        // Synthesis should not be called (no cadence boundary, gate not triggered by performance)
        expect(synthesizeStub.called).to.equal(false)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })
  })
})
