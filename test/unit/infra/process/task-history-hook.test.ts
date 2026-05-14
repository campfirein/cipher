/**
 * TaskHistoryHook tests — M2.06.
 *
 * Verifies the lifecycle-hook implementation that persists `TaskInfo`
 * state via `ITaskHistoryStore` at create / update / terminal transitions.
 * Uses an in-memory stub store; no filesystem.
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {TaskHistoryEntry} from '../../../../src/server/core/domain/entities/task-history-entry.js'
import type {TaskInfo} from '../../../../src/server/core/domain/transport/task-info.js'
import type {ITaskHistoryStore} from '../../../../src/server/core/interfaces/storage/i-task-history-store.js'

import {TaskHistoryHook} from '../../../../src/server/infra/process/task-history-hook.js'

type StubStore = ITaskHistoryStore & {
  clear: SinonStub
  delete: SinonStub
  deleteMany: SinonStub
  getById: SinonStub
  list: SinonStub
  save: SinonStub
}

function makeStubStore(sandbox: SinonSandbox): StubStore {
  return {
    clear: sandbox.stub().resolves({deletedCount: 0, taskIds: []}),
    delete: sandbox.stub().resolves(true),
    deleteMany: sandbox.stub().resolves([]),
    getById: sandbox.stub().resolves(),
    list: sandbox.stub().resolves([]),
    save: sandbox.stub().resolves(),
  }
}

function makeTaskInfo(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    clientId: 'client-1',
    content: 'do the thing',
    createdAt: 1_745_432_000_000,
    projectPath: '/p',
    taskId: 'abc',
    type: 'curate',
    ...overrides,
  }
}

describe('TaskHistoryHook', () => {
  let sandbox: SinonSandbox
  let store: StubStore
  let hook: TaskHistoryHook

  beforeEach(() => {
    sandbox = createSandbox()
    store = makeStubStore(sandbox)
    hook = new TaskHistoryHook({getStore: () => store})
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('onTaskCreate writes data file then index line, status=created', async () => {
    const task = makeTaskInfo()

    await hook.onTaskCreate(task)

    expect(store.save.calledOnce).to.equal(true)
    const entry = store.save.firstCall.args[0] as TaskHistoryEntry
    expect(entry.status).to.equal('created')
    expect(entry.id).to.equal('tsk-abc')
    expect(entry.taskId).to.equal('abc')
    expect(entry.schemaVersion).to.equal(1)
  })

  it('onTaskUpdate (throttled) saves with current accumulator state', async () => {
    const task = makeTaskInfo({
      reasoningContents: [{content: 'hmm', isThinking: false, timestamp: 1}],
      startedAt: 1_745_432_001_000,
      status: 'started',
      toolCalls: [
        {args: {}, callId: 'c1', sessionId: 's1', status: 'running', timestamp: 1, toolName: 'read'},
      ],
    })

    await hook.onTaskUpdate(task)

    expect(store.save.calledOnce).to.equal(true)
    const entry = store.save.firstCall.args[0] as TaskHistoryEntry
    expect(entry.status).to.equal('started')
    expect(entry.reasoningContents).to.have.lengthOf(1)
    expect(entry.toolCalls).to.have.lengthOf(1)
  })

  it('onTaskCompleted saves with full Level 2 detail (responseContent, toolCalls, reasoning)', async () => {
    const task = makeTaskInfo({
      reasoningContents: [{content: 'thought', isThinking: false, timestamp: 1}],
      responseContent: 'final answer',
      sessionId: 'sess-1',
      startedAt: 1_745_432_001_000,
      status: 'started',
      toolCalls: [
        {args: {}, callId: 'c1', sessionId: 'sess-1', status: 'completed', timestamp: 1, toolName: 'read'},
      ],
    })

    await hook.onTaskCompleted('abc', 'final answer', task)

    expect(store.save.calledOnce).to.equal(true)
    const entry = store.save.firstCall.args[0] as TaskHistoryEntry
    expect(entry.status).to.equal('completed')
    if (entry.status === 'completed') {
      expect(entry.result).to.equal('final answer')
    }

    expect(entry.responseContent).to.equal('final answer')
    expect(entry.reasoningContents).to.have.lengthOf(1)
    expect(entry.toolCalls).to.have.lengthOf(1)
    expect(entry.sessionId).to.equal('sess-1')
  })

  it('onTaskError saves with error payload + accumulated detail', async () => {
    const task = makeTaskInfo({
      startedAt: 1_745_432_001_000,
      status: 'started',
      toolCalls: [
        {args: {}, callId: 'c1', sessionId: 's1', status: 'error', timestamp: 1, toolName: 'read'},
      ],
    })

    await hook.onTaskError('abc', 'kaboom', task)

    expect(store.save.calledOnce).to.equal(true)
    const entry = store.save.firstCall.args[0] as TaskHistoryEntry
    expect(entry.status).to.equal('error')
    if (entry.status === 'error') {
      expect(entry.error).to.deep.equal({code: 'TASK_ERROR', message: 'kaboom', name: 'TaskError'})
    }

    expect(entry.toolCalls).to.have.lengthOf(1)
  })

  it('onTaskCancelled saves with completedAt', async () => {
    const task = makeTaskInfo({startedAt: 1_745_432_001_000, status: 'started'})

    await hook.onTaskCancelled('abc', task)

    expect(store.save.calledOnce).to.equal(true)
    const entry = store.save.firstCall.args[0] as TaskHistoryEntry
    expect(entry.status).to.equal('cancelled')
    if (entry.status === 'cancelled') {
      expect(entry.completedAt).to.be.a('number')
    }
  })

  it('same id (tsk-<taskId>) across transitions', async () => {
    const task = makeTaskInfo({taskId: 'shared'})

    await hook.onTaskCreate(task)
    await hook.onTaskUpdate({...task, startedAt: 1, status: 'started'})
    await hook.onTaskCompleted('shared', 'done', {...task, startedAt: 1, status: 'started'})

    expect(store.save.callCount).to.equal(3)
    const ids = store.save.getCalls().map((c) => (c.args[0] as TaskHistoryEntry).id)
    expect(ids).to.deep.equal(['tsk-shared', 'tsk-shared', 'tsk-shared'])
  })

  it('store throw is swallowed', async () => {
    store.save.rejects(new Error('disk full'))
    const task = makeTaskInfo()

    let threw = false
    try {
      await hook.onTaskCreate(task)
    } catch {
      threw = true
    }

    expect(threw).to.equal(false)
  })

  it('tasks without projectPath skipped', async () => {
    const task = makeTaskInfo({projectPath: undefined})

    await hook.onTaskCreate(task)
    await hook.onTaskUpdate(task)
    await hook.onTaskCompleted('abc', 'done', task)
    await hook.onTaskError('abc', 'boom', task)
    await hook.onTaskCancelled('abc', task)

    expect(store.save.called).to.equal(false)
  })
})
