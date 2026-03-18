import {expect} from 'chai'
import sinon, {type SinonStub} from 'sinon'

import {
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../../../../src/server/constants.js'
import {SkillKnowledgeBuilder} from '../../../../../src/server/infra/connectors/skill/skill-knowledge-builder.js'
import {type ExperienceStore} from '../../../../../src/server/infra/context-tree/experience-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<Record<keyof ExperienceStore, SinonStub>> = {}): ExperienceStore {
  return {
    appendBulkToFile: sinon.stub().resolves(),
    ensureInitialized: sinon.stub().resolves(false),
    incrementCurationCount: sinon.stub().resolves({curationCount: 1, lastConsolidatedAt: ''}),
    readFile: sinon.stub(),
    readMeta: sinon.stub().resolves({curationCount: 5, lastConsolidatedAt: ''}),
    readSectionLines: sinon.stub(),
    writeFile: sinon.stub().resolves(),
    writeMeta: sinon.stub().resolves(),
    ...overrides,
  } as unknown as ExperienceStore
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillKnowledgeBuilder', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  // -------------------------------------------------------------------------
  // build()
  // -------------------------------------------------------------------------

  describe('build()', () => {
    it('returns block with all sections when all sections are populated', async () => {
      const store = makeStore()
      ;(store.readSectionLines as SinonStub).callsFake((filename: string) => {
        const map: Record<string, string[]> = {
          [EXPERIENCE_DEAD_ENDS_FILE]: ['dead end one'],
          [EXPERIENCE_HINTS_FILE]: ['hint one'],
          [EXPERIENCE_LESSONS_FILE]: ['lesson one', 'lesson two'],
          [EXPERIENCE_PLAYBOOK_FILE]: ['strategy one'],
        }

        return Promise.resolve(map[filename] ?? [])
      })

      const builder = new SkillKnowledgeBuilder(store)
      const result = await builder.build()

      expect(result).to.include('## Project Knowledge (Auto-Updated)')
      expect(result).to.include('### Lessons Learned')
      expect(result).to.include('- lesson one')
      expect(result).to.include('- lesson two')
      expect(result).to.include('### Hints & Tips')
      expect(result).to.include('- hint one')
      expect(result).to.include('### Dead Ends (Avoid These)')
      expect(result).to.include('- dead end one')
      expect(result).to.include('### Strategies')
      expect(result).to.include('- strategy one')
      expect(result).to.include('5 curations')
    })

    it('omits empty sections from the rendered block', async () => {
      const store = makeStore()
      ;(store.readSectionLines as SinonStub).callsFake((filename: string) => {
        if (filename === EXPERIENCE_LESSONS_FILE) {
          return Promise.resolve(['lesson one'])
        }

        return Promise.resolve([])
      })

      const builder = new SkillKnowledgeBuilder(store)
      const result = await builder.build()

      expect(result).to.include('### Lessons Learned')
      expect(result).to.include('- lesson one')
      expect(result).to.not.include('### Hints & Tips')
      expect(result).to.not.include('### Dead Ends')
      expect(result).to.not.include('### Strategies')
    })

    it('returns empty string when all sections are empty', async () => {
      const store = makeStore()
      ;(store.readSectionLines as SinonStub).resolves([])

      const builder = new SkillKnowledgeBuilder(store)
      const result = await builder.build()

      expect(result).to.equal('')
    })

    it('returns [] for a section when readSectionLines throws (fail-open)', async () => {
      const store = makeStore()
      ;(store.readSectionLines as SinonStub).callsFake((filename: string) => {
        if (filename === EXPERIENCE_LESSONS_FILE) {
          return Promise.reject(new Error('file not found'))
        }

        if (filename === EXPERIENCE_HINTS_FILE) {
          return Promise.resolve(['hint survives'])
        }

        return Promise.resolve([])
      })

      const builder = new SkillKnowledgeBuilder(store)
      const result = await builder.build()

      // The error section is silently skipped; the surviving section still renders
      expect(result).to.not.include('### Lessons Learned')
      expect(result).to.include('### Hints & Tips')
      expect(result).to.include('- hint survives')
    })
  })

  // -------------------------------------------------------------------------
  // spliceIntoContent()
  // -------------------------------------------------------------------------

  describe('spliceIntoContent()', () => {
    it('replaces block between existing markers', () => {
      const store = makeStore()
      const builder = new SkillKnowledgeBuilder(store)

      const existing = [
        '# My Skill',
        '',
        '---',
        '',
        '<!-- brv:auto-knowledge:start -->',
        'old content here',
        '<!-- brv:auto-knowledge:end -->',
      ].join('\n')

      const result = builder.spliceIntoContent(existing, 'new block')

      expect(result).to.include('# My Skill')
      expect(result).to.include('<!-- brv:auto-knowledge:start -->\nnew block\n<!-- brv:auto-knowledge:end -->')
      expect(result).to.not.include('old content here')
    })

    it('appends with --- separator when no markers exist and block is non-empty', () => {
      const store = makeStore()
      const builder = new SkillKnowledgeBuilder(store)

      const existing = '# My Skill\n\nSome user content.\n'
      const result = builder.spliceIntoContent(existing, 'appended block')

      expect(result).to.include('# My Skill')
      expect(result).to.include('Some user content.')
      expect(result).to.include('\n\n---\n\n')
      expect(result).to.include('<!-- brv:auto-knowledge:start -->\nappended block\n<!-- brv:auto-knowledge:end -->')
    })

    it('removes markers and content when block is empty and markers exist (cleanup)', () => {
      const store = makeStore()
      const builder = new SkillKnowledgeBuilder(store)

      const existing = [
        '# My Skill',
        '',
        '---',
        '',
        '<!-- brv:auto-knowledge:start -->',
        'stale content',
        '<!-- brv:auto-knowledge:end -->',
      ].join('\n')

      const result = builder.spliceIntoContent(existing, '')

      expect(result).to.not.include('<!-- brv:auto-knowledge:start -->')
      expect(result).to.not.include('<!-- brv:auto-knowledge:end -->')
      expect(result).to.not.include('stale content')
      expect(result).to.include('# My Skill')
    })

    it('returns content unchanged when block is empty and no markers exist', () => {
      const store = makeStore()
      const builder = new SkillKnowledgeBuilder(store)

      const existing = '# My Skill\n\nClean content.\n'
      const result = builder.spliceIntoContent(existing, '')

      expect(result).to.equal(existing)
    })

    it('preserves user content outside markers', () => {
      const store = makeStore()
      const builder = new SkillKnowledgeBuilder(store)

      const existing = [
        '# My Skill',
        '',
        'User wrote this.',
        '',
        '---',
        '',
        '<!-- brv:auto-knowledge:start -->',
        'old auto block',
        '<!-- brv:auto-knowledge:end -->',
        '',
        'User footer.',
      ].join('\n')

      const result = builder.spliceIntoContent(existing, 'updated block')

      expect(result).to.include('User wrote this.')
      expect(result).to.include('User footer.')
      expect(result).to.include('<!-- brv:auto-knowledge:start -->\nupdated block\n<!-- brv:auto-knowledge:end -->')
      expect(result).to.not.include('old auto block')
    })
  })
})
