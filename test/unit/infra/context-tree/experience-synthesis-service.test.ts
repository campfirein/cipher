import {expect} from 'chai'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sinon from 'sinon'

import type {IConsolidationLlm} from '../../../../src/server/core/interfaces/experience/i-consolidation-llm.js'

import {ExperienceStore} from '../../../../src/server/infra/context-tree/experience-store.js'
import {ExperienceSynthesisService} from '../../../../src/server/infra/context-tree/experience-synthesis-service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlm(response = 'Synthesized reflection content'): IConsolidationLlm {
  return {
    generate: sinon.stub().resolves(response),
  }
}

async function makeStoreWithEntries(
  subfolder: string,
  count: number,
): Promise<{baseDir: string; store: ExperienceStore}> {
  const baseDir = join(tmpdir(), `synthesis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(baseDir, {recursive: true})
  const store = new ExperienceStore(baseDir)
  await store.ensureInitialized()

  for (let i = 0; i < count; i++) {
    const iso = new Date().toISOString()
    // eslint-disable-next-line no-await-in-loop
    await store.createEntry(subfolder, `Entry body ${i}`, {
      contentHash: `hash${i}`,
      createdAt: iso,
      importance: 50,
      maturity: 'draft',
      recency: 1,
      tags: ['experience'],
      title: `Entry ${i}`,
      type: 'lesson',
      updatedAt: iso,
    })
  }

  return {baseDir, store}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceSynthesisService', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('synthesize()', () => {
    it('skips subfolders with fewer than 3 entries', async () => {
      const llm = makeLlm()
      const service = new ExperienceSynthesisService(llm)
      const {baseDir, store} = await makeStoreWithEntries('lessons', 2)

      try {
        await service.synthesize(store, 5)

        // LLM should not have been called
        expect((llm.generate as sinon.SinonStub).called).to.equal(false)

        // No reflection entry should exist
        const reflections = await store.listEntries('reflections')
        expect(reflections).to.have.length(0)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('creates a reflection entry when subfolder has 3+ entries', async () => {
      const llm = makeLlm('This is the synthesized insight.')
      const service = new ExperienceSynthesisService(llm)
      const {baseDir, store} = await makeStoreWithEntries('lessons', 4)

      try {
        await service.synthesize(store, 5)

        expect((llm.generate as sinon.SinonStub).calledOnce).to.equal(true)

        const reflections = await store.listEntries('reflections')
        expect(reflections).to.have.length(1)

        const content = await store.readEntry('reflections', reflections[0])
        expect(content).to.include('type: reflection')
        expect(content).to.include('derived_from:')
        expect(content).to.include('This is the synthesized insight.')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('overwrites the same-day synthesis file instead of creating duplicates', async () => {
      const llm1 = makeLlm('First synthesis content')
      const service1 = new ExperienceSynthesisService(llm1)
      const {baseDir, store} = await makeStoreWithEntries('lessons', 4)

      try {
        await service1.synthesize(store, 5)
        const reflectionsAfterFirst = await store.listEntries('reflections')
        expect(reflectionsAfterFirst).to.have.length(1)

        const llm2 = makeLlm('Second synthesis content')
        const service2 = new ExperienceSynthesisService(llm2)
        await service2.synthesize(store, 5)

        const reflectionsAfterSecond = await store.listEntries('reflections')
        expect(reflectionsAfterSecond).to.have.length(1)

        const content = await store.readEntry('reflections', reflectionsAfterSecond[0])
        expect(content).to.include('Second synthesis content')
        expect(content).not.to.include('First synthesis content')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('does not update lastConsolidatedAt when all subfolders are skipped', async () => {
      const llm = makeLlm()
      const service = new ExperienceSynthesisService(llm)
      const {baseDir, store} = await makeStoreWithEntries('lessons', 1)

      try {
        const metaBefore = await store.readMeta()
        await service.synthesize(store, 5)
        const metaAfter = await store.readMeta()

        expect(metaAfter.lastConsolidatedAt).to.equal(metaBefore.lastConsolidatedAt)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('does not update lastConsolidatedAt when LLM returns empty response', async () => {
      const llm = makeLlm('')
      const service = new ExperienceSynthesisService(llm)
      const {baseDir, store} = await makeStoreWithEntries('lessons', 4)

      try {
        const metaBefore = await store.readMeta()
        await service.synthesize(store, 5)
        const metaAfter = await store.readMeta()

        expect(metaAfter.lastConsolidatedAt).to.equal(metaBefore.lastConsolidatedAt)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('updates lastConsolidatedAt only when a reflection is written', async () => {
      const llm = makeLlm('Real synthesis content')
      const service = new ExperienceSynthesisService(llm)
      const {baseDir, store} = await makeStoreWithEntries('lessons', 3)

      try {
        await service.synthesize(store, 5)
        const meta = await store.readMeta()

        expect(meta.lastConsolidatedAt).to.not.equal('')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('includes strategies only on 3x cadence boundary', async () => {
      const baseDir = join(tmpdir(), `synthesis-cadence-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      await mkdir(baseDir, {recursive: true})
      const store = new ExperienceStore(baseDir)
      await store.ensureInitialized()

      // Seed both lessons and strategies with 3 entries each
      for (const subfolder of ['lessons', 'strategies']) {
        for (let i = 0; i < 3; i++) {
          const iso = new Date().toISOString()
          // eslint-disable-next-line no-await-in-loop
          await store.createEntry(subfolder, `${subfolder} ${i}`, {
            contentHash: `${subfolder}${i}cadence`,
            createdAt: iso,
            importance: 50,
            maturity: 'draft',
            recency: 1,
            tags: [],
            title: `${subfolder} ${i}`,
            type: subfolder === 'lessons' ? 'lesson' : 'strategy',
            updatedAt: iso,
          })
        }
      }

      try {
        // curationCount=5: INTERVAL boundary but NOT INTERVAL*3
        // → lessons synthesized, strategies NOT (3 targets, only lessons has entries that qualify)
        const llm1 = makeLlm('Synthesis at 5')
        const service1 = new ExperienceSynthesisService(llm1)
        await service1.synthesize(store, 5)
        const callsAt5 = (llm1.generate as sinon.SinonStub).callCount

        // curationCount=15: INTERVAL*3 boundary
        // → both lessons AND strategies synthesized (4 targets, strategies now included)
        const llm2 = makeLlm('Synthesis at 15')
        const service2 = new ExperienceSynthesisService(llm2)
        await service2.synthesize(store, 15)
        const callsAt15 = (llm2.generate as sinon.SinonStub).callCount

        // At count=15, strategies is added as a target, so we get one extra LLM call
        expect(callsAt15).to.be.greaterThan(callsAt5)
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })

    it('is fail-open per subfolder — one failure does not block others', async () => {
      let callCount = 0
      const llm: IConsolidationLlm = {
        async generate() {
          callCount++
          if (callCount === 1) throw new Error('LLM transient failure')

          return 'Synthesis from second call'
        },
      }
      const service = new ExperienceSynthesisService(llm)
      const baseDir = join(tmpdir(), `synthesis-failopen-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      await mkdir(baseDir, {recursive: true})
      const store = new ExperienceStore(baseDir)
      await store.ensureInitialized()

      // Seed both lessons and hints with 3 entries each
      for (const subfolder of ['lessons', 'hints']) {
        for (let i = 0; i < 3; i++) {
          const iso = new Date().toISOString()
          // eslint-disable-next-line no-await-in-loop
          await store.createEntry(subfolder, `${subfolder} entry ${i}`, {
            contentHash: `${subfolder}${i}`,
            createdAt: iso,
            importance: 50,
            maturity: 'draft',
            recency: 1,
            tags: [],
            title: `${subfolder} ${i}`,
            type: subfolder === 'lessons' ? 'lesson' : 'hint',
            updatedAt: iso,
          })
        }
      }

      try {
        // Should not throw even though first subfolder fails
        await service.synthesize(store, 5)

        // At least the non-failing subfolder should have produced a reflection
        const meta = await store.readMeta()
        expect(meta.lastConsolidatedAt).to.not.equal('')
      } finally {
        await rm(baseDir, {force: true, recursive: true})
      }
    })
  })
})
