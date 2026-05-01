import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {BrvApiClient} from '../../../../../../src/webui/lib/api-client.js'

import {TaskEvents} from '../../../../../../src/shared/transport/events/task-events.js'
import {clearCompleted} from '../../../../../../src/webui/features/tasks/api/clear-completed.js'
import {useTransportStore} from '../../../../../../src/webui/stores/transport-store.js'

describe('clearCompleted', () => {
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

  it('emits task:clearCompleted with the projectPath payload', async () => {
    request.resolves({deletedCount: 5})
    await clearCompleted({projectPath: '/foo/bar'})
    expect(request.firstCall.args[0]).to.equal(TaskEvents.CLEAR_COMPLETED)
    expect(request.firstCall.args[1]).to.deep.equal({projectPath: '/foo/bar'})
  })

  it('emits task:clearCompleted with empty payload when projectPath is omitted', async () => {
    request.resolves({deletedCount: 0})
    await clearCompleted({})
    expect(request.firstCall.args[1]).to.deep.equal({})
  })

  it('resolves with the daemon response on success', async () => {
    request.resolves({deletedCount: 7})
    const result = await clearCompleted({projectPath: '/p'})
    expect(result).to.deep.equal({deletedCount: 7})
  })

  it('throws when the daemon response has error', async () => {
    request.resolves({deletedCount: 0, error: 'project not found'})
    try {
      await clearCompleted({projectPath: '/p'})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('project not found')
    }
  })

  it('throws when not connected to the daemon', async () => {
    useTransportStore.setState({apiClient: null})
    try {
      await clearCompleted({projectPath: '/p'})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Not connected')
    }
  })
})
