import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {BrvApiClient} from '../../../../../../src/webui/lib/api-client.js'

import {TaskEvents, type TaskListResponse} from '../../../../../../src/shared/transport/events/task-events.js'
import {
  DEFAULT_PAGE_LIMIT,
  getNextPageParam,
  getTasks,
  initialPageParam,
} from '../../../../../../src/webui/features/tasks/api/get-tasks.js'
import {useTransportStore} from '../../../../../../src/webui/stores/transport-store.js'

describe('get-tasks api', () => {
describe('getTasks', () => {
  let sandbox: SinonSandbox
  let request: SinonStub

  beforeEach(() => {
    sandbox = createSandbox()
    request = sandbox.stub()
    useTransportStore.setState({
      apiClient: {on: sandbox.stub(), request} as unknown as BrvApiClient,
    })
  })

  afterEach(() => {
    sandbox.restore()
    useTransportStore.setState({apiClient: null})
  })

  it('emits task:list with the request payload', async () => {
    request.resolves({tasks: []})
    await getTasks({limit: 50, projectPath: '/foo'})
    expect(request.firstCall.args[0]).to.equal(TaskEvents.LIST)
    expect(request.firstCall.args[1]).to.deep.equal({limit: 50, projectPath: '/foo'})
  })

  it('forwards before + beforeTaskId for paginated requests', async () => {
    request.resolves({tasks: []})
    await getTasks({before: 1234, beforeTaskId: 'tsk-x', limit: 50, projectPath: '/foo'})
    expect(request.firstCall.args[1]).to.deep.equal({
      before: 1234,
      beforeTaskId: 'tsk-x',
      limit: 50,
      projectPath: '/foo',
    })
  })

  it('throws when not connected to the daemon', async () => {
    useTransportStore.setState({apiClient: null})
    try {
      await getTasks({limit: 50})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Not connected')
    }
  })
})

describe('initialPageParam', () => {
  it('returns default limit and projectPath when projectPath is provided', () => {
    expect(initialPageParam('/foo')).to.deep.equal({limit: DEFAULT_PAGE_LIMIT, projectPath: '/foo'})
  })

  it('omits projectPath when not provided', () => {
    expect(initialPageParam()).to.deep.equal({limit: DEFAULT_PAGE_LIMIT})
  })
})

describe('getNextPageParam', () => {
  const lastParam = {limit: 50, projectPath: '/foo'}

  it('returns undefined when lastPage has no nextCursor (last page reached)', () => {
    const lastPage: TaskListResponse = {tasks: []}
    expect(getNextPageParam(lastPage, lastParam)).to.equal(undefined)
  })

  it('returns next-page params when nextCursor is set', () => {
    const lastPage: TaskListResponse = {nextCursor: 1234, tasks: []}
    expect(getNextPageParam(lastPage, lastParam)).to.deep.equal({
      before: 1234,
      limit: 50,
      projectPath: '/foo',
    })
  })

  it('forwards nextCursorTaskId as beforeTaskId tiebreaker', () => {
    const lastPage: TaskListResponse = {nextCursor: 1234, nextCursorTaskId: 'tsk-x', tasks: []}
    expect(getNextPageParam(lastPage, lastParam)).to.deep.equal({
      before: 1234,
      beforeTaskId: 'tsk-x',
      limit: 50,
      projectPath: '/foo',
    })
  })
})
})
