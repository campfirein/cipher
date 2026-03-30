/**
 * End-to-end integration tests for the entry-based experience domain.
 *
 * Simulates user scenarios:
 * 1. Fresh project init creates the subdirectory structure
 * 2. Curate emits experience signals → individual entry files
 * 3. Performance signals route to JSONL log
 * 4. ContentHash dedup prevents duplicate entries
 * 5. Synthesis creates reflection entries with provenance
 * 6. Performance trend contributor generates prompt content
 * 7. All 6 signal types parse and route correctly
 * 8. Reflection signals create entries in reflections subfolder
 *
 * Artifacts are intentionally left in /tmp for manual review.
 */

import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ContributorContext} from '../../src/agent/core/domain/system-prompt/types.js'
import type {IConsolidationLlm} from '../../src/server/core/interfaces/experience/i-consolidation-llm.js'

import {PerformanceTrendContributor} from '../../src/agent/infra/system-prompt/contributors/performance-trend-contributor.js'
import {extractExperienceSignals, signalSubfolder} from '../../src/server/infra/context-tree/experience-extractor.js'
import {ExperienceHookService} from '../../src/server/infra/context-tree/experience-hook-service.js'
import {computeContentHash, ExperienceStore} from '../../src/server/infra/context-tree/experience-store.js'
import {ExperienceSynthesisService} from '../../src/server/infra/context-tree/experience-synthesis-service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCurateResponse(signals: Array<Record<string, unknown>>): string {
  return `Here is the curation result.\n\n\`\`\`experience\n${JSON.stringify(signals)}\n\`\`\``
}

const testDirs: string[] = []

async function makeTestDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `brv-e2e-${label}-`))
  testDirs.push(dir)

  return dir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Experience Domain E2E', function () {
  // These tests hit the filesystem — allow more time
  this.timeout(10_000)

  after(() => {
    console.log('\n  📂 Test artifacts left for review:')
    for (const dir of testDirs) {
      console.log(`     ${dir}`)
    }
  })

  it('Scenario 1: Fresh project init creates subdirectory structure', async () => {
    const baseDir = await makeTestDir('subdirs')
    const store = new ExperienceStore(baseDir)

    const created = await store.ensureInitialized()
    expect(created).to.equal(true)

    const expDir = join(baseDir, '.brv', 'context-tree', 'experience')
    expect(existsSync(join(expDir, 'lessons'))).to.equal(true)
    expect(existsSync(join(expDir, 'hints'))).to.equal(true)
    expect(existsSync(join(expDir, 'dead-ends'))).to.equal(true)
    expect(existsSync(join(expDir, 'strategies'))).to.equal(true)
    expect(existsSync(join(expDir, 'reflections'))).to.equal(true)
    expect(existsSync(join(expDir, 'performance'))).to.equal(true)
    expect(existsSync(join(expDir, '_meta.json'))).to.equal(true)

    const meta = await store.readMeta()
    expect(meta.curationCount).to.equal(0)
    expect(meta.lastConsolidatedAt).to.equal('')

    // Idempotent
    const created2 = await store.ensureInitialized()
    expect(created2).to.equal(false)
  })

  it('Scenario 2: Curate response creates individual entry files per signal', async () => {
    const baseDir = await makeTestDir('entries')
    const hookService = new ExperienceHookService({baseDirectory: baseDir})
    const store = new ExperienceStore(baseDir)

    const response = buildCurateResponse([
      {text: 'Always validate user input before processing', type: 'lesson'},
      {text: 'Use early returns to reduce nesting depth', type: 'hint'},
      {text: 'Regex-based HTML parsing fails on nested tags', type: 'dead-end'},
      {text: 'Apply circuit breaker pattern for external API calls', type: 'strategy'},
    ])
    await hookService.onCurateComplete(response)

    // Each signal type gets its own subfolder entry
    expect(await store.listEntries('lessons')).to.have.length(1)
    expect(await store.listEntries('hints')).to.have.length(1)
    expect(await store.listEntries('dead-ends')).to.have.length(1)
    expect(await store.listEntries('strategies')).to.have.length(1)

    // Verify entry content and frontmatter
    const lessons = await store.listEntries('lessons')
    const content = await store.readEntry('lessons', lessons[0])
    expect(content).to.include('Always validate user input')
    expect(content).to.include('type: lesson')
    expect(content).to.include('contentHash:')
    expect(lessons[0]).to.match(/^\d{4}-\d{2}-\d{2}--/)

    // Curation counter incremented
    const meta = await store.readMeta()
    expect(meta.curationCount).to.equal(1)
  })

  it('Scenario 3: Performance signals route to JSONL log, not .md entries', async () => {
    const baseDir = await makeTestDir('perf-log')
    const hookService = new ExperienceHookService({baseDirectory: baseDir})
    const store = new ExperienceStore(baseDir)

    const response = buildCurateResponse([
      {domain: 'code-review', score: 0.85, text: 'Good code review quality', type: 'performance'},
      {text: 'Side lesson from this curation', type: 'lesson'},
    ])
    await hookService.onCurateComplete(response)

    // Performance → JSONL
    const perfEntries = await store.readPerformanceLog()
    expect(perfEntries).to.have.length(1)
    expect(perfEntries[0].score).to.equal(0.85)
    expect(perfEntries[0].domain).to.equal('code-review')
    expect(perfEntries[0].summary).to.equal('Good code review quality')

    // Performance should NOT create .md entry
    const perfMdEntries = await store.listEntries('performance')
    expect(perfMdEntries).to.have.length(0)

    // Lesson should still be created alongside
    expect(await store.listEntries('lessons')).to.have.length(1)
  })

  it('Scenario 4: ContentHash dedup prevents duplicate entries across curations', async () => {
    const baseDir = await makeTestDir('dedup')
    const hookService = new ExperienceHookService({baseDirectory: baseDir})
    const store = new ExperienceStore(baseDir)

    const sameLesson = buildCurateResponse([
      {text: 'Always validate user input before processing', type: 'lesson'},
    ])

    // First curate
    await hookService.onCurateComplete(sameLesson)
    expect(await store.listEntries('lessons')).to.have.length(1)

    // Same text again → deduped
    await hookService.onCurateComplete(sameLesson)
    expect(await store.listEntries('lessons')).to.have.length(1)

    // Padded version → also deduped (trimmed before hashing)
    const paddedLesson = buildCurateResponse([
      {text: '  Always validate user input before processing  ', type: 'lesson'},
    ])
    await hookService.onCurateComplete(paddedLesson)
    expect(await store.listEntries('lessons')).to.have.length(1)

    // Different text → new entry
    const differentLesson = buildCurateResponse([
      {text: 'Different lesson about error handling', type: 'lesson'},
    ])
    await hookService.onCurateComplete(differentLesson)
    expect(await store.listEntries('lessons')).to.have.length(2)
  })

  it('Scenario 5: Synthesis creates reflection entries with provenance', async () => {
    const baseDir = await makeTestDir('synthesis')
    const store = new ExperienceStore(baseDir)
    await store.ensureInitialized()

    // Seed 4 lesson entries
    for (let i = 0; i < 4; i++) {
      const iso = new Date().toISOString()
      // eslint-disable-next-line no-await-in-loop
      await store.createEntry('lessons', `Lesson body number ${i} about code quality and patterns`, {
        contentHash: computeContentHash(`lesson-synth-${i}`),
        createdAt: iso,
        importance: 50,
        maturity: 'draft',
        recency: 1,
        tags: ['experience', 'lesson'],
        title: `Lesson ${i}`,
        type: 'lesson',
        updatedAt: iso,
      })
    }

    const mockLlm: IConsolidationLlm = {
      async generate(_instructions: string, userMessage: string): Promise<string> {
        // Verify the prompt includes entry content
        if (!userMessage.includes('Lesson body number')) {
          throw new Error('LLM prompt did not include entry bodies')
        }

        return 'Across the four lessons, a clear pattern emerges: input validation and error handling are the most frequently encountered concerns.'
      },
    }

    const synthesisService = new ExperienceSynthesisService(mockLlm)
    await synthesisService.synthesize(store, 5)

    // Reflection entry created
    const reflections = await store.listEntries('reflections')
    expect(reflections).to.have.length(1)

    const content = await store.readEntry('reflections', reflections[0])
    expect(content).to.include('type: reflection')
    expect(content).to.include('derived_from:')
    expect(content).to.include('pattern emerges')

    // Original entries preserved
    expect(await store.listEntries('lessons')).to.have.length(4)

    // lastConsolidatedAt updated
    const meta = await store.readMeta()
    expect(meta.lastConsolidatedAt).to.not.equal('')
  })

  it('Scenario 6: Performance trend contributor generates per-domain rolling averages', async () => {
    const baseDir = await makeTestDir('trends')
    const store = new ExperienceStore(baseDir)
    await store.ensureInitialized()

    // Seed performance log with upward trend
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.appendPerformanceLog({
        curationId: i,
        domain: 'code-review',
        score: 0.7 + (i * 0.05),
        summary: `Curation ${i}`,
        ts: new Date().toISOString(),
      })
    }

    const contributor = new PerformanceTrendContributor('performanceTrend', 17, {
      workingDirectory: baseDir,
    })

    // Returns content for curate command
    const curateCtx: ContributorContext = {commandType: 'curate'}
    const content = await contributor.getContent(curateCtx)
    expect(content).to.include('<performance-trends>')
    expect(content).to.include('code-review')
    expect(content).to.include('5 tasks')
    expect(content).to.include('trending up')

    // Returns empty for chat command
    const chatCtx: ContributorContext = {commandType: 'chat'}
    expect(await contributor.getContent(chatCtx)).to.equal('')
  })

  it('Scenario 7: Extractor handles all 6 signal types', () => {
    const response = buildCurateResponse([
      {text: 'a lesson', type: 'lesson'},
      {text: 'a hint', type: 'hint'},
      {text: 'a dead end', type: 'dead-end'},
      {text: 'a strategy', type: 'strategy'},
      {domain: 'review', score: 0.75, text: 'quality ok', type: 'performance'},
      {text: 'noticed a pattern', type: 'reflection'},
    ])

    const signals = extractExperienceSignals(response)
    expect(signals).to.have.length(6)
    expect(signals.map((s) => s.type)).to.deep.equal([
      'lesson', 'hint', 'dead-end', 'strategy', 'performance', 'reflection',
    ])

    // Subfolder routing
    expect(signalSubfolder('lesson')).to.equal('lessons')
    expect(signalSubfolder('hint')).to.equal('hints')
    expect(signalSubfolder('dead-end')).to.equal('dead-ends')
    expect(signalSubfolder('strategy')).to.equal('strategies')
    expect(signalSubfolder('performance')).to.equal('performance')
    expect(signalSubfolder('reflection')).to.equal('reflections')

    // Invalid performance signal rejected
    const badPerf = buildCurateResponse([
      {domain: 'test', text: 'missing score', type: 'performance'},
    ])
    expect(extractExperienceSignals(badPerf)).to.have.length(0)
  })

  it('Scenario 8: Reflection signals create entries via hook service', async () => {
    const baseDir = await makeTestDir('reflections')
    const hookService = new ExperienceHookService({baseDirectory: baseDir})
    const store = new ExperienceStore(baseDir)

    const response = buildCurateResponse([
      {text: 'Most bugs in this codebase stem from missing null checks at API boundaries', type: 'reflection'},
    ])
    await hookService.onCurateComplete(response)

    const reflections = await store.listEntries('reflections')
    expect(reflections).to.have.length(1)

    const content = await store.readEntry('reflections', reflections[0])
    expect(content).to.include('missing null checks')
    expect(content).to.include('type: reflection')
  })
})
