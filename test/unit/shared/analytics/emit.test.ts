/* eslint-disable camelcase */
import type {ITransportClient} from '@campfirein/brv-transport-client'

import {expect} from 'chai'
import {stub} from 'sinon'

import {emitAnalytics} from '../../../../src/shared/analytics/emit.js'
import {AnalyticsEvents} from '../../../../src/shared/transport/events/analytics-events.js'

function makeStubClient(overrides: Partial<ITransportClient> = {}): ITransportClient {
  return {
    connect: stub(),
    disconnect: stub(),
    getClientId: stub(),
    getState: stub(),
    isConnected: stub().resolves(true),
    joinRoom: stub(),
    leaveRoom: stub(),
    on: stub().returns(() => {}),
    once: stub(),
    onStateChange: stub().returns(() => {}),
    request: stub(),
    requestWithAck: stub(),
    ...overrides,
  } as unknown as ITransportClient
}

describe('emitAnalytics', () => {
  it('should call client.request with analytics:track and the expected payload', () => {
    const client = makeStubClient()

    emitAnalytics(client, 'cli_invocation', {command_id: 'status'})

    const requestStub = client.request as ReturnType<typeof stub>
    expect(requestStub.calledOnce).to.equal(true)
    expect(requestStub.firstCall.args[0]).to.equal(AnalyticsEvents.TRACK)
    expect(requestStub.firstCall.args[1]).to.deep.equal({event: 'cli_invocation', properties: {command_id: 'status'}})
  })

  it('should send {event, properties: undefined} when no properties given', () => {
    const client = makeStubClient()

    emitAnalytics(client, 'no_props')

    const requestStub = client.request as ReturnType<typeof stub>
    expect(requestStub.calledOnce).to.equal(true)
    expect(requestStub.firstCall.args[1]).to.deep.equal({event: 'no_props', properties: undefined})
  })

  it('should NOT throw when client.request throws (e.g. TransportNotConnectedError)', () => {
    const client = makeStubClient({
      request: stub().throws(new Error('not connected')) as unknown as ITransportClient['request'],
    })

    expect(() => emitAnalytics(client, 'e1')).to.not.throw()
  })

  it('should emit exactly ONE event per call', () => {
    const client = makeStubClient()

    emitAnalytics(client, 'a')
    emitAnalytics(client, 'b')

    const requestStub = client.request as ReturnType<typeof stub>
    expect(requestStub.callCount).to.equal(2)
  })
})
