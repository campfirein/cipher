import {expect} from 'chai'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {DreamOperation} from '../../../../../src/server/infra/dream/dream-log-schema.js'

import {consolidate, type ConsolidateDeps} from '../../../../../src/server/infra/dream/operations/consolidate.js'

/** Narrow DreamOperation to CONSOLIDATE variant for test assertions */
function asConsolidate(op: DreamOperation) {
  expect(op.type).to.equal('CONSOLIDATE')
  return op as Extract<DreamOperation, {type: 'CONSOLIDATE'}>
}

/** Helper: create a markdown file with optional frontmatter */
async function createMdFile(dir: string, relativePath: string, body: string, frontmatter?: Record<string, unknown>): Promise<void> {
  const fullPath = join(dir, relativePath)
  await mkdir(join(fullPath, '..'), {recursive: true})
  let content = body
  if (frontmatter) {
    const {dump} = await import('js-yaml')
    const yaml = dump(frontmatter, {flowLevel: 1, lineWidth: -1, sortKeys: true}).trimEnd()
    content = `---\n${yaml}\n---\n${body}`
  }

  await writeFile(fullPath, content, 'utf8')
}

/** Helper: build a canned LLM response JSON */
function llmResponse(actions: Array<{confidence?: number; files: string[]; mergedContent?: string; outputFile?: string; reason: string; type: string; updatedContent?: string}>): string {
  return '```json\n' + JSON.stringify({actions}) + '\n```'
}

describe('consolidate', () => {
  let ctxDir: string
  let agent: {
    createTaskSession: SinonStub
    deleteTaskSession: SinonStub
    executeOnSession: SinonStub
    setSandboxVariableOnSession: SinonStub
  }
  let searchService: {search: SinonStub}
  let deps: ConsolidateDeps

  beforeEach(async () => {
    ctxDir = join(tmpdir(), `brv-consolidate-test-${Date.now()}`)
    await mkdir(ctxDir, {recursive: true})

    agent = {
      createTaskSession: stub().resolves('session-1'),
      deleteTaskSession: stub().resolves(),
      executeOnSession: stub().resolves('```json\n{"actions":[]}\n```'),
      setSandboxVariableOnSession: stub(),
    }

    searchService = {
      search: stub().resolves({message: '', results: [], totalFound: 0}),
    }

    deps = {agent: agent as unknown as ICipherAgent, contextTreeDir: ctxDir, searchService, taskId: 'test-task'}
  })

  afterEach(() => {
    restore()
  })

  it('returns empty array when changedFiles is empty', async () => {
    const results = await consolidate([], deps)
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  it('groups files by domain and creates one session per domain', async () => {
    await createMdFile(ctxDir, 'auth/login.md', '# Login')
    await createMdFile(ctxDir, 'auth/signup.md', '# Signup')
    await createMdFile(ctxDir, 'api/endpoints.md', '# Endpoints')

    agent.executeOnSession.resolves(llmResponse([]))

    await consolidate(['auth/login.md', 'auth/signup.md', 'api/endpoints.md'], deps)

    // Two domains → two sessions
    expect(agent.createTaskSession.callCount).to.equal(2)
    expect(agent.deleteTaskSession.callCount).to.equal(2)
  })

  it('finds related files via search service', async () => {
    await createMdFile(ctxDir, 'auth/login.md', '# Login Flow')
    await createMdFile(ctxDir, 'auth/session.md', '# Session Management')

    searchService.search.resolves({
      message: '',
      results: [{path: 'auth/session.md', score: 0.8, title: 'Session Management'}],
      totalFound: 1,
    })

    agent.executeOnSession.resolves(llmResponse([]))

    await consolidate(['auth/login.md'], deps)

    expect(searchService.search.calledOnce).to.be.true
    const searchCall = searchService.search.firstCall
    expect(searchCall.args[1]).to.have.property('scope', 'auth')
  })

  it('executes MERGE: writes merged content, deletes source', async () => {
    await createMdFile(ctxDir, 'auth/login.md', '# Login', {title: 'Login'})
    await createMdFile(ctxDir, 'auth/login-v2.md', '# Login V2', {title: 'Login V2'})

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/login.md', 'auth/login-v2.md'],
      mergedContent: '# Unified Login\nMerged content here.',
      outputFile: 'auth/login.md',
      reason: 'Redundant login docs',
      type: 'MERGE',
    }]))

    const results = await consolidate(['auth/login.md', 'auth/login-v2.md'], deps)

    expect(results).to.have.lengthOf(1)
    const op = asConsolidate(results[0])
    expect(op.action).to.equal('MERGE')
    expect(op.inputFiles).to.deep.equal(['auth/login.md', 'auth/login-v2.md'])
    expect(op.outputFile).to.equal('auth/login.md')
    expect(op.needsReview).to.be.true

    // Target file has merged content
    const merged = await readFile(join(ctxDir, 'auth/login.md'), 'utf8')
    expect(merged).to.include('Unified Login')

    // Source file deleted
    let sourceExists = true
    try { await readFile(join(ctxDir, 'auth/login-v2.md'), 'utf8') } catch { sourceExists = false }
    expect(sourceExists).to.be.false
  })

  it('populates previousTexts for MERGE', async () => {
    await createMdFile(ctxDir, 'auth/a.md', 'Content A')
    await createMdFile(ctxDir, 'auth/b.md', 'Content B')

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/a.md', 'auth/b.md'],
      mergedContent: 'Merged',
      outputFile: 'auth/a.md',
      reason: 'Merge',
      type: 'MERGE',
    }]))

    const results = await consolidate(['auth/a.md', 'auth/b.md'], deps)

    const op = asConsolidate(results[0])
    expect(op.previousTexts).to.deep.equal({
      'auth/a.md': 'Content A',
      'auth/b.md': 'Content B',
    })
  })

  it('executes TEMPORAL_UPDATE: writes updated content', async () => {
    await createMdFile(ctxDir, 'api/rate-limits.md', '# Old rate limits')

    agent.executeOnSession.resolves(llmResponse([{
      files: ['api/rate-limits.md'],
      reason: 'Outdated info',
      type: 'TEMPORAL_UPDATE',
      updatedContent: '# Updated rate limits\nNow 200 req/min.',
    }]))

    const results = await consolidate(['api/rate-limits.md'], deps)

    expect(results).to.have.lengthOf(1)
    const op = asConsolidate(results[0])
    expect(op.action).to.equal('TEMPORAL_UPDATE')
    expect(op.needsReview).to.be.true

    const updated = await readFile(join(ctxDir, 'api/rate-limits.md'), 'utf8')
    expect(updated).to.include('Updated rate limits')
  })

  it('populates previousTexts for TEMPORAL_UPDATE', async () => {
    await createMdFile(ctxDir, 'api/config.md', 'Original config')

    agent.executeOnSession.resolves(llmResponse([{
      files: ['api/config.md'],
      reason: 'Update',
      type: 'TEMPORAL_UPDATE',
      updatedContent: 'New config',
    }]))

    const results = await consolidate(['api/config.md'], deps)

    const op = asConsolidate(results[0])
    expect(op.previousTexts).to.deep.equal({
      'api/config.md': 'Original config',
    })
  })

  it('sets needsReview=false for high-confidence TEMPORAL_UPDATE', async () => {
    await createMdFile(ctxDir, 'api/config.md', 'Old config')

    agent.executeOnSession.resolves(llmResponse([{
      confidence: 0.9,
      files: ['api/config.md'],
      reason: 'Clear update',
      type: 'TEMPORAL_UPDATE',
      updatedContent: 'New config',
    }]))

    const results = await consolidate(['api/config.md'], deps)
    expect(results[0].needsReview).to.be.false
  })

  it('adds consolidated_at frontmatter to merged files', async () => {
    await createMdFile(ctxDir, 'auth/a.md', 'Content A')
    await createMdFile(ctxDir, 'auth/b.md', 'Content B')

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/a.md', 'auth/b.md'],
      mergedContent: '# Merged\nCombined content.',
      outputFile: 'auth/a.md',
      reason: 'Redundant',
      type: 'MERGE',
    }]))

    const results = await consolidate(['auth/a.md', 'auth/b.md'], deps)
    expect(results).to.have.lengthOf(1)

    const merged = await readFile(join(ctxDir, 'auth/a.md'), 'utf8')
    expect(merged).to.include('consolidated_at')
    expect(merged).to.include('consolidated_from')
    expect(merged).to.include('auth/b.md')
  })

  it('executes CROSS_REFERENCE: adds related links in frontmatter', async () => {
    await createMdFile(ctxDir, 'auth/jwt.md', '# JWT', {keywords: [], related: [], tags: [], title: 'JWT'})
    await createMdFile(ctxDir, 'auth/oauth.md', '# OAuth', {keywords: [], related: [], tags: [], title: 'OAuth'})

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/jwt.md', 'auth/oauth.md'],
      reason: 'Complementary auth topics',
      type: 'CROSS_REFERENCE',
    }]))

    const results = await consolidate(['auth/jwt.md', 'auth/oauth.md'], deps)

    expect(results).to.have.lengthOf(1)
    const op = asConsolidate(results[0])
    expect(op.action).to.equal('CROSS_REFERENCE')
    expect(op.needsReview).to.be.false

    const jwt = await readFile(join(ctxDir, 'auth/jwt.md'), 'utf8')
    expect(jwt).to.include('auth/oauth.md')

    const oauth = await readFile(join(ctxDir, 'auth/oauth.md'), 'utf8')
    expect(oauth).to.include('auth/jwt.md')
  })

  it('returns empty operations for SKIP actions', async () => {
    await createMdFile(ctxDir, 'auth/unrelated.md', '# Unrelated')

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/unrelated.md'],
      reason: 'Not related',
      type: 'SKIP',
    }]))

    const results = await consolidate(['auth/unrelated.md'], deps)

    expect(results).to.deep.equal([])
  })

  it('sets needsReview=true when file has core maturity', async () => {
    await createMdFile(ctxDir, 'auth/core-auth.md', '# Core Auth', {
      keywords: [], maturity: 'core', related: [], tags: [], title: 'Core Auth',
    })
    await createMdFile(ctxDir, 'auth/helper.md', '# Helper')
    const reviewBackupStore = {save: stub().resolves()}

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/core-auth.md', 'auth/helper.md'],
      reason: 'Cross-reference',
      type: 'CROSS_REFERENCE',
    }]))

    const results = await consolidate(['auth/core-auth.md', 'auth/helper.md'], {...deps, reviewBackupStore})

    // CROSS_REFERENCE is normally needsReview=false, but core maturity overrides
    expect(results[0].needsReview).to.be.true
    expect(asConsolidate(results[0]).previousTexts).to.deep.equal({
      'auth/core-auth.md': '---\nkeywords: []\nmaturity: core\nrelated: []\ntags: []\ntitle: Core Auth\n---\n# Core Auth',
      'auth/helper.md': '# Helper',
    })
    expect(reviewBackupStore.save.calledTwice).to.be.true
  })

  it('continues processing when LLM fails for one domain', async () => {
    await createMdFile(ctxDir, 'auth/login.md', '# Login')
    await createMdFile(ctxDir, 'api/endpoints.md', '# Endpoints')

    // First domain (api) fails, second domain (auth) succeeds
    agent.executeOnSession
      .onFirstCall().rejects(new Error('LLM timeout'))
      .onSecondCall().resolves(llmResponse([]))

    const results = await consolidate(['api/endpoints.md', 'auth/login.md'], deps)

    // Should not throw, returns whatever succeeded
    expect(results).to.be.an('array')
    // Both sessions still cleaned up
    expect(agent.deleteTaskSession.callCount).to.equal(2)
  })

  it('does not crash when MERGE references files not in fileContents', async () => {
    // LLM references files that weren't loaded (missing from context tree)
    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/missing.md', 'auth/also-missing.md'],
      mergedContent: 'Merged',
      outputFile: 'auth/missing.md',
      reason: 'Merge',
      type: 'MERGE',
    }]))

    // Create at least one valid file so the domain gets processed
    await createMdFile(ctxDir, 'auth/exists.md', '# Exists')

    const results = await consolidate(['auth/exists.md'], deps)

    // Should not throw — MERGE writes to outputFile even if sources weren't in fileContents
    expect(results).to.be.an('array')
  })

  it('cleans up task session even on error', async () => {
    await createMdFile(ctxDir, 'auth/test.md', '# Test')

    agent.executeOnSession.rejects(new Error('Session error'))

    await consolidate(['auth/test.md'], deps)

    expect(agent.deleteTaskSession.calledOnce).to.be.true
  })

  it('includes path siblings as related files', async () => {
    await createMdFile(ctxDir, 'auth/login.md', '# Login')
    await createMdFile(ctxDir, 'auth/logout.md', '# Logout')
    await createMdFile(ctxDir, 'auth/session.md', '# Session')

    agent.executeOnSession.resolves(llmResponse([]))

    await consolidate(['auth/login.md'], deps)

    // The sandbox variable should include sibling file contents
    expect(agent.setSandboxVariableOnSession.called).to.be.true
    const filesPayload = agent.setSandboxVariableOnSession.firstCall.args[2]
    const fileKeys = typeof filesPayload === 'string' ? Object.keys(JSON.parse(filesPayload)) : Object.keys(filesPayload)
    // Should include siblings (logout.md, session.md) in addition to the changed file
    expect(fileKeys.length).to.be.greaterThan(1)
  })

  it('stops processing domains when signal is aborted', async () => {
    await createMdFile(ctxDir, 'auth/login.md', '# Login')
    await createMdFile(ctxDir, 'api/endpoints.md', '# Endpoints')

    const controller = new AbortController()

    // Abort after first domain finishes executing
    agent.executeOnSession.onFirstCall().callsFake(async () => {
      controller.abort()
      return llmResponse([])
    })
    agent.executeOnSession.onSecondCall().resolves(llmResponse([]))

    await consolidate(['auth/login.md', 'api/endpoints.md'], {...deps, signal: controller.signal})

    // Only one domain processed — the second was skipped because signal was aborted
    expect(agent.createTaskSession.callCount).to.equal(1)
  })
})
