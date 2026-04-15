import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {EMPTY_DREAM_STATE} from '../../../../src/server/infra/dream/dream-state-schema.js'
import {DreamExecutor, type DreamExecutorDeps} from '../../../../src/server/infra/executor/dream-executor.js'

describe('DreamExecutor', () => {
  let dreamStateService: {read: SinonStub; write: SinonStub}
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
      read: stub().resolves({...EMPTY_DREAM_STATE, pendingMerges: []}),
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
    it('returns a formatted result summary', async () => {
      const executor = new DreamExecutor(deps)
      const result = await executor.executeWithAgent(agent, defaultOptions)
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

    it('preserves pending merges and version in updated dream state', async () => {
      const pendingMerge = {mergeTarget: 'target.md', sourceFile: 'source.md'}
      dreamStateService.read.resolves({
        ...EMPTY_DREAM_STATE,
        curationsSinceDream: 3,
        pendingMerges: [pendingMerge],
        totalDreams: 1,
        version: 1,
      })

      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      const writtenState = dreamStateService.write.firstCall.args[0]
      expect(writtenState.version).to.equal(1)
      expect(writtenState.pendingMerges).to.deep.equal([pendingMerge])
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
  })
})
