import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {BrvApiClient} from '../../../../../../src/webui/lib/api-client.js'

import {TaskEvents} from '../../../../../../src/shared/transport/events/task-events.js'
import {deleteBulkTasks} from '../../../../../../src/webui/features/tasks/api/delete-bulk-tasks.js'
import {useTransportStore} from '../../../../../../src/webui/stores/transport-store.js'

describe('deleteBulkTasks', () => {
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

  it('emits task:deleteBulk with the taskIds payload', async () => {
    request.resolves({deletedCount: 2})
    await deleteBulkTasks({taskIds: ['tsk-1', 'tsk-2']})
    expect(request.firstCall.args[0]).to.equal(TaskEvents.DELETE_BULK)
    expect(request.firstCall.args[1]).to.deep.equal({taskIds: ['tsk-1', 'tsk-2']})
  })

  it('resolves with the daemon response on success', async () => {
    request.resolves({deletedCount: 3})
    const result = await deleteBulkTasks({taskIds: ['a', 'b', 'c']})
    expect(result).to.deep.equal({deletedCount: 3})
  })

  it('throws when the daemon response has error', async () => {
    request.resolves({deletedCount: 0, error: 'project not found'})
    try {
      await deleteBulkTasks({taskIds: ['tsk-1']})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('project not found')
    }
  })

  it('throws when not connected to the daemon', async () => {
    useTransportStore.setState({apiClient: null})
    try {
      await deleteBulkTasks({taskIds: ['tsk-1']})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Not connected')
    }
  })
})
