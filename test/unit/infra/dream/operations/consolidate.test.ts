import {expect} from 'chai'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {DreamOperation} from '../../../../../src/server/infra/dream/dream-log-schema.js'

import {consolidate, type ConsolidateDeps} from '../../../../../src/server/infra/dream/operations/consolidate.js'

/**
 * Create a file with canonical (non-alphabetical) frontmatter order
 * (title -> summary -> tags -> related -> keywords -> createdAt -> updatedAt),
 * matching MarkdownWriter's canonical order. Used to verify dream operations
 * preserve this ordering rather than re-sorting alphabetically.
 */
async function createCanonicalFile(dir: string, relativePath: string, body: string): Promise<void> {
  const fullPath = join(dir, relativePath)
  await mkdir(join(fullPath, '..'), {recursive: true})
  const frontmatter = [
    '---',
    'title: Auth Session',
    "summary: Session handling overview",
    'tags: [auth, session]',
    'related: []',
    'keywords: [session, cookie]',
    "createdAt: '2026-04-01T00:00:00.000Z'",
    "updatedAt: '2026-04-10T00:00:00.000Z'",
    '---',
  ].join('\n')
  await writeFile(fullPath, `${frontmatter}\n${body}`, 'utf8')
}

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
    const yaml = dump(frontmatter, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
    content = `---\n${yaml}\n---\n${body}`
  }

  await writeFile(fullPath, content, 'utf8')
}

/** Helper: build a canned LLM response JSON */
function llmResponse(actions: Array<{confidence?: number; files: string[]; mergedContent?: string; outputFile?: string; reason: string; type: string; updatedContent?: string}>): string {
  return '```json\n' + JSON.stringify({actions}) + '\n```'
}

/** Test helper: build a stubbed DreamStateService exposing read/update/write with seeded pendingMerges. */
function makePendingMergeStateService(pendingMerges: Array<{mergeTarget: string; reason: string; sourceFile: string; suggestedByDreamId: string}>) {
  type State = import('../../../../../src/server/infra/dream/dream-state-schema.js').DreamState
  const service: {read: ReturnType<typeof stub>; update: ReturnType<typeof stub>; write: ReturnType<typeof stub>} = {
    read: stub().resolves({
      curationsSinceDream: 0,
      lastDreamAt: null,
      lastDreamLogId: null,
      pendingMerges,
      totalDreams: 0,
      version: 1 as const,
    }),
    update: stub(),
    write: stub().resolves(),
  }
  // Default update: read → updater → write — keeps tests that assert on write.callCount valid.
  service.update.callsFake(async (updater: (state: State) => State) => {
    const current = await service.read()
    const next = updater(current)
    await service.write(next)
    return next
  })
  return service
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

  it('CROSS_REFERENCE drops derived-artifact paths and cleans pre-existing dangling refs', async () => {
    // Pre-seed jwt.md with a stale reference to an .abstract.md sibling — it
    // shouldn't be there (push filtering would strip the file) and the next
    // CROSS_REFERENCE touch should clean it up.
    await createMdFile(ctxDir, 'auth/jwt.md', '# JWT', {
      keywords: [], related: ['auth/legacy.abstract.md'], tags: [], title: 'JWT',
    })
    await createMdFile(ctxDir, 'auth/oauth.md', '# OAuth', {keywords: [], related: [], tags: [], title: 'OAuth'})

    // LLM groups jwt.md with both a real sibling AND derived artifacts that
    // should never end up in `related:` because they don't sync to remote.
    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/jwt.md', 'auth/oauth.md', 'auth/intro.overview.md', 'auth/intro.abstract.md'],
      reason: 'Cross-reference auth topics',
      type: 'CROSS_REFERENCE',
    }]))

    await consolidate(['auth/jwt.md', 'auth/oauth.md'], deps)

    const jwt = await readFile(join(ctxDir, 'auth/jwt.md'), 'utf8')
    expect(jwt).to.include('auth/oauth.md')
    expect(jwt).to.not.include('auth/intro.overview.md')
    expect(jwt).to.not.include('auth/intro.abstract.md')
    // Pre-existing dangling ref opportunistically cleaned
    expect(jwt).to.not.include('auth/legacy.abstract.md')
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
      keywords: [], related: [], tags: [], title: 'Core Auth',
    })
    await createMdFile(ctxDir, 'auth/helper.md', '# Helper')
    const reviewBackupStore = {save: stub().resolves()}

    // Post-migration: maturity is read from the sidecar, not markdown.
    // Seed the sidecar with `maturity: 'core'` for the file that should
    // trigger the review gate.
    const runtimeSignalStore = {
      get: stub().callsFake(async (path: string) => ({
        maturity: path === 'auth/core-auth.md' ? 'core' : 'draft',
      })),
    }

    agent.executeOnSession.resolves(llmResponse([{
      files: ['auth/core-auth.md', 'auth/helper.md'],
      reason: 'Cross-reference',
      type: 'CROSS_REFERENCE',
    }]))

    const results = await consolidate(
      ['auth/core-auth.md', 'auth/helper.md'],
      {...deps, reviewBackupStore, runtimeSignalStore},
    )

    // CROSS_REFERENCE is normally needsReview=false, but core maturity overrides
    expect(results[0].needsReview).to.be.true
    expect(asConsolidate(results[0]).previousTexts).to.deep.equal({
      'auth/core-auth.md': '---\nkeywords: []\nrelated: []\ntags: []\ntitle: Core Auth\n---\n# Core Auth',
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

    // File contents are inlined directly in the prompt — check sibling paths
    // and titles are both present.
    const prompt = agent.executeOnSession.firstCall.args[1] as string
    expect(prompt).to.include('PATH: auth/login.md')
    expect(prompt).to.include('PATH: auth/logout.md')
    expect(prompt).to.include('PATH: auth/session.md')
    expect(prompt).to.include('# Logout')
    expect(prompt).to.include('# Session')
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

  // ==========================================================================
  // pendingMerges consumption (ENG-2126 fix #3)
  // ==========================================================================

  describe('pendingMerges consumption', () => {
    it('adds pendingMerge source files to the changedFiles set when they exist on disk', async () => {
      await createMdFile(ctxDir, 'auth/login.md', '# Login')
      await createMdFile(ctxDir, 'auth/session.md', '# Session (suggested merge source)')
      const dreamStateService = makePendingMergeStateService([
        {mergeTarget: 'auth/login.md', reason: 'Overlaps login flow', sourceFile: 'auth/session.md', suggestedByDreamId: 'drm-prev'},
      ])

      // Only pass login.md — session.md should be added via pendingMerges
      await consolidate(['auth/login.md'], {...deps, dreamStateService})

      // File contents are inlined in the prompt — verify session.md was loaded as a sibling
      const prompt = agent.executeOnSession.firstCall.args[1] as string
      expect(prompt).to.include('PATH: auth/session.md')
    })

    it('skips pendingMerge entries whose sourceFile is missing on disk', async () => {
      await createMdFile(ctxDir, 'auth/login.md', '# Login')
      const dreamStateService = makePendingMergeStateService([
        {mergeTarget: 'auth/login.md', reason: 'Stale suggestion', sourceFile: 'auth/never-existed.md', suggestedByDreamId: 'drm-prev'},
      ])

      await consolidate(['auth/login.md'], {...deps, dreamStateService})

      // No errors, consolidation proceeds normally with just the original changedFiles
      const prompt = agent.executeOnSession.firstCall.args[1] as string
      expect(prompt).to.not.include('PATH: auth/never-existed.md')
    })

    it('clears pendingMerges after processing (consumed regardless of outcome)', async () => {
      await createMdFile(ctxDir, 'auth/login.md', '# Login')
      await createMdFile(ctxDir, 'auth/session.md', '# Session')
      const dreamStateService = makePendingMergeStateService([
        {mergeTarget: 'auth/login.md', reason: 'Overlaps login flow', sourceFile: 'auth/session.md', suggestedByDreamId: 'drm-prev'},
      ])

      // LLM returns no actions — consolidate still clears pendingMerges
      await consolidate(['auth/login.md'], {...deps, dreamStateService})

      // Asserting on `update` (the contract) rather than `write` (the stub's
      // current implementation) keeps this test honest under future refactors
      // that route the clear through update() without calling write directly.
      expect(dreamStateService.update.calledOnce).to.be.true
      const writtenState = dreamStateService.write.firstCall.args[0] as {pendingMerges: unknown[]}
      expect(writtenState.pendingMerges).to.deep.equal([])
    })

    it('passes mergeTarget and reason to the LLM prompt as hints', async () => {
      await createMdFile(ctxDir, 'auth/login.md', '# Login')
      await createMdFile(ctxDir, 'auth/session.md', '# Session')
      const dreamStateService = makePendingMergeStateService([
        {mergeTarget: 'auth/login.md', reason: 'Share session state docs', sourceFile: 'auth/session.md', suggestedByDreamId: 'drm-prev'},
      ])

      await consolidate(['auth/login.md'], {...deps, dreamStateService})

      const prompt = agent.executeOnSession.firstCall.args[1] as string
      expect(prompt).to.include('auth/session.md')
      expect(prompt).to.include('auth/login.md')
      expect(prompt).to.include('Share session state docs')
    })

    it('is a no-op when dreamStateService is not provided (backwards compatible)', async () => {
      await createMdFile(ctxDir, 'auth/login.md', '# Login')

      // No dreamStateService in deps — should not throw, should proceed normally
      const results = await consolidate(['auth/login.md'], deps)
      expect(results).to.deep.equal([])
    })

    it('is a no-op when pendingMerges is empty', async () => {
      await createMdFile(ctxDir, 'auth/login.md', '# Login')
      const dreamStateService = makePendingMergeStateService([])

      await consolidate(['auth/login.md'], {...deps, dreamStateService})

      // No write needed when there's nothing to clear
      expect(dreamStateService.write.called).to.be.false
    })
  })

  // ==========================================================================
  // Frontmatter field order preservation
  // ==========================================================================

  describe('frontmatter field order preservation', () => {
    it('TEMPORAL_UPDATE preserves existing frontmatter field order', async () => {
      await createCanonicalFile(ctxDir, 'auth/session.md', '# Old session info')

      // LLM returns updatedContent WITH frontmatter in canonical order.
      // addFrontmatterFields merges consolidated_at into it — sortKeys must
      // not reorder the existing fields.
      const updatedWithFm = [
        '---',
        'title: Auth Session',
        "summary: Updated session handling",
        'tags: [auth, session]',
        'related: []',
        'keywords: [session, cookie]',
        "createdAt: '2026-04-01T00:00:00.000Z'",
        "updatedAt: '2026-04-10T00:00:00.000Z'",
        '---',
        '# Updated session info',
        'New content.',
      ].join('\n')

      agent.executeOnSession.resolves(llmResponse([{
        files: ['auth/session.md'],
        reason: 'Outdated info',
        type: 'TEMPORAL_UPDATE',
        updatedContent: updatedWithFm,
      }]))

      await consolidate(['auth/session.md'], deps)

      const updated = await readFile(join(ctxDir, 'auth/session.md'), 'utf8')
      // Extract frontmatter field names in order
      const yamlBlock = updated.slice(updated.indexOf('---\n') + 4, updated.indexOf('\n---\n', 4))
      const fieldNames = yamlBlock.split('\n').map(line => line.split(':')[0].trim()).filter(Boolean)

      // title must come before createdAt (canonical order, not alphabetical)
      const titleIdx = fieldNames.indexOf('title')
      const createdAtIdx = fieldNames.indexOf('createdAt')
      expect(titleIdx, 'title should appear before createdAt (canonical order)').to.be.lessThan(createdAtIdx)
    })

    it('TEMPORAL_UPDATE preserves flow-style arrays (no block-style reflow)', async () => {
      await createCanonicalFile(ctxDir, 'auth/session.md', '# Old session info')

      // Input frontmatter uses flow-style arrays (the canonical CLI format
      // emitted by markdown-writer with flowLevel: 1). After consolidate
      // appends consolidated_at, the rewritten file must keep the SAME
      // flow style — block-style reflow (`- a\n  - b`) silently diverges
      // from regular brv curate output and recreates the synthesis-vs-regular
      // inconsistency this work eliminates.
      const updatedWithFm = [
        '---',
        'title: Auth Session',
        "summary: Updated session handling",
        'tags: [auth, session, security]',
        'related: []',
        'keywords: [session, cookie, jwt]',
        "createdAt: '2026-04-01T00:00:00.000Z'",
        "updatedAt: '2026-04-10T00:00:00.000Z'",
        '---',
        '# Updated session info',
      ].join('\n')

      agent.executeOnSession.resolves(llmResponse([{
        files: ['auth/session.md'],
        reason: 'Outdated info',
        type: 'TEMPORAL_UPDATE',
        updatedContent: updatedWithFm,
      }]))

      await consolidate(['auth/session.md'], deps)

      const updated = await readFile(join(ctxDir, 'auth/session.md'), 'utf8')
      expect(updated).to.include('tags: [auth, session, security]')
      expect(updated).to.include('keywords: [session, cookie, jwt]')
      expect(updated).to.include('related: []')
      // Reject block-style reflow
      expect(updated).to.not.match(/^tags:\s*\n\s+- /m)
      expect(updated).to.not.match(/^keywords:\s*\n\s+- /m)
    })

    it('CROSS_REFERENCE preserves existing frontmatter field order', async () => {
      await createCanonicalFile(ctxDir, 'auth/session.md', '# Session')
      await createCanonicalFile(ctxDir, 'auth/tokens.md', '# Tokens')

      agent.executeOnSession.resolves(llmResponse([{
        files: ['auth/session.md', 'auth/tokens.md'],
        reason: 'Related auth topics',
        type: 'CROSS_REFERENCE',
      }]))

      await consolidate(['auth/session.md', 'auth/tokens.md'], deps)

      const session = await readFile(join(ctxDir, 'auth/session.md'), 'utf8')
      const yamlBlock = session.slice(session.indexOf('---\n') + 4, session.indexOf('\n---\n', 4))
      const fieldNames = yamlBlock.split('\n').map(line => line.split(':')[0].trim()).filter(Boolean)

      // title must come before createdAt (canonical order, not alphabetical)
      const titleIdx = fieldNames.indexOf('title')
      const createdAtIdx = fieldNames.indexOf('createdAt')
      expect(titleIdx, 'title should appear before createdAt (canonical order)').to.be.lessThan(createdAtIdx)

      // Verify order is also preserved in the second file
      const tokens = await readFile(join(ctxDir, 'auth/tokens.md'), 'utf8')
      const tokensYaml = tokens.slice(tokens.indexOf('---\n') + 4, tokens.indexOf('\n---\n', 4))
      const tokensFields = tokensYaml.split('\n').map(line => line.split(':')[0].trim()).filter(Boolean)
      expect(tokensFields.indexOf('title')).to.be.lessThan(tokensFields.indexOf('createdAt'))
    })

    it('MERGE preserves field order from target file frontmatter', async () => {
      await createCanonicalFile(ctxDir, 'auth/session.md', '# Session')
      await createMdFile(ctxDir, 'auth/session-v2.md', '# Session V2')

      // LLM returns mergedContent WITH frontmatter in canonical order.
      // addFrontmatterFields merges consolidated_at/consolidated_from — sortKeys
      // must not reorder the existing fields.
      const mergedWithFm = [
        '---',
        'title: Auth Session',
        "summary: Unified session handling",
        'tags: [auth, session]',
        'related: []',
        'keywords: [session, cookie]',
        "createdAt: '2026-04-01T00:00:00.000Z'",
        "updatedAt: '2026-04-10T00:00:00.000Z'",
        '---',
        '# Unified Session',
        'Merged.',
      ].join('\n')

      agent.executeOnSession.resolves(llmResponse([{
        files: ['auth/session.md', 'auth/session-v2.md'],
        mergedContent: mergedWithFm,
        outputFile: 'auth/session.md',
        reason: 'Redundant',
        type: 'MERGE',
      }]))

      await consolidate(['auth/session.md', 'auth/session-v2.md'], deps)

      const merged = await readFile(join(ctxDir, 'auth/session.md'), 'utf8')
      const yamlBlock = merged.slice(merged.indexOf('---\n') + 4, merged.indexOf('\n---\n', 4))
      const fieldNames = yamlBlock.split('\n').map(line => line.split(':')[0].trim()).filter(Boolean)

      // title must come before createdAt (canonical order, not alphabetical)
      const titleIdx = fieldNames.indexOf('title')
      const createdAtIdx = fieldNames.indexOf('createdAt')
      expect(titleIdx, 'title should appear before createdAt (canonical order)').to.be.lessThan(createdAtIdx)
    })
  })
})
