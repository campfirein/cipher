import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {DaemonClientOptions} from '../../../src/oclif/lib/daemon-client.js'
import type {GlobalConfigSetAnalyticsResponse} from '../../../src/shared/transport/events/global-config-events.js'

import Enable from '../../../src/oclif/commands/analytics/enable.js'
import {GlobalConfigEvents} from '../../../src/shared/transport/events/global-config-events.js'

class TestableEnableCommand extends Enable {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(mockConnector: () => Promise<ConnectionResult>, config: Config, argv: string[] = []) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async setAnalytics(
    analytics: boolean,
    options?: DaemonClientOptions,
  ): Promise<GlobalConfigSetAnalyticsResponse> {
    return super.setAnalytics(analytics, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
      ...options,
    })
  }
}

describe('analytics enable command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []

    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getDaemonVersion: stub(),
      getState: stub().returns('connected'),
      isConnected: stub().resolves(true),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().returns(() => {}),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves({current: true, previous: false}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(argv: string[] = []): TestableEnableCommand {
    const command = new TestableEnableCommand(mockConnector, config, argv)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function mockSetAnalyticsResponse(response: GlobalConfigSetAnalyticsResponse): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves(response)
  }

  describe('toggle from disabled to enabled', () => {
    it('should print "Analytics enabled" when previous was false', async () => {
      mockSetAnalyticsResponse({current: true, previous: false})

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Analytics enabled'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('already'))).to.be.false
    })
  })

  describe('idempotent (already enabled)', () => {
    it('should print "Analytics already enabled" when previous equals current', async () => {
      mockSetAnalyticsResponse({current: true, previous: true})

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Analytics already enabled'))).to.be.true
    })
  })

  describe('connection error', () => {
    it('should print formatted connection error when daemon unavailable', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })
  })

  describe('transport contract', () => {
    it('should issue exactly one SET_ANALYTICS request with {analytics: true}', async () => {
      mockSetAnalyticsResponse({current: true, previous: false})

      await createCommand().run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      expect(requestStub.callCount).to.equal(1)
      expect(requestStub.firstCall.args[0]).to.equal(GlobalConfigEvents.SET_ANALYTICS)
      expect(requestStub.firstCall.args[1]).to.deep.equal({analytics: true})
    })
  })

  describe('help text', () => {
    it('should declare a description string', () => {
      expect(Enable.description).to.be.a('string').and.not.be.empty
    })
  })
})
