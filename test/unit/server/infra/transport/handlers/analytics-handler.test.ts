/* eslint-disable camelcase */
import {expect} from 'chai'
import {stub} from 'sinon'

import type {IAnalyticsClient} from '../../../../../../src/server/core/interfaces/analytics/i-analytics-client.js'

import {AnalyticsBatch} from '../../../../../../src/server/core/domain/analytics/batch.js'
import {AnalyticsHandler} from '../../../../../../src/server/infra/transport/handlers/analytics-handler.js'
import {AnalyticsEvents, type AnalyticsTrackRequest} from '../../../../../../src/shared/transport/events/analytics-events.js'
import {createMockTransportServer} from '../../../../../helpers/mock-factories.js'

type AnalyticsTrackHandler = (data: unknown, clientId: string) => Promise<void>

function makeStubAnalyticsClient(): IAnalyticsClient {
  return {
    flush: stub().resolves(AnalyticsBatch.create([])),
    track: stub(),
  }
}

describe('AnalyticsHandler', () => {
  it('should register a handler for analytics:track on setup()', () => {
    const transport = createMockTransportServer()
    const analyticsClient = makeStubAnalyticsClient()

    new AnalyticsHandler({analyticsClient, transport}).setup()

    expect(transport._handlers.has(AnalyticsEvents.TRACK)).to.equal(true)
  })

  it('should route a valid payload to analyticsClient.track with matching args', async () => {
    const transport = createMockTransportServer()
    const analyticsClient = makeStubAnalyticsClient()
    new AnalyticsHandler({analyticsClient, transport}).setup()

    const handler = transport._handlers.get(AnalyticsEvents.TRACK) as AnalyticsTrackHandler
    const payload: AnalyticsTrackRequest = {event: 'cli_invocation', properties: {command_id: 'status'}}
    await handler(payload, 'client-1')

    const trackStub = analyticsClient.track as ReturnType<typeof stub>
    expect(trackStub.calledOnce).to.equal(true)
    expect(trackStub.firstCall.args[0]).to.equal('cli_invocation')
    expect(trackStub.firstCall.args[1]).to.deep.equal({command_id: 'status'})
  })

  it('should route a payload with no properties', async () => {
    const transport = createMockTransportServer()
    const analyticsClient = makeStubAnalyticsClient()
    new AnalyticsHandler({analyticsClient, transport}).setup()

    const handler = transport._handlers.get(AnalyticsEvents.TRACK) as AnalyticsTrackHandler
    await handler({event: 'no_props'}, 'client-1')

    const trackStub = analyticsClient.track as ReturnType<typeof stub>
    expect(trackStub.calledOnce).to.equal(true)
    expect(trackStub.firstCall.args[0]).to.equal('no_props')
    expect(trackStub.firstCall.args[1]).to.equal(undefined)
  })

  it('should drop invalid payload silently (no throw, no track call)', async () => {
    const transport = createMockTransportServer()
    const analyticsClient = makeStubAnalyticsClient()
    new AnalyticsHandler({analyticsClient, transport}).setup()

    const handler = transport._handlers.get(AnalyticsEvents.TRACK) as AnalyticsTrackHandler

    await handler({event: ''}, 'client-1')
    await handler({properties: {x: 1}}, 'client-1')
    await handler({event: 42}, 'client-1')
    await handler(null, 'client-1')

    const trackStub = analyticsClient.track as ReturnType<typeof stub>
    expect(trackStub.called, 'track must NOT be called for invalid payloads').to.equal(false)
  })

  it('should not throw when analyticsClient.track itself throws', async () => {
    const transport = createMockTransportServer()
    const analyticsClient: IAnalyticsClient = {
      flush: stub().resolves(AnalyticsBatch.create([])),
      track: stub().throws(new Error('boom')),
    }
    new AnalyticsHandler({analyticsClient, transport}).setup()

    const handler = transport._handlers.get(AnalyticsEvents.TRACK) as AnalyticsTrackHandler

    let caught: unknown
    try {
      await handler({event: 'e'}, 'client-1')
    } catch (error) {
      caught = error
    }

    expect(caught, 'handler must NOT propagate track() errors').to.equal(undefined)
  })
})
