import {expect} from 'chai'

import type {TaskListItem} from '../../../../../../src/shared/transport/events/task-events.js'

import {
  countByGroup,
  isTerminalStatus,
  TASK_STATUS_GROUPS,
  toStatusGroup,
} from '../../../../../../src/webui/features/tasks/utils/task-status.js'

const item = (overrides: Partial<TaskListItem> & {taskId: string}): TaskListItem => ({
  content: 'do thing',
  createdAt: 1000,
  status: 'created',
  type: 'curate',
  ...overrides,
})

describe('task-status helpers', () => {
  describe('toStatusGroup', () => {
    it('maps created → pending', () => {
      expect(toStatusGroup('created')).to.equal('pending')
    })

    it('maps started → in_progress', () => {
      expect(toStatusGroup('started')).to.equal('in_progress')
    })

    it('maps completed/error/cancelled → completed', () => {
      expect(toStatusGroup('completed')).to.equal('completed')
      expect(toStatusGroup('error')).to.equal('completed')
      expect(toStatusGroup('cancelled')).to.equal('completed')
    })
  })

  describe('isTerminalStatus', () => {
    it('treats completed/error/cancelled as terminal', () => {
      expect(isTerminalStatus('completed')).to.be.true
      expect(isTerminalStatus('error')).to.be.true
      expect(isTerminalStatus('cancelled')).to.be.true
    })

    it('treats created/started as non-terminal', () => {
      expect(isTerminalStatus('created')).to.be.false
      expect(isTerminalStatus('started')).to.be.false
    })
  })

  describe('countByGroup', () => {
    it('returns counts grouped by status bucket', () => {
      const tasks = [
        item({status: 'created', taskId: '1'}),
        item({status: 'started', taskId: '2'}),
        item({status: 'completed', taskId: '3'}),
        item({status: 'error', taskId: '4'}),
        item({status: 'cancelled', taskId: '5'}),
      ]

      expect(countByGroup(tasks)).to.deep.equal({completed: 3, inProgress: 1, pending: 1, total: 5})
    })

    it('returns zeros for an empty list', () => {
      expect(countByGroup([])).to.deep.equal({completed: 0, inProgress: 0, pending: 0, total: 0})
    })
  })

  describe('TASK_STATUS_GROUPS', () => {
    it('exposes the canonical group order', () => {
      expect(TASK_STATUS_GROUPS).to.deep.equal(['pending', 'in_progress', 'completed'])
    })
  })
})
