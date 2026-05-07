import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import SpaceList from '../../../src/oclif/commands/space/list.js'
import {SpaceEvents} from '../../../src/shared/transport/events/space-events.js'
import {StatusEvents} from '../../../src/shared/transport/events/status-events.js'

// ==================== TestableSpaceListCommand ====================

class TestableSpaceListCommand extends SpaceList {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async checkDeprecation() {
    return super.checkDeprecation({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Space List Command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>
  let stdoutOutput: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []

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
      requestWithAck: stub().resolves({}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })

    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(argv: string[] = []): TestableSpaceListCommand {
    const command = new TestableSpaceListCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  // ==================== Deprecation — Not on VC ====================

  describe('not on vc', () => {
    beforeEach(() => {
      ;(mockClient.requestWithAck as sinon.SinonStub)
        .withArgs(StatusEvents.GET)
        .resolves({status: {authStatus: 'unknown', contextTreeStatus: 'no_changes', currentDirectory: '/test'}})
    })

    it('should print deprecation message with migration guidance', async () => {
      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('deprecated'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('migration'))).to.be.true
    })

    it('should not call SpaceEvents.LIST', async () => {
      await createCommand().run()

      expect((mockClient.requestWithAck as sinon.SinonStub).calledWith(SpaceEvents.LIST)).to.be.false
    })
  })

  // ==================== Deprecation — On VC ====================

  describe('on vc', () => {
    beforeEach(() => {
      ;(mockClient.requestWithAck as sinon.SinonStub)
        .withArgs(StatusEvents.GET)
        .resolves({status: {authStatus: 'logged_in', contextTreeStatus: 'git_vc', currentDirectory: '/test'}})
    })

    it('should print deprecation message without migration guidance', async () => {
      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('deprecated'))).to.be.true
      expect(loggedMessages.every((m) => !m.includes('migration'))).to.be.true
    })

    it('should not call SpaceEvents.LIST', async () => {
      await createCommand().run()

      expect((mockClient.requestWithAck as sinon.SinonStub).calledWith(SpaceEvents.LIST)).to.be.false
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON deprecation message', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub)
        .withArgs(StatusEvents.GET)
        .resolves({status: {authStatus: 'unknown', contextTreeStatus: 'no_changes', currentDirectory: '/test'}})

      await createCommand(['--format', 'json']).run()

      const output = stdoutOutput.join('')
      const parsed = JSON.parse(output)
      expect(parsed.success).to.be.true
      expect(parsed.command).to.equal('space list')
      expect(parsed.data.message).to.include('deprecated')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle NoInstanceRunningError', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })
  })
})
