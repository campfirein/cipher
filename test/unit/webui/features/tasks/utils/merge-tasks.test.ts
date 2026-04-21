import {expect} from 'chai'

import type {TaskListItem} from '../../../../../../src/shared/transport/events/task-events.js'

import {mergeTaskList, removeTaskFromList} from '../../../../../../src/webui/features/tasks/utils/merge-tasks.js'

const item = (overrides: Partial<TaskListItem> & {taskId: string}): TaskListItem => ({
  content: 'do thing',
  createdAt: 1000,
  status: 'created',
  type: 'curate',
  ...overrides,
})

describe('mergeTaskList helpers', () => {
  describe('mergeTaskList', () => {
    it('returns the incoming list when current is empty', () => {
      const incoming = [item({taskId: 'a'}), item({taskId: 'b'})]
      expect(mergeTaskList([], incoming)).to.have.lengthOf(2)
    })

    it('merges fields by taskId — incoming wins', () => {
      const current = [item({content: 'old', startedAt: 100, status: 'started', taskId: 'a'})]
      const incoming = [item({completedAt: 200, content: 'new', result: 'ok', status: 'completed', taskId: 'a'})]

      const merged = mergeTaskList(current, incoming)
      expect(merged).to.have.lengthOf(1)
      expect(merged[0]).to.include({
        completedAt: 200,
        content: 'new',
        result: 'ok',
        startedAt: 100,
        status: 'completed',
        taskId: 'a',
      })
    })

    it('appends new tasks not already present', () => {
      const current = [item({taskId: 'a'})]
      const incoming = [item({status: 'started', taskId: 'a'}), item({taskId: 'b'})]

      const merged = mergeTaskList(current, incoming)
      expect(merged.map((task) => task.taskId).sort()).to.deep.equal(['a', 'b'])
      expect(merged.find((task) => task.taskId === 'a')!.status).to.equal('started')
    })

    it('does not mutate the original list', () => {
      const current = [item({taskId: 'a'})]
      const incoming = [item({status: 'started', taskId: 'a'})]
      mergeTaskList(current, incoming)
      expect(current[0].status).to.equal('created')
    })
  })

  describe('removeTaskFromList', () => {
    it('drops the matching task', () => {
      const current = [item({taskId: 'a'}), item({taskId: 'b'})]
      expect(removeTaskFromList(current, 'a')).to.have.lengthOf(1)
      expect(removeTaskFromList(current, 'a')[0].taskId).to.equal('b')
    })

    it('returns the same list when no match', () => {
      const current = [item({taskId: 'a'})]
      expect(removeTaskFromList(current, 'missing')).to.deep.equal(current)
    })
  })
})
