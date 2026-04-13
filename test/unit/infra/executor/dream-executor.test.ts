import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {EMPTY_DREAM_STATE} from '../../../../src/server/infra/dream/dream-state-schema.js'
import {DreamExecutor, type DreamExecutorDeps} from '../../../../src/server/infra/executor/dream-executor.js'

describe('DreamExecutor', () => {
  let dreamStateService: {read: SinonStub; write: SinonStub}
  let dreamLogStore: {getNextId: SinonStub; save: SinonStub}
  let dreamLockService: {release: SinonStub; rollback: SinonStub}
  let curateLogStore: {list: SinonStub}
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
      list: stub().resolves([]),
    }
    agent = {
      createTaskSession: stub().resolves('session-1'),
      deleteTaskSession: stub().resolves(),
      executeOnSession: stub().resolves('```json\n{"actions":[]}\n```'),
      setSandboxVariableOnSession: stub(),
    } as unknown as ICipherAgent
    deps = {
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
    it('returns the dream log ID', async () => {
      const executor = new DreamExecutor(deps)
      const result = await executor.executeWithAgent(agent, defaultOptions)
      expect(result).to.equal('drm-1000')
    })

    it('saves a processing log entry before executing', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      expect(dreamLogStore.save.callCount).to.be.at.least(2)

      const processingEntry = dreamLogStore.save.firstCall.args[0]
      expect(processingEntry.status).to.equal('processing')
      expect(processingEntry.id).to.equal('drm-1000')
      expect(processingEntry.trigger).to.equal('cli')
      expect(processingEntry.operations).to.deep.equal([])
    })

    it('saves a completed log entry with zero summary', async () => {
      const executor = new DreamExecutor(deps)
      await executor.executeWithAgent(agent, defaultOptions)

      const completedEntry = dreamLogStore.save.lastCall.args[0]
      expect(completedEntry.status).to.equal('completed')
      expect(completedEntry.completedAt).to.be.a('number')
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
  })
})
