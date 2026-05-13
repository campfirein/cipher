import {expect} from 'chai'

import type {Task} from '../../../../../../src/tui/features/tasks/stores/tasks-store.js'

import {selectCancelTargetTaskId} from '../../../../../../src/tui/features/tasks/hooks/select-cancel-target.js'

function makeTask(overrides: Partial<Task> & Pick<Task, 'status' | 'taskId' | 'type'>): Task {
  return {
    content: 'irrelevant',
    createdAt: 0,
    input: 'irrelevant',
    toolCalls: [],
    ...overrides,
  }
}

describe('selectCancelTargetTaskId', () => {
  it('returns undefined when there are no tasks', () => {
    const tasks = new Map<string, Task>()
    expect(selectCancelTargetTaskId(tasks)).to.equal(undefined)
  })

  it('returns undefined when every task is terminal', () => {
    const tasks = new Map<string, Task>([
      ['a', makeTask({status: 'completed', taskId: 'a', type: 'curate'})],
      ['b', makeTask({status: 'cancelled', taskId: 'b', type: 'query'})],
      ['c', makeTask({status: 'error', taskId: 'c', type: 'curate'})],
    ])
    expect(selectCancelTargetTaskId(tasks)).to.equal(undefined)
  })

  it('returns the only running task when exactly one is non-terminal', () => {
    const tasks = new Map<string, Task>([
      ['a', makeTask({status: 'completed', taskId: 'a', type: 'curate'})],
      ['b', makeTask({createdAt: 5, status: 'started', taskId: 'b', type: 'curate'})],
    ])
    expect(selectCancelTargetTaskId(tasks)).to.equal('b')
  })

  it('returns the most recently created non-terminal task when several are running', () => {
    const tasks = new Map<string, Task>([
      ['mid', makeTask({createdAt: 200, status: 'started', taskId: 'mid', type: 'query'})],
      ['new', makeTask({createdAt: 300, status: 'started', taskId: 'new', type: 'curate'})],
      ['old', makeTask({createdAt: 100, status: 'started', taskId: 'old', type: 'curate'})],
    ])
    expect(selectCancelTargetTaskId(tasks)).to.equal('new')
  })

  it('treats `created` status as non-terminal (still cancellable before task:started)', () => {
    const tasks = new Map<string, Task>([
      ['a', makeTask({createdAt: 10, status: 'created', taskId: 'a', type: 'curate'})],
    ])
    expect(selectCancelTargetTaskId(tasks)).to.equal('a')
  })

  it('ignores terminal siblings even when newer than running ones', () => {
    const tasks = new Map<string, Task>([
      ['fresh-but-done', makeTask({createdAt: 200, status: 'completed', taskId: 'fresh-but-done', type: 'curate'})],
      ['running', makeTask({createdAt: 100, status: 'started', taskId: 'running', type: 'curate'})],
    ])
    expect(selectCancelTargetTaskId(tasks)).to.equal('running')
  })
})
