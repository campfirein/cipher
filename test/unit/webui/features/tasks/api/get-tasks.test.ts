import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {BrvApiClient} from '../../../../../../src/webui/lib/api-client.js'

import {TaskEvents} from '../../../../../../src/shared/transport/events/task-events.js'
import {getTasks} from '../../../../../../src/webui/features/tasks/api/get-tasks.js'
import {useTransportStore} from '../../../../../../src/webui/stores/transport-store.js'

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

  it('emits task:list with the projectPath payload', async () => {
    request.resolves({
      availableModels: [],
      availableProviders: [],
      counts: {all: 0, cancelled: 0, completed: 0, failed: 0, running: 0},
      page: 1,
      pageCount: 1,
      pageSize: 50,
      tasks: [],
      total: 0,
    })
    await getTasks({projectPath: '/foo'})
    expect(request.firstCall.args[0]).to.equal(TaskEvents.LIST)
    expect(request.firstCall.args[1]).to.deep.equal({projectPath: '/foo'})
  })

  it('forwards page + pageSize to the daemon', async () => {
    request.resolves({
      availableModels: [],
      availableProviders: [],
      counts: {all: 0, cancelled: 0, completed: 0, failed: 0, running: 0},
      page: 3,
      pageCount: 5,
      pageSize: 50,
      tasks: [],
      total: 250,
    })
    await getTasks({page: 3, pageSize: 50, projectPath: '/foo'})
    expect(request.firstCall.args[1]).to.deep.equal({page: 3, pageSize: 50, projectPath: '/foo'})
  })

  it('forwards all filter dims (status, type, provider, model, time, duration, search)', async () => {
    request.resolves({
      availableModels: [],
      availableProviders: [],
      counts: {all: 0, cancelled: 0, completed: 0, failed: 0, running: 0},
      page: 1,
      pageCount: 1,
      pageSize: 50,
      tasks: [],
      total: 0,
    })
    const payload = {
      createdAfter: 1_700_000_000_000,
      createdBefore: 1_700_000_999_999,
      maxDurationMs: 60_000,
      minDurationMs: 1000,
      model: ['gpt-5-pro'],
      page: 1,
      pageSize: 50,
      projectPath: '/foo',
      provider: ['openai'],
      searchText: 'auth',
      status: ['error' as const],
      type: ['curate'],
    }
    await getTasks(payload)
    expect(request.firstCall.args[1]).to.deep.equal(payload)
  })

  it('throws when not connected to the daemon', async () => {
    useTransportStore.setState({apiClient: null})
    try {
      await getTasks({projectPath: '/foo'})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Not connected')
    }
  })
})
