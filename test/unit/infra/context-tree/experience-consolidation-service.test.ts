import {expect} from 'chai'
import sinon, {type SinonStub} from 'sinon'

import type {IConsolidationLlm} from '../../../../src/server/core/interfaces/experience/i-consolidation-llm.js'

import {
  EXPERIENCE_CONSOLIDATION_INTERVAL,
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../../../src/server/constants.js'
import {ExperienceConsolidationService} from '../../../../src/server/infra/context-tree/experience-consolidation-service.js'
import {EXPERIENCE_SECTIONS, type ExperienceStore} from '../../../../src/server/infra/context-tree/experience-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build minimal valid frontmatter content for a given section. */
function buildContent(
  section: string,
  bullets: string[] = [],
  scoring: {importance?: number; recency?: number; updateCount?: number} = {},
): string {
  const now = new Date().toISOString()
  const bulletBlock = bullets.map((b) => `- ${b}`).join('\n')
  return [
    '---',
    'title: "Experience: Test"',
    'tags: []',
    'keywords: []',
    `importance: ${scoring.importance ?? 70}`,
    `recency: ${scoring.recency ?? 1}`,
    'maturity: validated',
    'accessCount: 0',
    `updateCount: ${scoring.updateCount ?? 0}`,
    `createdAt: "${now}"`,
    `updatedAt: "${now}"`,
    '---',
    '',
    `## ${section}`,
    '',
    bulletBlock,
  ].join('\n')
}

function makeStore(overrides: Partial<Record<keyof ExperienceStore, SinonStub>> = {}): ExperienceStore {
  return {
    appendBulkToFile: sinon.stub().resolves(),
    ensureInitialized: sinon.stub().resolves(false),
    incrementCurationCount: sinon.stub().resolves({curationCount: 1, lastConsolidatedAt: ''}),
    readFile: sinon.stub(),
    readMeta: sinon.stub().resolves({curationCount: 0, lastConsolidatedAt: ''}),
    readSectionLines: sinon.stub(),
    writeFile: sinon.stub().resolves(),
    writeMeta: sinon.stub().resolves(),
    ...overrides,
  } as unknown as ExperienceStore
}

function makeLlm(response = '["refined bullet"]'): IConsolidationLlm & {generate: SinonStub} {
  return {generate: sinon.stub().resolves(response)}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceConsolidationService', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  // -------------------------------------------------------------------------
  // consolidateFile — skip conditions
  // -------------------------------------------------------------------------

  describe('consolidateFile() — skip conditions', () => {
    it('skips LLM call when a file has 0 bullets', async () => {
      const llm = makeLlm()
      const store = makeStore()
      ;(store.readFile as SinonStub).resolves(buildContent(EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE], []))
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect(llm.generate.called).to.be.false
    })

    it('skips LLM call when a file has only 1 bullet', async () => {
      const llm = makeLlm()
      const store = makeStore()
      ;(store.readFile as SinonStub).resolves(
        buildContent(EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE], ['only one bullet']),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect(llm.generate.called).to.be.false
    })

    it('skips writeFile when LLM returns an empty JSON array', async () => {
      const llm = makeLlm('[]')
      const store = makeStore()
      ;(store.readFile as SinonStub).resolves(
        buildContent(EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE], ['bullet A', 'bullet B']),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect((store.writeFile as SinonStub).called).to.be.false
    })

    it('skips writeFile when file has no frontmatter', async () => {
      const llm = makeLlm('["refined"]')
      const store = makeStore()
      ;(store.readFile as SinonStub).resolves('## Facts\n- bullet A\n- bullet B\n')
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect((store.writeFile as SinonStub).called).to.be.false
    })
  })

  // -------------------------------------------------------------------------
  // consolidateFile — successful consolidation
  // -------------------------------------------------------------------------

  describe('consolidateFile() — successful consolidation', () => {
    it('calls LLM with the bullet content in the user message', async () => {
      const llm = makeLlm('["refined bullet"]')
      const store = makeStore()
      const bullets = ['first lesson', 'second lesson']
      ;(store.readFile as SinonStub).resolves(buildContent(EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE], bullets))
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect(llm.generate.called).to.be.true
      const userMessage: string = llm.generate.firstCall.args[1]
      expect(userMessage).to.include('first lesson')
      expect(userMessage).to.include('second lesson')
    })

    it('writes consolidated bullets replacing the original section content', async () => {
      const llm = makeLlm('["consolidated lesson"]')
      const store = makeStore()
      const section = EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE]
      const bullets = ['lesson A', 'lesson B', 'lesson A duplicate']
      // Only lessons file has bullets — prevents other files from being processed
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(filename === EXPERIENCE_LESSONS_FILE ? buildContent(section, bullets) : buildContent('Other', [])),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect((store.writeFile as SinonStub).calledOnce).to.be.true
      const writtenContent = (store.writeFile as SinonStub).firstCall.args[1] as string
      expect(writtenContent).to.include('- consolidated lesson')
      expect(writtenContent).to.not.include('- lesson A')
    })

    it('preserves importance, recency, and updateCount while updating updatedAt', async () => {
      const llm = makeLlm('["refined"]')
      const store = makeStore()
      const section = EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE]
      const bullets = ['bullet X', 'bullet Y']
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(
          filename === EXPERIENCE_LESSONS_FILE
            ? buildContent(section, bullets, {importance: 70, recency: 0.4, updateCount: 3})
            : buildContent('Other', []),
        ),
      )
      const service = new ExperienceConsolidationService(llm)

      const before = Date.now()
      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      const writtenContent = (store.writeFile as SinonStub).firstCall.args[1] as string
      expect(writtenContent).to.match(/importance:\s*70/)
      expect(writtenContent).to.match(/recency:\s*0\.4/)
      expect(writtenContent).to.match(/updateCount:\s*3/)
      // updatedAt must be present (yaml may use single or double quotes)
      const updatedAtMatch = /updatedAt:\s*['"]([^'"]+)['"]/.exec(writtenContent)
      expect(updatedAtMatch).to.not.be.null
      expect(new Date(updatedAtMatch![1]).getTime()).to.be.greaterThanOrEqual(before)
    })

    it('salvages valid strings when LLM returns a mixed array with non-string elements', async () => {
      const llm = makeLlm('["keep this", null, "also keep", 42]')
      const store = makeStore()
      const section = EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE]
      const bullets = ['lesson A', 'lesson B']
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(filename === EXPERIENCE_LESSONS_FILE ? buildContent(section, bullets) : buildContent('Other', [])),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      const writtenContent = (store.writeFile as SinonStub).firstCall.args[1] as string
      expect(writtenContent).to.include('- keep this')
      expect(writtenContent).to.include('- also keep')
      expect(writtenContent).to.not.include('null')
      expect(writtenContent).to.not.include('42')
    })

    it('falls back to markdown bullet parsing when LLM returns a bulleted list', async () => {
      const llm = makeLlm('- refined bullet one\n- refined bullet two')
      const store = makeStore()
      const section = EXPERIENCE_SECTIONS[EXPERIENCE_HINTS_FILE]
      const bullets = ['raw hint A', 'raw hint B']
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(filename === EXPERIENCE_HINTS_FILE ? buildContent(section, bullets) : buildContent('Other', [])),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      const writtenContent = (store.writeFile as SinonStub).firstCall.args[1] as string
      expect(writtenContent).to.include('- refined bullet one')
      expect(writtenContent).to.include('- refined bullet two')
    })
  })

  // -------------------------------------------------------------------------
  // consolidate() — file targets and cadence
  // -------------------------------------------------------------------------

  describe('consolidate() — file targets', () => {
    it('consolidates lessons, hints, and dead-ends at every interval', async () => {
      const llm = makeLlm('["refined"]')
      const store = makeStore()
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(buildContent(EXPERIENCE_SECTIONS[filename] ?? 'Facts', ['bullet 1', 'bullet 2'])),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      const writtenFiles = (store.writeFile as SinonStub).args.map((args: unknown[]) => args[0] as string)
      expect(writtenFiles).to.include(EXPERIENCE_LESSONS_FILE)
      expect(writtenFiles).to.include(EXPERIENCE_HINTS_FILE)
      expect(writtenFiles).to.include(EXPERIENCE_DEAD_ENDS_FILE)
    })

    it('does NOT consolidate playbook at plain INTERVAL (only every INTERVAL*3)', async () => {
      const llm = makeLlm('["refined"]')
      const store = makeStore()
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(buildContent(EXPERIENCE_SECTIONS[filename] ?? 'Facts', ['bullet 1', 'bullet 2'])),
      )
      const service = new ExperienceConsolidationService(llm)

      // curationCount=5 is plain INTERVAL but not INTERVAL*3
      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      const writtenFiles = (store.writeFile as SinonStub).args.map((args: unknown[]) => args[0] as string)
      expect(writtenFiles).to.not.include(EXPERIENCE_PLAYBOOK_FILE)
    })

    it('does NOT consolidate playbook when curationCount is 0', async () => {
      const llm = makeLlm('["refined"]')
      const store = makeStore()
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(buildContent(EXPERIENCE_SECTIONS[filename] ?? 'Facts', ['bullet 1', 'bullet 2'])),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, 0)

      const writtenFiles = (store.writeFile as SinonStub).args.map((args: unknown[]) => args[0] as string)
      expect(writtenFiles).to.include(EXPERIENCE_LESSONS_FILE)
      expect(writtenFiles).to.include(EXPERIENCE_HINTS_FILE)
      expect(writtenFiles).to.include(EXPERIENCE_DEAD_ENDS_FILE)
      expect(writtenFiles).to.not.include(EXPERIENCE_PLAYBOOK_FILE)
    })

    it('consolidates playbook at INTERVAL * 3', async () => {
      const llm = makeLlm('["refined"]')
      const store = makeStore()
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(buildContent(EXPERIENCE_SECTIONS[filename] ?? 'Facts', ['bullet 1', 'bullet 2'])),
      )
      const service = new ExperienceConsolidationService(llm)

      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL * 3)

      const writtenFiles = (store.writeFile as SinonStub).args.map((args: unknown[]) => args[0] as string)
      expect(writtenFiles).to.include(EXPERIENCE_PLAYBOOK_FILE)
    })

    it('updates meta.lastConsolidatedAt after consolidation', async () => {
      const llm = makeLlm()
      const store = makeStore()
      ;(store.readFile as SinonStub).resolves(buildContent(EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE], []))
      const service = new ExperienceConsolidationService(llm)

      const before = Date.now()
      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      expect((store.writeMeta as SinonStub).calledOnce).to.be.true
      const [{lastConsolidatedAt}] = (store.writeMeta as SinonStub).firstCall.args
      expect(new Date(lastConsolidatedAt as string).getTime()).to.be.greaterThanOrEqual(before)
    })
  })

  // -------------------------------------------------------------------------
  // consolidate() — fail-open
  // -------------------------------------------------------------------------

  describe('consolidate() — fail-open', () => {
    it('processes remaining files even when one file throws during LLM call', async () => {
      let callCount = 0
      const llm: IConsolidationLlm = {
        async generate() {
          callCount++
          if (callCount === 1) throw new Error('LLM timeout')
          return '["refined"]'
        },
      }
      const store = makeStore()
      ;(store.readFile as SinonStub).callsFake((filename: string) =>
        Promise.resolve(buildContent(EXPERIENCE_SECTIONS[filename] ?? 'Facts', ['bullet 1', 'bullet 2'])),
      )
      const service = new ExperienceConsolidationService(llm)

      // Should not throw even though first file errors
      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)

      // At least the non-failing files must have been written
      expect((store.writeFile as SinonStub).callCount).to.be.greaterThan(0)
    })

    it('does not throw when writeMeta fails', async () => {
      const llm = makeLlm()
      const store = makeStore()
      ;(store.readFile as SinonStub).resolves(buildContent(EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE], []))
      ;(store.writeMeta as SinonStub).rejects(new Error('disk full'))
      const service = new ExperienceConsolidationService(llm)

      // Must not throw
      await service.consolidate(store, EXPERIENCE_CONSOLIDATION_INTERVAL)
    })
  })
})
