import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {DaemonClientOptions} from '../../../src/oclif/lib/daemon-client.js'

import Status from '../../../src/oclif/commands/analytics/status.js'
import {GlobalConfigEvents} from '../../../src/shared/transport/events/global-config-events.js'

class TestableStatusCommand extends Status {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(mockConnector: () => Promise<ConnectionResult>, config: Config, argv: string[] = []) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchAnalyticsEnabled(options?: DaemonClientOptions): Promise<boolean> {
    return super.fetchAnalyticsEnabled({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
      ...options,
    })
  }
}

describe('analytics status command', () => {
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
      requestWithAck: stub().resolves({analytics: false, deviceId: 'test-device', version: '1.0.0'}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(argv: string[] = []): TestableStatusCommand {
    const command = new TestableStatusCommand(mockConnector, config, argv)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function mockAnalyticsResponse(analytics: boolean): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
      analytics,
      deviceId: 'test-device',
      version: '1.0.0',
    })
  }

  describe('text output', () => {
    it('should print "Analytics: disabled" for a fresh (analytics:false) config', async () => {
      mockAnalyticsResponse(false)

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Analytics: disabled'))).to.be.true
    })

    it('should print "Analytics: enabled" when underlying config has analytics: true', async () => {
      mockAnalyticsResponse(true)

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Analytics: enabled'))).to.be.true
    })
  })

  describe('JSON output', () => {
    it('should emit {"analytics": "disabled"} shape when disabled', async () => {
      mockAnalyticsResponse(false)

      let captured = ''
      const writeStub = stub(process.stdout, 'write').callsFake((chunk) => {
        captured += chunk
        return true
      })

      try {
        await new TestableStatusCommand(mockConnector, config, ['--format', 'json']).run()
      } finally {
        writeStub.restore()
      }

      const parsed = JSON.parse(captured) as {data: {analytics: string}; success: boolean}
      expect(parsed.success).to.be.true
      expect(parsed.data.analytics).to.equal('disabled')
    })

    it('should emit {"analytics": "enabled"} shape when enabled', async () => {
      mockAnalyticsResponse(true)

      let captured = ''
      const writeStub = stub(process.stdout, 'write').callsFake((chunk) => {
        captured += chunk
        return true
      })

      try {
        await new TestableStatusCommand(mockConnector, config, ['--format', 'json']).run()
      } finally {
        writeStub.restore()
      }

      const parsed = JSON.parse(captured) as {data: {analytics: string}; success: boolean}
      expect(parsed.success).to.be.true
      expect(parsed.data.analytics).to.equal('enabled')
    })

    it('should output success: false on connection error', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      let captured = ''
      const writeStub = stub(process.stdout, 'write').callsFake((chunk) => {
        captured += chunk
        return true
      })

      try {
        await new TestableStatusCommand(mockConnector, config, ['--format', 'json']).run()
      } finally {
        writeStub.restore()
      }

      const parsed = JSON.parse(captured) as {success: boolean}
      expect(parsed.success).to.be.false
    })
  })

  describe('transport contract', () => {
    it('should issue exactly one read against GlobalConfigEvents.GET', async () => {
      mockAnalyticsResponse(false)

      await createCommand().run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      expect(requestStub.callCount).to.equal(1)
      expect(requestStub.firstCall.args[0]).to.equal(GlobalConfigEvents.GET)
    })
  })

  describe('help text', () => {
    it('should declare a description string and not throw on construction', () => {
      expect(Status.description).to.be.a('string').and.not.be.empty
    })
  })
})
