import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {EMPTY_DREAM_STATE} from '../../../../src/server/infra/dream/dream-state-schema.js'
import {DreamExecutor, type DreamExecutorDeps} from '../../../../src/server/infra/executor/dream-executor.js'

/**
 * Test helper: subclass of DreamExecutor whose runOperations pushes a caller-supplied
 * list of operations and then throws, so tests can assert that the catch block surfaces
 * those operations in the partial/error log entry.
 */
function makePartialRunExecutor(args: {
  aborted?: boolean
  deps: DreamExecutorDeps
  injected: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation[]
  throwErr: Error
}): DreamExecutor {
  class TestExecutor extends DreamExecutor {
    protected override async runOperations(opArgs: {
      agent: ICipherAgent
      changedFiles: Set<string>
      contextTreeDir: string
      logId: string
      out: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation[]
      projectRoot: string
      signal: AbortSignal
      taskId: string
    }): Promise<void> {
      opArgs.out.push(...args.injected)
      if (args.aborted) {
        // Simulate the budget timer firing after some ops completed.
        Object.defineProperty(opArgs.signal, 'aborted', {configurable: true, value: true})
      }

      throw args.throwErr
    }
  }

  return new TestExecutor(args.deps)
}

describe('DreamExecutor', () => {
  let dreamStateService: {drainStaleSummaryPaths: SinonStub; enqueueStaleSummaryPaths: SinonStub; read: SinonStub; update: SinonStub; write: SinonStub}
  let dreamLogStore: {getNextId: SinonStub; save: SinonStub}
  let dreamLockService: {release: SinonStub; rollback: SinonStub}
  let curateLogStore: {getNextId: SinonStub; list: SinonStub; save: SinonStub}
  let agent: ICipherAgent
  let deps: DreamExecutorDeps
  const defaultOptions = {
    priorMtime: 0,
    projectRoot: '/tmp/nonexistent-dream-test',
    taskId: 'test-task-1',
    trigger: 'cli' as const,
  }

  beforeEach(() => {
    dreamStateService = {
      // Default drain: empty queue. Tests that exercise the queue override.
      drainStaleSummaryPaths: stub().resolves([]),
      // Default enqueue: no-op stub. Used by the executor's catch block to
      // re-enqueue a drained snapshot if propagation fails.
      enqueueStaleSummaryPaths: stub().resolves(),
      read: stub().resolves({...EMPTY_DREAM_STATE, pendingMerges: [], staleSummaryPaths: []}),
      // Default update implementation: read → updater → write, mirroring the real
      // service so tests that count write.callCount stay valid without changes.
      update: stub().callsFake(async (updater: (state: import('../../../../src/server/infra/dream/dream-state-schema.js').DreamState) => import('../../../../src/server/infra/dream/dream-state-schema.js').DreamState) => {
        const current = await dreamStateService.read()
        const next = updater(current)
        await dreamStateService.write(next)
        return next
      }),
      write: stub().resolves(),
    }
    dreamLogStore = {
      getNextId: stub().resolves('drm-1000'),
      save: stub().resolves(),
    }
    dreamLockService = {
      release: stub().resolves(),
      rollback: stub().resolves(),
    }
    curateLogStore = {
      getNextId: stub().resolves('cur-1000'),
      list: stub().resolves([]),
      save: stub().resolves(),
    }
    agent = {
      createTaskSession: stub().resolves('session-1'),
      deleteTaskSession: stub().resolves(),
      executeOnSession: stub().resolves('```json\n{"actions":[]}\n```'),
      setSandboxVariableOnSession: stub(),
    } as unknown as ICipherAgent
    deps = {
      archiveService: {archiveEntry: stub().resolves({fullPath: '', originalPath: '', stubPath: ''}), findArchiveCandidates: stub().resolves([])},
      curateLogStore,
      dreamLockService,
      dreamLogStore,
      dreamStateService,
      searchService: {search: stub().resolves({message: '', results: [], totalFound: 0})},
    }
  })

  afterEach(() => {
    restore()
  })

  describe('executeWithAgent', () => {
    it('returns a structured result with logId and formatted summary', async () => {
      const executor = new DreamExecutor(deps)
      const {logId, result} = await executor.executeWithAgent(agent, defaultOptions)
      expect(logId).to.equal('drm-1000')
      expect(result).to.include('Dream completed (drm-1000)')
      expect(result).to.include('No changes needed')
    })

    it('formats result with operation counts when present', () => {
      const executor = new DreamExecutor(deps)
      const formatResult = (executor as unknown as {formatResult(logId: string, summary: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamLogSummary): string}).formatResult.bind(executor)

      const result = formatResult('drm-2000', {consolidated: 3, errors: 0, flaggedForReview: 0, pruned: 1, synthesized: 2})
      expect(result).to.include('Dream completed (drm-2000)')
      expect(result).to.include('3 consolidated')
      expect(result).to.include('2 synthesized')
      expect(result).to.include('1 pruned')
      expect(result).to.not.include('No changes needed')
    })

    it('formats result with flagged-for-review count', () => {
      const executor = new DreamExecutor(deps)
      const formatResult = (executor as unknown as {formatResult(logId: string, summary: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamLogSummary): string}).formatResult.bind(executor)

      const result = formatResult('drm-3000', {consolidated: 1, errors: 0, flaggedForReview: 2, pruned: 0, synthesized: 0})
      expect(result).to.include('1 consolidated')
      expect(result).to.include('2 operations flagged for review')
    })

    it('omits no-changes message when only flaggedForReview is non-zero', () => {
      const executor = new DreamExecutor(deps)
      const formatResult = (executor as unknown as {formatResult(logId: string, summary: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamLogSummary): string}).formatResult.bind(executor)

      const result = formatResult('drm-3500', {consolidated: 0, errors: 0, flaggedForReview: 1, pruned: 0, synthesized: 0})
      expect(result).to.include('1 operations flagged for review')
      expect(result).to.not.include('No changes needed')
    })

    it('formats result with error count and omits no-changes message', () => {
      const executor = new DreamExecutor(deps)
      const formatResult = (executor as unknown as {formatResult(logId: string, summary: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamLogSummary): string}).formatResult.bind(executor)

      const result = formatResult('drm-4000', {consolidated: 0, errors: 2, flaggedForReview: 0, pruned: 0, synthesized: 0})
      expect(result).to.include('Dream completed (drm-4000)')
      expect(result).to.include('2 operations failed')
      expect(result).to.not.include('No changes needed')
    })

    it('saves a processing log entry before executing', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(dreamLogStore.save.callCount).to.be.at.least(2)

      const processingEntry = dreamLogStore.save.firstCall.args[0]
      expect(processingEntry.status).to.equal('processing')
      expect(processingEntry.id).to.equal('drm-1000')
      expect(processingEntry.taskId).to.equal('test-task-1')
      expect(processingEntry.trigger).to.equal('cli')
      expect(processingEntry.operations).to.deep.equal([])
    })

    it('saves a completed log entry with zero summary', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      const completedEntry = dreamLogStore.save.lastCall.args[0]
      expect(completedEntry.status).to.equal('completed')
      expect(completedEntry.completedAt).to.be.a('number')
      expect(completedEntry.taskId).to.equal('test-task-1')
      expect(completedEntry.summary).to.deep.equal({
        consolidated: 0,
        errors: 0,
        flaggedForReview: 0,
        pruned: 0,
        synthesized: 0,
      })
    })

    it('updates dream state: resets curationsSinceDream, sets lastDreamAt, increments totalDreams', async () => {
      dreamStateService.read.resolves({
        ...EMPTY_DREAM_STATE,
        curationsSinceDream: 5,
        pendingMerges: [],
        totalDreams: 2,
      })

      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(dreamStateService.write.calledOnce).to.be.true
      const writtenState = dreamStateService.write.firstCall.args[0]
      expect(writtenState.curationsSinceDream).to.equal(0)
      expect(writtenState.lastDreamLogId).to.equal('drm-1000')
      expect(writtenState.totalDreams).to.equal(3)
      expect(writtenState.lastDreamAt).to.be.a('string')
      // Verify it's a valid ISO datetime
      expect(Number.isNaN(new Date(writtenState.lastDreamAt).getTime())).to.be.false
    })

    it('releases lock on success', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(dreamLockService.release.calledOnce).to.be.true
      expect(dreamLockService.rollback.called).to.be.false
    })

    it('saves error log and rolls back lock on error', async () => {
      dreamStateService.read.rejects(new Error('disk full'))

      const executor = new DreamExecutor(deps)
      let caught: Error | undefined
      try {
        await executor.executeWithAgent(agent, {...defaultOptions, priorMtime: 500})
      } catch (error) {
        caught = error as Error
      }

      expect(caught).to.be.instanceOf(Error)
      expect(caught!.message).to.equal('disk full')

      // Error log saved (processing + error = 2 saves)
      const lastSave = dreamLogStore.save.lastCall.args[0]
      expect(lastSave.status).to.equal('error')
      expect(lastSave.error).to.include('disk full')
      expect(lastSave.completedAt).to.be.a('number')

      // Lock rolled back with priorMtime
      expect(dreamLockService.rollback.calledOnce).to.be.true
      expect(dreamLockService.rollback.firstCall.args[0]).to.equal(500)

      // Lock NOT released
      expect(dreamLockService.release.called).to.be.false
    })

    it('scans all curate logs on first dream (lastDreamAt = null)', async () => {
      dreamStateService.read.resolves({...EMPTY_DREAM_STATE, pendingMerges: []})

      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(curateLogStore.list.calledOnce).to.be.true
      const listArgs = curateLogStore.list.firstCall.args[0]
      expect(listArgs.after).to.equal(0) // epoch 0 = scan all
    })

    it('scans curate logs since last dream when lastDreamAt is set', async () => {
      dreamStateService.read.resolves({
        ...EMPTY_DREAM_STATE,
        lastDreamAt: '2024-01-01T00:00:00.000Z',
        pendingMerges: [],
      })

      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(curateLogStore.list.calledOnce).to.be.true
      const listArgs = curateLogStore.list.firstCall.args[0]
      expect(listArgs.after).to.equal(new Date('2024-01-01T00:00:00.000Z').getTime())
      expect(listArgs.status).to.deep.equal(['completed'])
    })

    it('clears pendingMerges consumed by consolidate and preserves version in the post-dream state write', async () => {
      // After ENG-2126 fix #3, consolidate consumes pendingMerges up-front (writes
      // pendingMerges=[] to state) so they are not re-applied in the next dream.
      // Step 7's write then inherits the cleared value from the re-read.
      const pendingMerge = {mergeTarget: 'target.md', reason: 'Overlap', sourceFile: 'source.md', suggestedByDreamId: 'drm-prev'}

      // Dynamic stub — read() returns the latest write so later steps see the
      // consumed state (mirrors real disk-backed service semantics).
      let currentState: import('../../../../src/server/infra/dream/dream-state-schema.js').DreamState = {
        ...EMPTY_DREAM_STATE,
        curationsSinceDream: 3,
        pendingMerges: [pendingMerge],
        totalDreams: 1,
        version: 1,
      }
      dreamStateService.read.callsFake(async () => currentState)
      dreamStateService.write.callsFake(async (state: import('../../../../src/server/infra/dream/dream-state-schema.js').DreamState) => {
        currentState = state
      })

      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      // First write comes from consolidate's consumption step.
      const consumeWrite = dreamStateService.write.firstCall.args[0]
      expect(consumeWrite.pendingMerges).to.deep.equal([])

      // Final (step 7) write preserves version and carries the cleared pendingMerges forward.
      const finalWrite = dreamStateService.write.lastCall.args[0]
      expect(finalWrite.version).to.equal(1)
      expect(finalWrite.pendingMerges).to.deep.equal([])
    })

    it('propagates trigger value from options to log entry', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, {...defaultOptions, trigger: 'agent-idle'})

      const processingEntry = dreamLogStore.save.firstCall.args[0]
      expect(processingEntry.trigger).to.equal('agent-idle')

      const completedEntry = dreamLogStore.save.lastCall.args[0]
      expect(completedEntry.trigger).to.equal('agent-idle')
    })

    it('rolls back lock when dream log save fails on success path', async () => {
      // First save (processing) succeeds, second save (completed) fails
      dreamLogStore.save.onFirstCall().resolves()
      dreamLogStore.save.onSecondCall().rejects(new Error('log save failed'))

      const executor = new DreamExecutor(deps)
      let caught: Error | undefined
      try {
        await executor.executeWithAgent(agent, defaultOptions)
      } catch (error) {
        caught = error as Error
      }

      expect(caught).to.be.instanceOf(Error)
      expect(caught!.message).to.equal('log save failed')

      // Lock should be rolled back (not released) since the error occurred
      expect(dreamLockService.rollback.calledOnce).to.be.true
    })

    it('does not create review entries when completed dream log save fails', async () => {
      dreamLogStore.save.onFirstCall().resolves()
      dreamLogStore.save.onSecondCall().rejects(new Error('log save failed'))

      const executor = new DreamExecutor(deps)
      const createReviewEntries = stub().resolves()
      ;(executor as unknown as {createReviewEntries: SinonStub}).createReviewEntries = createReviewEntries

      let caught: Error | undefined
      try {
        await executor.executeWithAgent(agent, defaultOptions)
      } catch (error) {
        caught = error as Error
      }

      expect(caught).to.be.instanceOf(Error)
      expect(caught!.message).to.equal('log save failed')
      expect(createReviewEntries.called).to.be.false
    })

    it('does not create curate log entries when no operations have needsReview', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      // curateLogStore.save should only be called for review entries, not for the dream itself
      // No operations → no review entries
      expect(curateLogStore.save.called).to.be.false
    })

    it('creates curate log entry with reviewStatus=pending for needsReview operations', async () => {
      const executor = new DreamExecutor(deps)
      const operations: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation[] = [
        {action: 'ARCHIVE', file: 'auth/stale.md', needsReview: true, reason: 'Stale doc', stubPath: '_archived/auth/stale.stub.md', type: 'PRUNE'},
        {action: 'KEEP', file: 'api/useful.md', needsReview: false, reason: 'Still relevant', type: 'PRUNE'},
      ]

      // Call private method directly to test dual-write logic
      await (executor as unknown as {createReviewEntries: (ops: typeof operations, dir: string, taskId: string) => Promise<void>})
        .createReviewEntries(operations, '/tmp/ctx', 'test-task')

      expect(curateLogStore.getNextId.calledOnce).to.be.true
      expect(curateLogStore.save.calledOnce).to.be.true

      const savedEntry = curateLogStore.save.firstCall.args[0]
      expect(savedEntry.status).to.equal('completed')
      expect(savedEntry.input.context).to.equal('dream')
      expect(savedEntry.operations).to.have.lengthOf(1) // Only the needsReview op

      const op = savedEntry.operations[0]
      expect(op.type).to.equal('DELETE') // ARCHIVE maps to DELETE
      expect(op.path).to.equal('auth/stale.md')
      expect(op.reviewStatus).to.equal('pending')
      expect(op.needsReview).to.be.true
      expect(op.reason).to.include('dream/prune')
    })

    it('maps TEMPORAL_UPDATE review entries to the updated file path', async () => {
      const executor = new DreamExecutor(deps)
      const operations: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation[] = [
        {
          action: 'TEMPORAL_UPDATE',
          inputFiles: ['api/changelog.md'],
          needsReview: true,
          previousTexts: {'api/changelog.md': 'Before'},
          reason: 'Normalize chronology',
          type: 'CONSOLIDATE',
        },
      ]

      await (executor as unknown as {createReviewEntries: (ops: typeof operations, dir: string, taskId: string) => Promise<void>})
        .createReviewEntries(operations, '/tmp/ctx', 'test-task')

      const savedEntry = curateLogStore.save.firstCall.args[0]
      expect(savedEntry.taskId).to.equal('test-task')
      expect(savedEntry.operations[0]).to.include({
        path: 'api/changelog.md',
        reviewStatus: 'pending',
        type: 'UPDATE',
      })
      expect(savedEntry.operations[0].filePath).to.equal('/tmp/ctx/api/changelog.md')
    })

    it('maps CROSS_REFERENCE review entries with additional file paths for restoration', async () => {
      const executor = new DreamExecutor(deps)
      const operations: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation[] = [
        {
          action: 'CROSS_REFERENCE',
          inputFiles: ['auth/core.md', 'auth/helper.md'],
          needsReview: true,
          previousTexts: {
            'auth/core.md': 'Before core',
            'auth/helper.md': 'Before helper',
          },
          reason: 'Related',
          type: 'CONSOLIDATE',
        },
      ]

      await (executor as unknown as {createReviewEntries: (ops: typeof operations, dir: string, taskId: string) => Promise<void>})
        .createReviewEntries(operations, '/tmp/ctx', 'test-task')

      const savedEntry = curateLogStore.save.firstCall.args[0]
      expect(savedEntry.operations[0]).to.include({
        path: 'auth/core.md',
        reviewStatus: 'pending',
        type: 'UPDATE',
      })
      expect(savedEntry.operations[0].additionalFilePaths).to.deep.equal(['/tmp/ctx/auth/helper.md'])
    })

    it('skips dream-generated curate entries when collecting changed files', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-dream-executor-'))
      const contextTreeDir = join(projectRoot, '.brv', 'context-tree')
      mkdirSync(join(contextTreeDir, 'auth'), {recursive: true})
      writeFileSync(join(contextTreeDir, 'auth', 'curated.md'), '# curated')
      writeFileSync(join(contextTreeDir, 'auth', 'dream.md'), '# dream')

      curateLogStore.list.resolves([
        {
          completedAt: 2,
          id: 'cur-dream',
          input: {context: 'dream'},
          operations: [{
            filePath: join(contextTreeDir, 'auth', 'dream.md'),
            path: 'auth/dream.md',
            status: 'success',
            type: 'UPDATE',
          }],
          startedAt: 1,
          status: 'completed',
          summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 1},
          taskId: 'dream-task',
        },
        {
          completedAt: 4,
          id: 'cur-user',
          input: {context: 'cli'},
          operations: [{
            filePath: join(contextTreeDir, 'auth', 'curated.md'),
            path: 'auth/curated.md',
            status: 'success',
            type: 'UPDATE',
          }],
          startedAt: 3,
          status: 'completed',
          summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 1},
          taskId: 'user-task',
        },
      ])

      try {
        const executor = new DreamExecutor(deps)
        const changedFiles = await (executor as unknown as {
          findChangedFilesSinceLastDream(lastDreamAt: null | string, contextTreeDir: string): Promise<Set<string>>
        }).findChangedFilesSinceLastDream(null, contextTreeDir)

        expect([...changedFiles]).to.deep.equal(['auth/curated.md'])
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    // ==========================================================================
    // Stale-summary queue: drain + re-enqueue on propagation failure
    // ==========================================================================

    it('propagates over A ∪ B union of drained queue and snapshot diff (happy path)', async () => {
      // The merge at dream-executor.ts is the central correctness invariant of this
      // PR — anything in EITHER the queue (A) OR dream's own diff (B) must be
      // propagated, exactly once per path. This test pins that invariant.
      dreamStateService.drainStaleSummaryPaths.resolves(['queue/path.md'])

      // Real temp project so snapshotService.getCurrentState succeeds. We override
      // runOperations to write a new file between pre and post snapshots, so the
      // snapshot diff produces a non-empty list — that becomes the B half of A ∪ B.
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-dream-merge-'))
      const contextTreeDir = join(projectRoot, '.brv', 'context-tree')
      mkdirSync(contextTreeDir, {recursive: true})
      const captured: string[][] = []

      class MergeTestExecutor extends DreamExecutor {
        protected override async runOperations(): Promise<void> {
          // Mutate the tree so postState differs from preState by 'diff/added.md'.
          mkdirSync(join(contextTreeDir, 'diff'), {recursive: true})
          writeFileSync(join(contextTreeDir, 'diff', 'added.md'), '# new from dream')
        }

        protected override async runStaleSummaryPropagation(opts: {
          agent: ICipherAgent
          paths: string[]
          projectRoot: string
        }): Promise<void> {
          captured.push([...opts.paths].sort())
        }
      }

      try {
        const executor = new MergeTestExecutor(deps)
        await executor.executeWithAgent(agent, {...defaultOptions, projectRoot})
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }

      expect(captured).to.have.lengthOf(1)
      expect(captured[0]).to.deep.equal(['diff/added.md', 'queue/path.md'])
      expect(dreamStateService.enqueueStaleSummaryPaths.callCount).to.equal(0)
    })

    it('dedups paths that appear in both the queue and the snapshot diff (single regeneration)', async () => {
      dreamStateService.drainStaleSummaryPaths.resolves(['shared/path.md'])

      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-dream-merge-dedup-'))
      const contextTreeDir = join(projectRoot, '.brv', 'context-tree')
      mkdirSync(contextTreeDir, {recursive: true})
      const captured: string[][] = []

      class MergeTestExecutor extends DreamExecutor {
        protected override async runOperations(): Promise<void> {
          // Write the SAME path the queue contains — the merge must dedup.
          mkdirSync(join(contextTreeDir, 'shared'), {recursive: true})
          writeFileSync(join(contextTreeDir, 'shared', 'path.md'), '# also touched by dream')
        }

        protected override async runStaleSummaryPropagation(opts: {
          agent: ICipherAgent
          paths: string[]
          projectRoot: string
        }): Promise<void> {
          captured.push([...opts.paths].sort())
        }
      }

      try {
        const executor = new MergeTestExecutor(deps)
        await executor.executeWithAgent(agent, {...defaultOptions, projectRoot})
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }

      expect(captured).to.have.lengthOf(1)
      expect(captured[0]).to.deep.equal(['shared/path.md'])
    })

    it('re-enqueues drained snapshot when post-dream propagation throws', async () => {
      // Atomic drain removes entries upfront. If propagation fails, the catch
      // block must re-enqueue so the snapshot is not lost.
      dreamStateService.drainStaleSummaryPaths.resolves([
        'auth/jwt/token.md',
        'billing/webhooks/stripe.md',
      ])

      // Force the propagation block to throw by making the snapshot service fail.
      // The dream-executor wraps Step 5 in try/catch so the dream itself completes.
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-dream-reenqueue-'))
      try {
        const executor = new DreamExecutor(deps)
        // executeWithAgent uses a real FileContextTreeSnapshotService bound to projectRoot.
        // The directory exists but has no .brv/context-tree, so getCurrentState throws —
        // exercising the catch block that should re-enqueue the drained snapshot.
        await executor.executeWithAgent(agent, {...defaultOptions, projectRoot})
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }

      expect(dreamStateService.enqueueStaleSummaryPaths.calledOnce).to.equal(true)
      expect(dreamStateService.enqueueStaleSummaryPaths.firstCall.args[0]).to.deep.equal([
        'auth/jwt/token.md',
        'billing/webhooks/stripe.md',
      ])
    })

    it('does not call enqueue when drain returns an empty snapshot (no work to retry)', async () => {
      // Default drain stub returns [] — no snapshot to preserve on failure.
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(dreamStateService.enqueueStaleSummaryPaths.callCount).to.equal(0)
    })

    // ==========================================================================
    // Partial / error log preservation (ENG-2126 fix #2)
    // ==========================================================================

    describe('partial / error log preservation', () => {
      const reviewableOp: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation = {
        action: 'MERGE',
        inputFiles: ['auth/a.md', 'auth/b.md'],
        needsReview: true,
        outputFile: 'auth/a.md',
        previousTexts: {'auth/a.md': '# a before', 'auth/b.md': '# b before'},
        reason: 'Duplicate concepts',
        type: 'CONSOLIDATE',
      }

      it('preserves partial operations in the partial log entry when the budget aborts', async () => {
        const executor = makePartialRunExecutor({
          aborted: true,
          deps,
          injected: [reviewableOp],
          throwErr: new Error('timeout'),
        })

        try {
          await executor.executeWithAgent(agent, defaultOptions)
          expect.fail('should have thrown')
        } catch {
          // expected
        }

        // Find the partial save (last dream log save with status=partial)
        const dreamLogSaves = dreamLogStore.save.getCalls().map((c) => c.args[0])
        const partial = dreamLogSaves.find((e) => e.status === 'partial')
        expect(partial, 'expected a partial log entry').to.exist
        expect(partial!.operations, 'partial operations should be preserved').to.deep.equal([reviewableOp])
        expect(partial!.summary.consolidated).to.equal(1)
        expect(partial!.summary.flaggedForReview).to.equal(1)
        expect(partial!.abortReason).to.include('Budget exceeded')
      })

      it('preserves partial operations in the error log entry on non-abort errors', async () => {
        const executor = makePartialRunExecutor({
          aborted: false,
          deps,
          injected: [reviewableOp],
          throwErr: new Error('disk full'),
        })

        try {
          await executor.executeWithAgent(agent, defaultOptions)
          expect.fail('should have thrown')
        } catch {
          // expected
        }

        const dreamLogSaves = dreamLogStore.save.getCalls().map((c) => c.args[0])
        const errorEntry = dreamLogSaves.find((e) => e.status === 'error')
        expect(errorEntry, 'expected an error log entry').to.exist
        expect(errorEntry!.operations, 'error operations should be preserved').to.deep.equal([reviewableOp])
        expect(errorEntry!.summary.consolidated).to.equal(1)
        expect(errorEntry!.summary.flaggedForReview).to.equal(1)
        expect(errorEntry!.error).to.include('disk full')
      })

      it('surfaces review-flagged ops from a partial run into the curate review log', async () => {
        const executor = makePartialRunExecutor({
          aborted: false,
          deps,
          injected: [reviewableOp],
          throwErr: new Error('disk full'),
        })

        try {
          await executor.executeWithAgent(agent, defaultOptions)
        } catch {
          // expected
        }

        // createReviewEntries should have been invoked for the completed review-flagged op
        expect(curateLogStore.save.called, 'expected review entry to be created for partial run').to.be.true
        const reviewEntry = curateLogStore.save.firstCall.args[0]
        expect(reviewEntry.operations).to.have.lengthOf(1)
        expect(reviewEntry.operations[0].reviewStatus).to.equal('pending')
      })

      it('does NOT duplicate review entries when step 7 (state update) throws after success-path review writes', async () => {
        // Regression for Codex P2: success-path createReviewEntries (after the
        // completed log save) writes review entries; if the subsequent
        // dreamStateService.update throws, control jumps to catch, which would
        // re-invoke createReviewEntries on the same allOperations, producing
        // duplicate entries in `brv review pending`.
        dreamStateService.update.rejects(new Error('state.json EROFS'))

        const executor = new DreamExecutor(deps)
        const createReviewEntries = stub().resolves()
        ;(executor as unknown as {createReviewEntries: SinonStub}).createReviewEntries = createReviewEntries

        // Inject a single completed reviewable op via a runOperations override
        ;(executor as unknown as {
          runOperations: (args: {
            agent: ICipherAgent
            changedFiles: Set<string>
            contextTreeDir: string
            logId: string
            out: import('../../../../src/server/infra/dream/dream-log-schema.js').DreamOperation[]
            projectRoot: string
            signal: AbortSignal
            taskId: string
          }) => Promise<void>
        }).runOperations = async (args) => {
          args.out.push(reviewableOp)
        }

        try {
          await executor.executeWithAgent(agent, defaultOptions)
          expect.fail('should have thrown')
        } catch {
          // expected (state.json EROFS)
        }

        expect(
          createReviewEntries.callCount,
          'createReviewEntries must run exactly once when step 7 throws after success-path review write',
        ).to.equal(1)
      })
    })
  })
})
