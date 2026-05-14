import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {BrvApiClient} from '../../../../../../src/webui/lib/api-client.js'

import {TaskEvents} from '../../../../../../src/shared/transport/events/task-events.js'
import {getTask} from '../../../../../../src/webui/features/tasks/api/get-task.js'
import {useTransportStore} from '../../../../../../src/webui/stores/transport-store.js'

describe('getTask', () => {
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

  it('emits task:get with the taskId payload', async () => {
    request.resolves({task: null})
    await getTask('tsk-1')
    expect(request.firstCall.args[0]).to.equal(TaskEvents.GET)
    expect(request.firstCall.args[1]).to.deep.equal({taskId: 'tsk-1'})
  })

  it('resolves with the daemon response when the task exists', async () => {
    const fakeEntry = {status: 'completed', taskId: 'tsk-1'}
    request.resolves({task: fakeEntry})
    const result = await getTask('tsk-1')
    expect(result.task).to.equal(fakeEntry)
  })

  it('resolves with {task: null} when the task does not exist', async () => {
    request.resolves({task: null})
    const result = await getTask('tsk-missing')
    expect(result.task).to.equal(null)
  })

  it('throws when not connected to the daemon', async () => {
    useTransportStore.setState({apiClient: null})
    try {
      await getTask('tsk-1')
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as Error).message).to.equal('Not connected')
    }
  })
})
