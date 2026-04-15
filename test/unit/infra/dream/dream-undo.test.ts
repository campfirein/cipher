import {expect} from 'chai'
import {access, mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {DreamLogEntry} from '../../../../src/server/infra/dream/dream-log-schema.js'

import {EMPTY_DREAM_STATE} from '../../../../src/server/infra/dream/dream-state-schema.js'
import {type DreamUndoDeps, undoLastDream} from '../../../../src/server/infra/dream/dream-undo.js'

/** Build a completed dream log entry with optional operation overrides. */
function completedLog(operations: DreamLogEntry['operations'] = []): DreamLogEntry {
  return {
    completedAt: Date.now(),
    id: 'drm-1000',
    operations,
    startedAt: Date.now() - 1000,
    status: 'completed',
    summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
    trigger: 'cli',
  }
}

describe('undoLastDream', () => {
  let ctxDir: string
  let dreamLogStore: {getById: SinonStub; save: SinonStub}
  let dreamStateService: {read: SinonStub; write: SinonStub}
  let manifestService: {buildManifest: SinonStub}
  let deps: DreamUndoDeps

  beforeEach(async () => {
    ctxDir = join(tmpdir(), `brv-undo-test-${Date.now()}`)
    await mkdir(ctxDir, {recursive: true})

    dreamLogStore = {
      getById: stub().resolves(completedLog()),
      save: stub().resolves(),
    }
    dreamStateService = {
      read: stub().resolves({...EMPTY_DREAM_STATE, lastDreamLogId: 'drm-1000', totalDreams: 1}),
      write: stub().resolves(),
    }
    manifestService = {
      buildManifest: stub().resolves({}),
    }

    deps = {contextTreeDir: ctxDir, dreamLogStore, dreamStateService, manifestService}
  })

  afterEach(() => {
    restore()
  })

  // ── Precondition checks ───────────────────────────────────────────────────

  it('throws when no dream to undo (lastDreamLogId is null)', async () => {
    dreamStateService.read.resolves({...EMPTY_DREAM_STATE})

    try {
      await undoLastDream(deps)
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('No dream to undo')
    }
  })

  it('throws when dream log not found', async () => {
    dreamLogStore.getById.resolves(null)

    try {
      await undoLastDream(deps)
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('not found')
    }
  })

  it('throws when dream already undone', async () => {
    const undoneLog: DreamLogEntry = {
      completedAt: Date.now(),
      id: 'drm-1000',
      operations: [],
      startedAt: Date.now() - 1000,
      status: 'undone',
      summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
      trigger: 'cli',
      undoneAt: Date.now(),
    }
    dreamLogStore.getById.resolves(undoneLog)

    try {
      await undoLastDream(deps)
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('already undone')
    }
  })

  it('throws when dream status is error', async () => {
    const errorLog: DreamLogEntry = {
      completedAt: Date.now(),
      error: 'boom',
      id: 'drm-1000',
      operations: [],
      startedAt: Date.now() - 1000,
      status: 'error',
      summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
      trigger: 'cli',
    }
    dreamLogStore.getById.resolves(errorLog)

    try {
      await undoLastDream(deps)
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('Cannot undo')
    }
  })

  it('allows undo of partial dreams', async () => {
    const partialLog: DreamLogEntry = {
      abortReason: 'Timeout',
      completedAt: Date.now(),
      id: 'drm-1000',
      operations: [],
      startedAt: Date.now() - 1000,
      status: 'partial',
      summary: {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0},
      trigger: 'cli',
    }
    dreamLogStore.getById.resolves(partialLog)

    const result = await undoLastDream(deps)
    expect(result.dreamId).to.equal('drm-1000')
  })

  // ── CONSOLIDATE/MERGE undo ────────────────────────────────────────────────

  it('undoes MERGE: restores source files from previousTexts', async () => {
    await mkdir(join(ctxDir, 'auth'), {recursive: true})
    await writeFile(join(ctxDir, 'auth/login.md'), 'Merged content')

    dreamLogStore.getById.resolves(completedLog([{
      action: 'MERGE',
      inputFiles: ['auth/login.md', 'auth/login-v2.md'],
      needsReview: true,
      outputFile: 'auth/login.md',
      previousTexts: {
        'auth/login-v2.md': 'Original login-v2 content',
        'auth/login.md': 'Original login content',
      },
      reason: 'Redundant',
      type: 'CONSOLIDATE',
    }]))

    const result = await undoLastDream(deps)

    expect(result.restoredFiles).to.include('auth/login.md')
    expect(result.restoredFiles).to.include('auth/login-v2.md')

    const login = await readFile(join(ctxDir, 'auth/login.md'), 'utf8')
    expect(login).to.equal('Original login content')
    const loginV2 = await readFile(join(ctxDir, 'auth/login-v2.md'), 'utf8')
    expect(loginV2).to.equal('Original login-v2 content')
  })

  it('undoes MERGE: deletes output file when not in previousTexts', async () => {
    await mkdir(join(ctxDir, 'auth'), {recursive: true})
    await writeFile(join(ctxDir, 'auth/combined.md'), 'Merged content')

    dreamLogStore.getById.resolves(completedLog([{
      action: 'MERGE',
      inputFiles: ['auth/a.md', 'auth/b.md'],
      needsReview: true,
      outputFile: 'auth/combined.md',
      previousTexts: {
        'auth/a.md': 'Content A',
        'auth/b.md': 'Content B',
      },
      reason: 'Merge',
      type: 'CONSOLIDATE',
    }]))

    const result = await undoLastDream(deps)

    expect(result.deletedFiles).to.include('auth/combined.md')
    expect(result.restoredFiles).to.include('auth/a.md')
    expect(result.restoredFiles).to.include('auth/b.md')

    let exists = true
    try {
      await access(join(ctxDir, 'auth/combined.md'))
    } catch {
      exists = false
    }

    expect(exists).to.be.false
  })

  // ── CONSOLIDATE/TEMPORAL_UPDATE undo ──────────────────────────────────────

  it('undoes TEMPORAL_UPDATE: restores original content', async () => {
    await mkdir(join(ctxDir, 'api'), {recursive: true})
    await writeFile(join(ctxDir, 'api/rate-limits.md'), 'Updated content')

    dreamLogStore.getById.resolves(completedLog([{
      action: 'TEMPORAL_UPDATE',
      inputFiles: ['api/rate-limits.md'],
      needsReview: true,
      previousTexts: {'api/rate-limits.md': 'Original rate limits'},
      reason: 'Outdated',
      type: 'CONSOLIDATE',
    }]))

    const result = await undoLastDream(deps)

    expect(result.restoredFiles).to.include('api/rate-limits.md')
    const content = await readFile(join(ctxDir, 'api/rate-limits.md'), 'utf8')
    expect(content).to.equal('Original rate limits')
  })

  // ── CONSOLIDATE/CROSS_REFERENCE undo ──────────────────────────────────────

  it('skips CROSS_REFERENCE (non-destructive)', async () => {
    dreamLogStore.getById.resolves(completedLog([{
      action: 'CROSS_REFERENCE',
      inputFiles: ['auth/jwt.md', 'auth/oauth.md'],
      needsReview: false,
      reason: 'Related',
      type: 'CONSOLIDATE',
    }]))

    const result = await undoLastDream(deps)

    expect(result.restoredFiles).to.be.empty
    expect(result.deletedFiles).to.be.empty
  })

  // ── SYNTHESIZE undo (forward-compatible) ──────────────────────────────────

  it('undoes SYNTHESIZE: deletes created file', async () => {
    await mkdir(join(ctxDir, 'auth'), {recursive: true})
    await writeFile(join(ctxDir, 'auth/overview.md'), 'Synthesized content')

    dreamLogStore.getById.resolves(completedLog([{
      action: 'CREATE',
      confidence: 0.9,
      needsReview: false,
      outputFile: 'auth/overview.md',
      sources: ['auth/jwt.md', 'auth/oauth.md'],
      type: 'SYNTHESIZE',
    }]))

    const result = await undoLastDream(deps)

    expect(result.deletedFiles).to.include('auth/overview.md')
    let exists = true
    try {
      await access(join(ctxDir, 'auth/overview.md'))
    } catch {
      exists = false
    }

    expect(exists).to.be.false
  })

  it('throws for SYNTHESIZE/UPDATE (no previousTexts to restore)', async () => {
    await mkdir(join(ctxDir, 'auth'), {recursive: true})
    await writeFile(join(ctxDir, 'auth/overview.md'), 'Updated content')

    dreamLogStore.getById.resolves(completedLog([{
      action: 'UPDATE',
      confidence: 0.8,
      needsReview: false,
      outputFile: 'auth/overview.md',
      sources: ['auth/jwt.md'],
      type: 'SYNTHESIZE',
    }]))

    const result = await undoLastDream(deps)

    // Error collected, file NOT deleted
    expect(result.errors.length).to.be.greaterThan(0)
    expect(result.errors[0]).to.include('SYNTHESIZE/UPDATE')
    expect(result.deletedFiles).to.be.empty

    const content = await readFile(join(ctxDir, 'auth/overview.md'), 'utf8')
    expect(content).to.equal('Updated content')
  })

  // ── PRUNE undo (forward-compatible) ───────────────────────────────────────

  it('undoes PRUNE/ARCHIVE: calls archiveService.restoreEntry with stubPath', async () => {
    const archiveService = {restoreEntry: stub().resolves('auth/old-doc.md')}

    dreamLogStore.getById.resolves(completedLog([{
      action: 'ARCHIVE',
      file: 'auth/old-doc.md',
      needsReview: false,
      reason: 'Stale',
      stubPath: '_archived/auth/old-doc.stub.md',
      type: 'PRUNE',
    }]))

    const result = await undoLastDream({...deps, archiveService})

    expect(archiveService.restoreEntry.calledOnce).to.be.true
    expect(archiveService.restoreEntry.firstCall.args[0]).to.equal('_archived/auth/old-doc.stub.md')
    expect(result.restoredArchives).to.include('auth/old-doc.md')
  })

  it('skips PRUNE/KEEP (no-op)', async () => {
    dreamLogStore.getById.resolves(completedLog([{
      action: 'KEEP',
      file: 'auth/important.md',
      needsReview: false,
      reason: 'Active',
      type: 'PRUNE',
    }]))

    const result = await undoLastDream(deps)
    expect(result.restoredFiles).to.be.empty
    expect(result.deletedFiles).to.be.empty
  })

  it('undoes PRUNE/SUGGEST_MERGE: removes from pendingMerges', async () => {
    dreamStateService.read.resolves({
      ...EMPTY_DREAM_STATE,
      lastDreamLogId: 'drm-1000',
      pendingMerges: [
        {mergeTarget: 'auth/target.md', sourceFile: 'auth/source.md'},
        {mergeTarget: 'api/other.md', sourceFile: 'api/src.md'},
      ],
      totalDreams: 1,
    })

    dreamLogStore.getById.resolves(completedLog([{
      action: 'SUGGEST_MERGE',
      file: 'auth/source.md',
      mergeTarget: 'auth/target.md',
      needsReview: false,
      reason: 'Similar',
      type: 'PRUNE',
    }]))

    await undoLastDream(deps)

    const writtenState = dreamStateService.write.firstCall.args[0]
    expect(writtenState.pendingMerges).to.have.lengthOf(1)
    expect(writtenState.pendingMerges[0].sourceFile).to.equal('api/src.md')
  })

  // ── Post-undo checks ─────────────────────────────────────────────────────

  it('marks dream log as undone with undoneAt', async () => {
    const result = await undoLastDream(deps)

    expect(result.dreamId).to.equal('drm-1000')

    const savedLog = dreamLogStore.save.lastCall.args[0]
    expect(savedLog.status).to.equal('undone')
    expect(savedLog.undoneAt).to.be.a('number')
    expect(savedLog.id).to.equal('drm-1000')
  })

  it('rewinds dream state: nulls lastDreamAt and decrements totalDreams', async () => {
    dreamStateService.read.resolves({
      ...EMPTY_DREAM_STATE,
      lastDreamLogId: 'drm-1000',
      totalDreams: 3,
    })

    await undoLastDream(deps)

    const writtenState = dreamStateService.write.firstCall.args[0]
    expect(writtenState.lastDreamAt).to.be.null
    expect(writtenState.totalDreams).to.equal(2)
  })

  it('does not decrement totalDreams below zero', async () => {
    dreamStateService.read.resolves({
      ...EMPTY_DREAM_STATE,
      lastDreamLogId: 'drm-1000',
      totalDreams: 0,
    })

    await undoLastDream(deps)

    const writtenState = dreamStateService.write.firstCall.args[0]
    expect(writtenState.totalDreams).to.equal(0)
  })

  it('rebuilds manifest after undo', async () => {
    await undoLastDream(deps)
    expect(manifestService.buildManifest.calledOnce).to.be.true
  })

  // ── Mixed operations and partial failure ──────────────────────────────────

  it('reverses operations in reverse order', async () => {
    await mkdir(join(ctxDir, 'auth'), {recursive: true})
    await mkdir(join(ctxDir, 'api'), {recursive: true})
    await writeFile(join(ctxDir, 'auth/login.md'), 'Merged')
    await writeFile(join(ctxDir, 'api/config.md'), 'Updated')

    dreamLogStore.getById.resolves(completedLog([
      {
        action: 'MERGE',
        inputFiles: ['auth/login.md', 'auth/signup.md'],
        needsReview: true,
        outputFile: 'auth/login.md',
        previousTexts: {'auth/login.md': 'Original login', 'auth/signup.md': 'Original signup'},
        reason: 'Merge',
        type: 'CONSOLIDATE',
      },
      {
        action: 'TEMPORAL_UPDATE',
        inputFiles: ['api/config.md'],
        needsReview: true,
        previousTexts: {'api/config.md': 'Original config'},
        reason: 'Update',
        type: 'CONSOLIDATE',
      },
    ]))

    const result = await undoLastDream(deps)

    expect(result.restoredFiles).to.have.lengthOf(3)

    const login = await readFile(join(ctxDir, 'auth/login.md'), 'utf8')
    expect(login).to.equal('Original login')
    const signup = await readFile(join(ctxDir, 'auth/signup.md'), 'utf8')
    expect(signup).to.equal('Original signup')
    const config = await readFile(join(ctxDir, 'api/config.md'), 'utf8')
    expect(config).to.equal('Original config')
  })

  it('continues on error and collects errors', async () => {
    await mkdir(join(ctxDir, 'api'), {recursive: true})
    await writeFile(join(ctxDir, 'api/config.md'), 'Updated')

    dreamLogStore.getById.resolves(completedLog([
      {
        action: 'MERGE',
        inputFiles: ['auth/a.md', 'auth/b.md'],
        needsReview: true,
        outputFile: 'auth/a.md',
        // No previousTexts — will cause error
        reason: 'Merge',
        type: 'CONSOLIDATE',
      },
      {
        action: 'TEMPORAL_UPDATE',
        inputFiles: ['api/config.md'],
        needsReview: true,
        previousTexts: {'api/config.md': 'Original'},
        reason: 'Update',
        type: 'CONSOLIDATE',
      },
    ]))

    const result = await undoLastDream(deps)

    expect(result.errors.length).to.be.greaterThan(0)
    expect(result.restoredFiles).to.include('api/config.md')
  })

  it('returns empty result for dream with no operations', async () => {
    const result = await undoLastDream(deps)

    expect(result.dreamId).to.equal('drm-1000')
    expect(result.restoredFiles).to.be.empty
    expect(result.deletedFiles).to.be.empty
    expect(result.restoredArchives).to.be.empty
    expect(result.errors).to.be.empty
  })
})
