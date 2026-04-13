import {expect} from 'chai'
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {LocalMarkdownAdapter} from '../../../../../src/agent/infra/swarm/adapters/local-markdown-adapter.js'
import {POST_EXPANSION_GAP_RATIO} from '../../../../../src/agent/infra/swarm/search-precision.js'

describe('LocalMarkdownAdapter', () => {
  let testDir: string
  let adapter: LocalMarkdownAdapter

  beforeEach(() => {
    testDir = join(tmpdir(), `local-md-adapter-test-${Date.now()}`)
    mkdirSync(testDir, {recursive: true})
    adapter = new LocalMarkdownAdapter(testDir, 'test-notes')
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, {force: true, recursive: true})
    }
  })

  it('has correct id and type', () => {
    expect(adapter.id).to.equal('local-markdown:test-notes')
    expect(adapter.type).to.equal('local-markdown')
  })

  it('reports correct capabilities', () => {
    expect(adapter.capabilities.keywordSearch).to.be.true
    expect(adapter.capabilities.graphTraversal).to.be.true
    expect(adapter.capabilities.localOnly).to.be.true
    expect(adapter.capabilities.writeSupported).to.be.true
  })

  it('healthCheck returns available when folder exists', async () => {
    const status = await adapter.healthCheck()
    expect(status.available).to.be.true
  })

  it('healthCheck returns unavailable when folder missing', async () => {
    const badAdapter = new LocalMarkdownAdapter('/nonexistent/folder', 'bad')
    const status = await badAdapter.healthCheck()
    expect(status.available).to.be.false
  })

  it('queries and returns results from .md files', async () => {
    writeFileSync(join(testDir, 'skill-1.md'), '# TypeScript Generics\nAdvanced generics patterns.')
    writeFileSync(join(testDir, 'skill-2.md'), '# React Hooks\nCustom hooks for state management.')

    const results = await adapter.query({query: 'typescript generics'})
    expect(results.length).to.be.greaterThan(0)
    expect(results[0].provider).to.equal('local-markdown:test-notes')
    expect(results[0].metadata.matchType).to.equal('keyword')
  })

  it('follows wikilinks one hop', async () => {
    writeFileSync(join(testDir, 'index.md'), '# Index\nSee [[advanced-patterns]] for details.')
    writeFileSync(join(testDir, 'advanced-patterns.md'), '# Advanced Patterns\nDecorator pattern details.')

    const results = await adapter.query({query: 'index'})
    const paths = results.map((r) => r.metadata.path)
    expect(paths).to.include('index.md')
    expect(paths).to.include('advanced-patterns.md')
  })

  it('store creates a new .md file', async () => {
    const result = await adapter.store({
      content: '# New Note\nSome content here.',
      metadata: {source: 'agent', timestamp: Date.now()},
    })
    expect(result.success).to.be.true

    // Verify file was created
    const files = existsSync(join(testDir, 'new-note.md'))
    expect(files).to.be.true
    const content = readFileSync(join(testDir, 'new-note.md'), 'utf8')
    expect(content).to.include('New Note')
  })

  it('store generates a unique filename when the title already exists', async () => {
    await adapter.store({
      content: '# Shared Title\nOriginal content.',
      metadata: {source: 'agent', timestamp: Date.now()},
    })
    const second = await adapter.store({
      content: '# Shared Title\nUpdated content.',
      metadata: {source: 'agent', timestamp: Date.now()},
    })

    expect(existsSync(join(testDir, 'shared-title.md'))).to.be.true
    expect(existsSync(join(testDir, 'shared-title-1.md'))).to.be.true
    expect(second.id).to.equal('shared-title-1.md')
    expect(readFileSync(join(testDir, 'shared-title.md'), 'utf8')).to.include('Original content')
    expect(readFileSync(join(testDir, 'shared-title-1.md'), 'utf8')).to.include('Updated content')
  })

  it('refreshes the index when files are added outside the adapter', async () => {
    writeFileSync(join(testDir, 'existing.md'), '# Existing\nInitial content.')
    await adapter.query({query: 'existing'})

    writeFileSync(join(testDir, 'fresh.md'), '# Fresh Note\nBrand new content.')

    const results = await adapter.query({query: 'fresh'})
    expect(results.map((r) => r.metadata.path)).to.include('fresh.md')
  })

  it('respects maxResults', async () => {
    for (let i = 0; i < 15; i++) {
      writeFileSync(join(testDir, `note-${i}.md`), `# Note ${i}\nContent about topic ${i}.`)
    }

    const results = await adapter.query({maxResults: 3, query: 'note'})
    expect(results.length).to.be.at.most(3)
  })

  it('estimateCost returns zero', () => {
    const cost = adapter.estimateCost({query: 'test'})
    expect(cost.estimatedCostCents).to.equal(0)
  })

  it('reports writeSupported=false when readOnly is true', () => {
    const readOnlyAdapter = new LocalMarkdownAdapter(testDir, 'ro', {readOnly: true})
    expect(readOnlyAdapter.capabilities.writeSupported).to.be.false
  })

  it('store throws when readOnly is true', async () => {
    const readOnlyAdapter = new LocalMarkdownAdapter(testDir, 'ro', {readOnly: true})
    try {
      await readOnlyAdapter.store({content: '# Test', metadata: {source: 'agent', timestamp: Date.now()}})
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('read-only')
    }
  })

  it('does not pick up new files when watchForChanges is false', async () => {
    writeFileSync(join(testDir, 'initial.md'), '# Initial\nInitial content about topics.')

    const frozenAdapter = new LocalMarkdownAdapter(testDir, 'frozen', {watchForChanges: false})
    const firstResults = await frozenAdapter.query({query: 'initial'})
    expect(firstResults.length).to.be.greaterThan(0)

    // Add a new file after the index is built
    writeFileSync(join(testDir, 'added-later.md'), '# Added Later\nNew content about topics.')

    const secondResults = await frozenAdapter.query({query: 'added later'})
    // Should NOT find the new file — index is frozen
    const paths = secondResults.map((r) => r.metadata.path)
    expect(paths).to.not.include('added-later.md')
  })

  it('does not follow wikilinks when followWikilinks is false', async () => {
    writeFileSync(join(testDir, 'index.md'), '# Index\nSee [[linked-note]] for details.')
    writeFileSync(join(testDir, 'linked-note.md'), '# Linked Note\nThis is linked content.')

    const noWikiAdapter = new LocalMarkdownAdapter(testDir, 'no-wiki', {followWikilinks: false})
    const results = await noWikiAdapter.query({query: 'index'})

    // Should NOT include linked-note via graph expansion
    const paths = results.map((r) => r.metadata.path)
    expect(paths).to.not.include('linked-note.md')
  })

  describe('precision filtering', () => {
    it('returns empty when best match scores below floor', async () => {
      writeFileSync(join(testDir, 'cooking.md'), '# Pasta Recipe\nHow to cook pasta with tomato sauce.')
      writeFileSync(join(testDir, 'gardening.md'), '# Gardening Tips\nPlant roses in spring season.')

      // "quantum computing" won't match any content well
      const results = await adapter.query({query: 'quantum computing'})
      expect(results).to.have.length(0)
    })

    it('drops low-scoring results via gap ratio', async () => {
      // Create one strong match and several weak matches
      writeFileSync(join(testDir, 'project-management.md'), '# Project Management\nProject management with agile methodologies for software teams.')
      writeFileSync(join(testDir, 'session-mgmt.md'), '# Session Management\nHTTP session management using JWT tokens for authentication.')
      writeFileSync(join(testDir, 'time-mgmt.md'), '# Time Management\nTime management tips for productivity improvement.')

      // "project management" should strongly match the first file
      const results = await adapter.query({query: 'project management'})

      if (results.length > 0) {
        const topScore = results[0].score
        for (const r of results) {
          // All results should be within post-expansion gap ratio of top score
          expect(r.score).to.be.at.least(topScore * POST_EXPANSION_GAP_RATIO, `Result ${r.metadata.path} score ${r.score} below gap floor`)
        }
      }
    })

    it('uses AND-first for multi-word queries', async () => {
      writeFileSync(join(testDir, 'ts-generics.md'), '# TypeScript Generics\nTypeScript generics allow reusable typed components.')
      writeFileSync(join(testDir, 'py-generics.md'), '# Python Generics\nPython generics are for type hints.')
      writeFileSync(join(testDir, 'ts-classes.md'), '# TypeScript Classes\nTypeScript classes provide OOP patterns.')

      const results = await adapter.query({query: 'typescript generics'})
      expect(results.length).to.be.greaterThan(0)
      // Doc with both "typescript" AND "generics" should rank first
      expect(results[0].metadata.path).to.equal('ts-generics.md')
    })

    it('second gap-ratio pass filters weak wikilink-expanded results', async () => {
      // Strong match links to a completely unrelated doc
      writeFileSync(join(testDir, 'auth-system.md'), '# Authentication System\nJWT authentication with token refresh. See [[cooking-recipe]] for unrelated stuff.')
      writeFileSync(join(testDir, 'cooking-recipe.md'), '# Cooking Recipe\nHow to make a delicious chocolate cake with vanilla frosting.')

      const results = await adapter.query({query: 'authentication JWT token'})

      // cooking-recipe should either not appear (gap-filtered) or be within post-expansion gap ratio
      const cookingResult = results.find((r) => r.metadata.path === 'cooking-recipe.md')
      if (cookingResult) {
        expect(cookingResult.score).to.be.at.least(results[0].score * POST_EXPANSION_GAP_RATIO)
      }
    })
  })
})
