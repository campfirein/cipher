import {expect} from 'chai'

import type {TaskExecute} from '../../../../src/server/core/domain/transport/schemas.js'

import {ProjectTaskQueue} from '../../../../src/server/infra/daemon/project-task-queue.js'

function makeTask(overrides: Partial<TaskExecute> = {}): TaskExecute {
  return {
    clientId: 'client-1',
    content: 'test content',
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    type: 'curate',
    ...overrides,
  }
}

describe('ProjectTaskQueue', () => {
  let queue: ProjectTaskQueue

  beforeEach(() => {
    queue = new ProjectTaskQueue()
  })

  describe('enqueue/dequeue', () => {
    it('should enqueue and dequeue in FIFO order', () => {
      const task1 = makeTask({taskId: 'task-1'})
      const task2 = makeTask({taskId: 'task-2'})
      const task3 = makeTask({taskId: 'task-3'})

      queue.enqueue('/app', task1)
      queue.enqueue('/app', task2)
      queue.enqueue('/app', task3)

      expect(queue.dequeue('/app')).to.deep.equal(task1)
      expect(queue.dequeue('/app')).to.deep.equal(task2)
      expect(queue.dequeue('/app')).to.deep.equal(task3)
      expect(queue.dequeue('/app')).to.be.undefined
    })

    it('should return queue position on enqueue', () => {
      const task1 = makeTask({taskId: 'task-1'})
      const task2 = makeTask({taskId: 'task-2'})

      expect(queue.enqueue('/app', task1)).to.equal(1)
      expect(queue.enqueue('/app', task2)).to.equal(2)
    })

    it('should return undefined when dequeuing from empty project', () => {
      expect(queue.dequeue('/nonexistent')).to.be.undefined
    })

    it('should clean up empty project queues after dequeue', () => {
      const task = makeTask()
      queue.enqueue('/app', task)
      queue.dequeue('/app')

      expect(queue.getQueueLength('/app')).to.equal(0)
      expect(queue.hasWaitingTasks()).to.be.false
    })
  })

  describe('project isolation', () => {
    it('should isolate queues between projects', () => {
      const taskA = makeTask({taskId: 'task-a'})
      const taskB = makeTask({taskId: 'task-b'})

      queue.enqueue('/project-a', taskA)
      queue.enqueue('/project-b', taskB)

      expect(queue.dequeue('/project-a')).to.deep.equal(taskA)
      expect(queue.dequeue('/project-b')).to.deep.equal(taskB)
    })

    it('should not affect other projects when dequeuing', () => {
      const taskA = makeTask({taskId: 'task-a'})
      const taskB = makeTask({taskId: 'task-b'})

      queue.enqueue('/project-a', taskA)
      queue.enqueue('/project-b', taskB)

      queue.dequeue('/project-a')

      expect(queue.getQueueLength('/project-a')).to.equal(0)
      expect(queue.getQueueLength('/project-b')).to.equal(1)
    })
  })

  describe('dedup', () => {
    it('should reject duplicate taskId within same project', () => {
      const task = makeTask({taskId: 'dup-task'})

      expect(queue.enqueue('/app', task)).to.equal(1)
      expect(queue.enqueue('/app', task)).to.equal(-1)
      expect(queue.getQueueLength('/app')).to.equal(1)
    })

    it('should allow same taskId in different projects', () => {
      const task1 = makeTask({taskId: 'same-id'})
      const task2 = makeTask({taskId: 'same-id'})

      expect(queue.enqueue('/project-a', task1)).to.equal(1)
      expect(queue.enqueue('/project-b', task2)).to.equal(1)
    })
  })

  describe('cancel', () => {
    it('should cancel a queued task by taskId', () => {
      const task1 = makeTask({taskId: 'task-1'})
      const task2 = makeTask({taskId: 'task-2'})

      queue.enqueue('/app', task1)
      queue.enqueue('/app', task2)

      expect(queue.cancel('task-1')).to.be.true
      expect(queue.getQueueLength('/app')).to.equal(1)
      expect(queue.dequeue('/app')).to.deep.equal(task2)
    })

    it('should return false for non-existent taskId', () => {
      expect(queue.cancel('nonexistent')).to.be.false
    })

    it('should cancel task across projects', () => {
      const taskA = makeTask({taskId: 'target'})
      const taskB = makeTask({taskId: 'other'})

      queue.enqueue('/project-a', taskB)
      queue.enqueue('/project-b', taskA)

      expect(queue.cancel('target')).to.be.true
      expect(queue.getQueueLength('/project-b')).to.equal(0)
      expect(queue.getQueueLength('/project-a')).to.equal(1)
    })

    it('should clean up empty project queues after cancel', () => {
      const task = makeTask({taskId: 'only-task'})
      queue.enqueue('/app', task)

      queue.cancel('only-task')

      expect(queue.hasWaitingTasks()).to.be.false
    })
  })

  describe('clear', () => {
    it('should clear all queues', () => {
      queue.enqueue('/a', makeTask({taskId: 't1'}))
      queue.enqueue('/b', makeTask({taskId: 't2'}))
      queue.enqueue('/c', makeTask({taskId: 't3'}))

      queue.clear()

      expect(queue.hasWaitingTasks()).to.be.false
      expect(queue.getQueueLength('/a')).to.equal(0)
      expect(queue.getQueueLength('/b')).to.equal(0)
      expect(queue.getQueueLength('/c')).to.equal(0)
    })
  })

  describe('getProjectsWithTasks', () => {
    it('should return projects with queued tasks', () => {
      queue.enqueue('/a', makeTask({taskId: 't1'}))
      queue.enqueue('/b', makeTask({taskId: 't2'}))

      const projects = queue.getProjectsWithTasks()
      expect(projects).to.have.members(['/a', '/b'])
    })

    it('should return empty array when no tasks', () => {
      expect(queue.getProjectsWithTasks()).to.deep.equal([])
    })
  })

  describe('hasWaitingTasks', () => {
    it('should return false when empty', () => {
      expect(queue.hasWaitingTasks()).to.be.false
    })

    it('should return true when tasks exist', () => {
      queue.enqueue('/app', makeTask())
      expect(queue.hasWaitingTasks()).to.be.true
    })

    it('should return false after all tasks dequeued', () => {
      queue.enqueue('/app', makeTask())
      queue.dequeue('/app')
      expect(queue.hasWaitingTasks()).to.be.false
    })
  })

  describe('getQueueLength', () => {
    it('should return 0 for non-existent project', () => {
      expect(queue.getQueueLength('/nonexistent')).to.equal(0)
    })

    it('should return correct count', () => {
      queue.enqueue('/app', makeTask({taskId: 't1'}))
      queue.enqueue('/app', makeTask({taskId: 't2'}))
      queue.enqueue('/app', makeTask({taskId: 't3'}))

      expect(queue.getQueueLength('/app')).to.equal(3)
    })
  })
})
