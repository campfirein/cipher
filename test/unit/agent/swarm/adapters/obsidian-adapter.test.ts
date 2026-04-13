import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ObsidianAdapter} from '../../../../../src/agent/infra/swarm/adapters/obsidian-adapter.js'
import {POST_EXPANSION_GAP_RATIO} from '../../../../../src/agent/infra/swarm/search-precision.js'

describe('ObsidianAdapter', () => {
  let testDir: string
  let adapter: ObsidianAdapter

  beforeEach(() => {
    testDir = join(tmpdir(), `obsidian-adapter-test-${Date.now()}`)
    mkdirSync(join(testDir, '.obsidian'), {recursive: true})
    adapter = new ObsidianAdapter(testDir)
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, {force: true, recursive: true})
    }
  })

  it('has correct id and type', () => {
    expect(adapter.id).to.equal('obsidian')
    expect(adapter.type).to.equal('obsidian')
  })

  it('reports correct capabilities', () => {
    expect(adapter.capabilities.keywordSearch).to.be.true
    expect(adapter.capabilities.graphTraversal).to.be.true
    expect(adapter.capabilities.localOnly).to.be.true
    expect(adapter.capabilities.writeSupported).to.be.false
  })

  it('healthCheck returns available when vault path exists', async () => {
    const status = await adapter.healthCheck()
    expect(status.available).to.be.true
  })

  it('healthCheck returns unavailable when vault path missing', async () => {
    const badAdapter = new ObsidianAdapter('/nonexistent/vault')
    const status = await badAdapter.healthCheck()
    expect(status.available).to.be.false
  })

  it('queries and returns results from .md files', async () => {
    writeFileSync(join(testDir, 'auth-tokens.md'), '# Auth Tokens\nHow to rotate auth tokens safely.')
    writeFileSync(join(testDir, 'jwt-refresh.md'), '# JWT Refresh\nJWT refresh token strategy.')

    const results = await adapter.query({query: 'auth tokens'})
    expect(results.length).to.be.greaterThan(0)
    expect(results[0].provider).to.equal('obsidian')
    expect(results[0].metadata.matchType).to.equal('keyword')
    expect(results[0].score).to.be.at.least(0)
    expect(results[0].score).to.be.at.most(1)
  })

  it('follows wikilinks one hop for graph expansion', async () => {
    writeFileSync(join(testDir, 'auth.md'), '# Auth\nSee [[jwt-refresh]] for token details.')
    writeFileSync(join(testDir, 'jwt-refresh.md'), '# JWT Refresh\nRefresh token rotation strategy.')
    writeFileSync(join(testDir, 'unrelated.md'), '# Unrelated\nThis should not appear.')

    const results = await adapter.query({query: 'auth'})
    const paths = results.map((r) => r.metadata.path)
    expect(paths).to.include('auth.md')
    // jwt-refresh.md should appear via wikilink expansion
    expect(paths).to.include('jwt-refresh.md')
  })

  it('applies decay factor to wikilink-expanded results', async () => {
    writeFileSync(join(testDir, 'main.md'), '# Main Topic\nSee [[linked]] for more. Main content about tokens.')
    writeFileSync(join(testDir, 'linked.md'), '# Linked\nLinked content about tokens.')

    const results = await adapter.query({query: 'tokens'})
    const mainResult = results.find((r) => r.metadata.path === 'main.md')
    const linkedResult = results.find((r) => r.metadata.path === 'linked.md')
    // Both may appear; linked via expansion should have lower or equal score
    if (mainResult && linkedResult && linkedResult.metadata.matchType === 'graph') {
      expect(linkedResult.score).to.be.at.most(mainResult.score)
    }
  })

  it('refreshes the index when the vault changes after the first query', async () => {
    writeFileSync(join(testDir, 'existing.md'), '# Existing\nInitial content.')
    await adapter.query({query: 'existing'})

    writeFileSync(join(testDir, 'later.md'), '# Later Note\nRecently added content.')

    const results = await adapter.query({query: 'later'})
    expect(results.map((r) => r.metadata.path)).to.include('later.md')
  })

  it('store throws because obsidian is read-only', async () => {
    try {
      await adapter.store({content: 'test', metadata: {source: 'test', timestamp: Date.now()}})
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('read-only')
    }
  })

  it('respects maxResults', async () => {
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(testDir, `note-${i}.md`), `# Note ${i}\nContent about topic ${i}.`)
    }

    const results = await adapter.query({maxResults: 3, query: 'note'})
    expect(results.length).to.be.at.most(3)
  })

  it('honors custom ignorePatterns from config', async () => {
    mkdirSync(join(testDir, 'private'), {recursive: true})
    writeFileSync(join(testDir, 'private', 'secret.md'), '# Secret\nTop secret info.')
    writeFileSync(join(testDir, 'public.md'), '# Public\nPublic info.')

    const customAdapter = new ObsidianAdapter(testDir, {ignorePatterns: ['private']})
    const results = await customAdapter.query({query: 'secret public'})
    const paths = results.map((r) => r.metadata.path).filter(Boolean)

    // private/secret.md should NOT appear
    expect(paths.every((p) => !p!.startsWith('private'))).to.be.true
  })

  it('does not pick up new files when watchForChanges is false', async () => {
    writeFileSync(join(testDir, 'existing.md'), '# Existing\nExisting vault content.')

    const frozenAdapter = new ObsidianAdapter(testDir, {watchForChanges: false})
    const firstResults = await frozenAdapter.query({query: 'existing'})
    expect(firstResults.length).to.be.greaterThan(0)

    // Add a new file after the index is built
    writeFileSync(join(testDir, 'new-note.md'), '# New Note\nFresh vault content.')

    const secondResults = await frozenAdapter.query({query: 'new note'})
    const paths = secondResults.map((r) => r.metadata.path)
    expect(paths).to.not.include('new-note.md')
  })

  it('ignores files in .obsidian/ directory', async () => {
    writeFileSync(join(testDir, '.obsidian', 'config.json'), '{"theme": "dark"}')
    writeFileSync(join(testDir, 'real-note.md'), '# Real Note\nActual content.')

    const results = await adapter.query({query: 'config'})
    const paths = results.map((r) => r.metadata.path).filter(Boolean)
    expect(paths.every((p) => !p!.startsWith('.obsidian'))).to.be.true
  })

  describe('precision filtering', () => {
    it('returns empty when best match scores below floor', async () => {
      writeFileSync(join(testDir, 'cooking.md'), '# Pasta Recipe\nHow to cook pasta with tomato sauce.')
      writeFileSync(join(testDir, 'gardening.md'), '# Gardening Tips\nPlant roses in spring.')

      const results = await adapter.query({query: 'quantum computing'})
      expect(results).to.have.length(0)
    })

    it('drops low-scoring results via gap ratio', async () => {
      writeFileSync(join(testDir, 'project-mgmt.md'), '# Project Management\nProject management with agile methodologies for software teams.')
      writeFileSync(join(testDir, 'session-mgmt.md'), '# Session Management\nHTTP session management using JWT tokens for auth.')

      const results = await adapter.query({query: 'project management'})
      if (results.length > 0) {
        const topScore = results[0].score
        for (const r of results) {
          expect(r.score).to.be.at.least(topScore * POST_EXPANSION_GAP_RATIO)
        }
      }
    })

    it('uses AND-first for multi-word queries', async () => {
      writeFileSync(join(testDir, 'ts-generics.md'), '# TypeScript Generics\nTypeScript generics allow reusable typed components.')
      writeFileSync(join(testDir, 'py-generics.md'), '# Python Generics\nPython generics for type hints.')
      writeFileSync(join(testDir, 'ts-classes.md'), '# TypeScript Classes\nTypeScript classes provide OOP.')

      const results = await adapter.query({query: 'typescript generics'})
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].metadata.path).to.equal('ts-generics.md')
    })

    it('second gap-ratio pass filters weak wikilink-expanded results', async () => {
      writeFileSync(join(testDir, 'auth.md'), '# Authentication System\nJWT authentication with token refresh. See [[cooking]] for unrelated.')
      writeFileSync(join(testDir, 'cooking.md'), '# Cooking Recipe\nDelicious chocolate cake with vanilla frosting.')

      const results = await adapter.query({query: 'authentication JWT token'})
      const cookingResult = results.find((r) => r.metadata.path === 'cooking.md')
      if (cookingResult) {
        expect(cookingResult.score).to.be.at.least(results[0].score * POST_EXPANSION_GAP_RATIO)
      }
    })
  })
})
