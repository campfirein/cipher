import {expect} from 'chai'
import {mkdir, stat, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {DreamOperation} from '../../../../../src/server/infra/dream/dream-log-schema.js'
import type {DreamState} from '../../../../../src/server/infra/dream/dream-state-schema.js'

import {EMPTY_DREAM_STATE} from '../../../../../src/server/infra/dream/dream-state-schema.js'
import {prune, type PruneDeps} from '../../../../../src/server/infra/dream/operations/prune.js'

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

/** Set file mtime to N days ago */
async function setMtimeDaysAgo(dir: string, relativePath: string, daysAgo: number): Promise<void> {
  const fullPath = join(dir, relativePath)
  const pastMs = Date.now() - daysAgo * 24 * 60 * 60 * 1000
  const past = new Date(pastMs)
  await utimes(fullPath, past, past)
}

/** Build a canned LLM response */
function llmResponse(decisions: Array<{decision: string; file: string; mergeTarget?: string; reason: string}>): string {
  return '```json\n' + JSON.stringify({decisions}) + '\n```'
}

/** Narrow DreamOperation to PRUNE variant */
function asPrune(op: DreamOperation) {
  expect(op.type).to.equal('PRUNE')
  return op as Extract<DreamOperation, {type: 'PRUNE'}>
}

describe('prune', () => {
  let ctxDir: string
  let projectRoot: string
  let agent: {
    createTaskSession: SinonStub
    deleteTaskSession: SinonStub
    executeOnSession: SinonStub
    setSandboxVariableOnSession: SinonStub
  }
  let archiveService: {
    archiveEntry: SinonStub
    findArchiveCandidates: SinonStub
  }
  let dreamStateService: {
    read: SinonStub
    write: SinonStub
  }
  let deps: PruneDeps

  beforeEach(async () => {
    ctxDir = join(tmpdir(), `brv-prune-test-${Date.now()}`)
    projectRoot = ctxDir // simplified for tests — prune uses ctxDir directly
    await mkdir(ctxDir, {recursive: true})

    agent = {
      createTaskSession: stub().resolves('session-1'),
      deleteTaskSession: stub().resolves(),
      executeOnSession: stub().resolves(llmResponse([])),
      setSandboxVariableOnSession: stub(),
    }

    archiveService = {
      archiveEntry: stub().resolves({fullPath: '_archived/test.full.md', originalPath: 'test.md', stubPath: '_archived/test.stub.md'}),
      findArchiveCandidates: stub().resolves([]),
    }

    dreamStateService = {
      read: stub().resolves({...EMPTY_DREAM_STATE}),
      write: stub().resolves(),
    }

    deps = {
      agent: agent as unknown as ICipherAgent,
      archiveService,
      contextTreeDir: ctxDir,
      dreamLogId: 'drm-1',
      dreamStateService,
      projectRoot,
      signal: undefined,
      taskId: 'test-task',
    }
  })

  afterEach(() => {
    restore()
  })

  // ── Preconditions ─────────────────────────────────────────────────────────

  it('returns empty array when no candidates found', async () => {
    const results = await prune(deps)
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const results = await prune({...deps, signal: controller.signal})
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  // ── Signal A: archive service candidates ──────────────────────────────────

  it('finds candidates via archiveService (Signal A)', async () => {
    await createMdFile(ctxDir, 'auth/old-tokens.md', '# Old tokens', {importance: 20, maturity: 'draft'})
    archiveService.findArchiveCandidates.resolves(['auth/old-tokens.md'])

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/old-tokens.md', reason: 'Stale draft'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)
    expect(asPrune(results[0]).action).to.equal('ARCHIVE')
  })

  // ── Signal B: mtime staleness ─────────────────────────────────────────────

  it('finds stale draft files via mtime (Signal B, threshold 60 days)', async () => {
    await createMdFile(ctxDir, 'api/old-draft.md', '# Old draft', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'api/old-draft.md', 61)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'KEEP', file: 'api/old-draft.md', reason: 'Still useful'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)
    expect(asPrune(results[0]).action).to.equal('KEEP')
  })

  it('does NOT flag draft files under 60 days old', async () => {
    await createMdFile(ctxDir, 'api/recent-draft.md', '# Recent draft', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'api/recent-draft.md', 59)

    const results = await prune(deps)
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  it('finds stale validated files via mtime (threshold 120 days)', async () => {
    await createMdFile(ctxDir, 'api/old-validated.md', '# Validated doc', {maturity: 'validated'})
    await setMtimeDaysAgo(ctxDir, 'api/old-validated.md', 121)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'KEEP', file: 'api/old-validated.md', reason: 'Still relevant'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)
  })

  it('does NOT flag validated files under 120 days old', async () => {
    await createMdFile(ctxDir, 'api/recent-validated.md', '# Validated doc', {maturity: 'validated'})
    await setMtimeDaysAgo(ctxDir, 'api/recent-validated.md', 119)

    const results = await prune(deps)
    expect(results).to.deep.equal([])
  })

  it('NEVER flags core files regardless of age', async () => {
    await createMdFile(ctxDir, 'auth/core-doc.md', '# Core knowledge', {maturity: 'core'})
    await setMtimeDaysAgo(ctxDir, 'auth/core-doc.md', 365)

    const results = await prune(deps)
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  // ── Candidate cap ─────────────────────────────────────────────────────────

  it('caps candidates at 20 (stalest first)', async () => {
    // Create 25 stale draft files
    for (let i = 0; i < 25; i++) {
      const name = `api/stale-${String(i).padStart(2, '0')}.md`
      // eslint-disable-next-line no-await-in-loop
      await createMdFile(ctxDir, name, `# Stale ${i}`, {maturity: 'draft'})
      // eslint-disable-next-line no-await-in-loop
      await setMtimeDaysAgo(ctxDir, name, 70 + i) // 70–94 days old
    }

    agent.executeOnSession.resolves(llmResponse([]))

    await prune(deps)

    // Should have called LLM — verify sandbox variable has at most 20 candidates
    expect(agent.setSandboxVariableOnSession.calledOnce).to.be.true
    const payload = agent.setSandboxVariableOnSession.firstCall.args[2]
    expect(payload).to.be.an('array').with.lengthOf(20)
  })

  // ── LLM interaction ───────────────────────────────────────────────────────

  it('creates session and cleans up on success', async () => {
    await createMdFile(ctxDir, 'auth/old.md', '# Old', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/old.md', 61)

    agent.executeOnSession.resolves(llmResponse([]))

    await prune(deps)

    expect(agent.createTaskSession.calledOnce).to.be.true
    expect(agent.deleteTaskSession.calledOnce).to.be.true
  })

  it('returns empty array on LLM failure', async () => {
    await createMdFile(ctxDir, 'auth/old.md', '# Old', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/old.md', 61)

    agent.executeOnSession.rejects(new Error('LLM timeout'))

    const results = await prune(deps)
    expect(results).to.deep.equal([])
    expect(agent.deleteTaskSession.calledOnce).to.be.true
  })

  it('skips LLM decision that references non-candidate file', async () => {
    await createMdFile(ctxDir, 'auth/old.md', '# Old', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/old.md', 61)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/nonexistent.md', reason: 'Hallucinated'},
      {decision: 'KEEP', file: 'auth/old.md', reason: 'Still useful'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)
    expect(asPrune(results[0]).file).to.equal('auth/old.md')
  })

  // ── ARCHIVE decision ──────────────────────────────────────────────────────

  it('calls archiveService.archiveEntry and returns ARCHIVE op with needsReview=true', async () => {
    await createMdFile(ctxDir, 'auth/stale.md', '# Stale doc', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/stale.md', 90)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/stale.md', reason: 'No longer relevant'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)

    const op = asPrune(results[0])
    expect(op.action).to.equal('ARCHIVE')
    expect(op.file).to.equal('auth/stale.md')
    expect(op.reason).to.equal('No longer relevant')
    expect(op.needsReview).to.be.true
    expect(op.stubPath).to.equal('_archived/test.stub.md')

    expect(archiveService.archiveEntry.calledOnce).to.be.true
    expect(archiveService.archiveEntry.firstCall.args[0]).to.equal('auth/stale.md')
  })

  it('continues processing when archiveService.archiveEntry throws', async () => {
    await createMdFile(ctxDir, 'auth/fail.md', '# Fail', {maturity: 'draft'})
    await createMdFile(ctxDir, 'api/success.md', '# Success', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/fail.md', 90)
    await setMtimeDaysAgo(ctxDir, 'api/success.md', 90)

    archiveService.archiveEntry.onFirstCall().rejects(new Error('Disk full'))
    archiveService.archiveEntry.onSecondCall().resolves({fullPath: '_archived/api/success.full.md', originalPath: 'api/success.md', stubPath: '_archived/api/success.stub.md'})

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/fail.md', reason: 'Stale'},
      {decision: 'ARCHIVE', file: 'api/success.md', reason: 'Also stale'},
    ]))

    const results = await prune(deps)
    // First archive fails, second succeeds
    expect(results).to.have.lengthOf(1)
    expect(asPrune(results[0]).file).to.equal('api/success.md')
  })

  // ── KEEP decision ─────────────────────────────────────────────────────────

  it('bumps mtime on KEEP decision and returns op with needsReview=false', async () => {
    await createMdFile(ctxDir, 'auth/useful.md', '# Useful', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/useful.md', 90)

    const beforeStat = await stat(join(ctxDir, 'auth/useful.md'))

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'KEEP', file: 'auth/useful.md', reason: 'Still referenced'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)

    const op = asPrune(results[0])
    expect(op.action).to.equal('KEEP')
    expect(op.file).to.equal('auth/useful.md')
    expect(op.needsReview).to.be.false

    // mtime should be bumped to recent
    const afterStat = await stat(join(ctxDir, 'auth/useful.md'))
    expect(afterStat.mtimeMs).to.be.greaterThan(beforeStat.mtimeMs)
  })

  // ── MERGE_INTO decision ───────────────────────────────────────────────────

  it('writes pendingMerges on MERGE_INTO decision', async () => {
    await createMdFile(ctxDir, 'auth/overlap.md', '# Overlap', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/overlap.md', 90)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'MERGE_INTO', file: 'auth/overlap.md', mergeTarget: 'auth/main.md', reason: 'Content overlaps'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)

    const op = asPrune(results[0])
    expect(op.action).to.equal('SUGGEST_MERGE')
    expect(op.file).to.equal('auth/overlap.md')
    expect(op.mergeTarget).to.equal('auth/main.md')
    expect(op.needsReview).to.be.false

    expect(dreamStateService.write.calledOnce).to.be.true
    const writtenState = dreamStateService.write.firstCall.args[0] as DreamState
    expect(writtenState.pendingMerges).to.have.lengthOf(1)
    expect(writtenState.pendingMerges[0]).to.deep.include({
      mergeTarget: 'auth/main.md',
      sourceFile: 'auth/overlap.md',
      suggestedByDreamId: 'drm-1',
    })
  })

  it('does not duplicate existing pendingMerges entry', async () => {
    await createMdFile(ctxDir, 'auth/overlap.md', '# Overlap', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/overlap.md', 90)

    // Pre-populate with same merge suggestion
    dreamStateService.read.resolves({
      ...EMPTY_DREAM_STATE,
      pendingMerges: [{
        mergeTarget: 'auth/main.md',
        reason: 'Previous suggestion',
        sourceFile: 'auth/overlap.md',
        suggestedByDreamId: 'drm-0',
      }],
    })

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'MERGE_INTO', file: 'auth/overlap.md', mergeTarget: 'auth/main.md', reason: 'Still overlaps'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(1)

    // dreamStateService.write should NOT be called since no new merge was added
    expect(dreamStateService.write.called).to.be.false
  })

  it('drops MERGE_INTO op when mergeTarget is absent', async () => {
    await createMdFile(ctxDir, 'auth/overlap.md', '# Overlap', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/overlap.md', 90)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'MERGE_INTO', file: 'auth/overlap.md', reason: 'Missing target'},
    ]))

    const results = await prune(deps)
    expect(results).to.deep.equal([])
    expect(dreamStateService.write.called).to.be.false
  })

  // ── Mixed decisions ───────────────────────────────────────────────────────

  it('handles mixed ARCHIVE, KEEP, and MERGE_INTO in one pass', async () => {
    await createMdFile(ctxDir, 'auth/stale.md', '# Stale', {maturity: 'draft'})
    await createMdFile(ctxDir, 'api/useful.md', '# Useful', {maturity: 'draft'})
    await createMdFile(ctxDir, 'infra/overlap.md', '# Overlap', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/stale.md', 90)
    await setMtimeDaysAgo(ctxDir, 'api/useful.md', 90)
    await setMtimeDaysAgo(ctxDir, 'infra/overlap.md', 90)

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/stale.md', reason: 'Outdated'},
      {decision: 'KEEP', file: 'api/useful.md', reason: 'Referenced often'},
      {decision: 'MERGE_INTO', file: 'infra/overlap.md', mergeTarget: 'infra/main.md', reason: 'Redundant'},
    ]))

    const results = await prune(deps)
    expect(results).to.have.lengthOf(3)

    const actions = results.map((r) => asPrune(r).action)
    expect(actions).to.include('ARCHIVE')
    expect(actions).to.include('KEEP')
    expect(actions).to.include('SUGGEST_MERGE')
  })

  // ── Dedup between signals ─────────────────────────────────────────────────

  it('deduplicates candidates found by both signals', async () => {
    // File found by both Signal A (archiveService) and Signal B (mtime)
    await createMdFile(ctxDir, 'auth/both-signals.md', '# Both', {importance: 20, maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/both-signals.md', 90)
    archiveService.findArchiveCandidates.resolves(['auth/both-signals.md'])

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/both-signals.md', reason: 'Stale'},
    ]))

    await prune(deps)

    // Verify only sent once to LLM
    const payload = agent.setSandboxVariableOnSession.firstCall.args[2]
    const paths = payload.map((c: {path: string}) => c.path)
    const occurrences = paths.filter((p: string) => p === 'auth/both-signals.md')
    expect(occurrences).to.have.lengthOf(1)
  })

  // ── Excluded files ────────────────────────────────────────────────────────

  it('skips _archived and derived artifact files', async () => {
    await createMdFile(ctxDir, '_archived/auth/old.stub.md', '# Stub', {type: 'archive_stub'})
    await createMdFile(ctxDir, 'auth/_index.md', '# Summary', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, '_archived/auth/old.stub.md', 365)
    await setMtimeDaysAgo(ctxDir, 'auth/_index.md', 365)

    const results = await prune(deps)
    expect(results).to.deep.equal([])
  })

  // ── Review backup ──────────────────────────────────────────────────────────

  it('calls reviewBackupStore.save before archiveEntry for ARCHIVE decisions', async () => {
    await createMdFile(ctxDir, 'auth/stale.md', '# Stale doc', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/stale.md', 90)

    const callOrder: string[] = []
    const reviewBackupStore = {
      save: stub().callsFake(async () => { callOrder.push('backup') }),
    }
    archiveService.archiveEntry.callsFake(async () => {
      callOrder.push('archive')
      return {fullPath: '', originalPath: '', stubPath: '_archived/auth/stale.stub.md'}
    })

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'ARCHIVE', file: 'auth/stale.md', reason: 'Stale'},
    ]))

    await prune({...deps, reviewBackupStore})

    expect(reviewBackupStore.save.calledOnce).to.be.true
    expect(reviewBackupStore.save.firstCall.args[0]).to.equal('auth/stale.md')
    // Backup must happen BEFORE archive
    expect(callOrder).to.deep.equal(['backup', 'archive'])
  })

  it('does not call reviewBackupStore.save for KEEP decisions', async () => {
    await createMdFile(ctxDir, 'auth/old.md', '# Old but useful', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/old.md', 90)

    const reviewBackupStore = {save: stub().resolves()}

    agent.executeOnSession.resolves(llmResponse([
      {decision: 'KEEP', file: 'auth/old.md', reason: 'Still relevant'},
    ]))

    await prune({...deps, reviewBackupStore})

    expect(reviewBackupStore.save.called).to.be.false
  })

  // ── Signal propagation ────────────────────────────────────────────────────

  it('passes abort signal to executeOnSession', async () => {
    await createMdFile(ctxDir, 'auth/old.md', '# Old', {maturity: 'draft'})
    await setMtimeDaysAgo(ctxDir, 'auth/old.md', 61)

    const controller = new AbortController()
    agent.executeOnSession.resolves(llmResponse([]))

    await prune({...deps, signal: controller.signal})

    expect(agent.executeOnSession.calledOnce).to.be.true
    const options = agent.executeOnSession.firstCall.args[2]
    expect(options).to.have.property('signal', controller.signal)
  })
})
