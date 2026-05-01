import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {BrvApiClient} from '../../../../../../src/webui/lib/api-client.js'

import {TaskEvents} from '../../../../../../src/shared/transport/events/task-events.js'
import {deleteTask} from '../../../../../../src/webui/features/tasks/api/delete-task.js'
import {useTransportStore} from '../../../../../../src/webui/stores/transport-store.js'

describe('deleteTask', () => {
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

  it('emits task:delete with the taskId payload', async () => {
    request.resolves({removed: true, success: true})
    await deleteTask({taskId: 'tsk-1'})
    expect(request.firstCall.args[0]).to.equal(TaskEvents.DELETE)
    expect(request.firstCall.args[1]).to.deep.equal({taskId: 'tsk-1'})
  })

  it('resolves with the daemon response on success', async () => {
    request.resolves({removed: true, success: true})
    const result = await deleteTask({taskId: 'tsk-1'})
    expect(result).to.deep.equal({removed: true, success: true})
  })

  it('throws when the daemon returns success: false', async () => {
    request.resolves({error: 'cannot delete running task; cancel it first', success: false})
    try {
      await deleteTask({taskId: 'tsk-1'})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('cannot delete running task; cancel it first')
    }
  })

  it('falls back to "Delete failed" when success: false has no error string', async () => {
    request.resolves({success: false})
    try {
      await deleteTask({taskId: 'tsk-1'})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Delete failed')
    }
  })

  it('throws when not connected to the daemon', async () => {
    useTransportStore.setState({apiClient: null})
    try {
      await deleteTask({taskId: 'tsk-1'})
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Not connected')
    }
  })
})
