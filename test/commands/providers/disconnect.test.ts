import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ProviderDisconnect from '../../../src/oclif/commands/providers/disconnect.js'

// ==================== TestableProviderDisconnectCommand ====================

class TestableProviderDisconnectCommand extends ProviderDisconnect {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async disconnectProvider(providerId: string) {
    return super.disconnectProvider(providerId, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Provider Disconnect Command', () => {
  let config: Config
  let loggedMessages: string[]
  let stdoutOutput: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

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
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableProviderDisconnectCommand {
    const command = new TestableProviderDisconnectCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableProviderDisconnectCommand {
    const command = new TestableProviderDisconnectCommand(['--format', 'json', ...argv], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  function parseJsonOutput(): {command: string; data: Record<string, unknown>; success: boolean} {
    const output = stdoutOutput.join('')
    return JSON.parse(output.trim())
  }

  // ==================== Successful Disconnect ====================

  describe('successful disconnect', () => {
    it('should disconnect a connected provider', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: true, name: 'Anthropic'}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('anthropic').run()

      expect(loggedMessages.some((m) => m.includes('Disconnected provider: anthropic'))).to.be.true
    })
  })

  // ==================== Error Cases ====================

  describe('error cases', () => {
    it('should error for unknown provider', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createCommand('unknown').run()

      expect(loggedMessages.some((m) => m.includes('Unknown provider'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv providers list'))).to.be.true
    })

    it('should error when provider is not connected', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        providers: [{id: 'openai', isConnected: false, name: 'OpenAI'}],
      })

      await createCommand('openai').run()

      expect(loggedMessages.some((m) => m.includes('is not connected'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on successful disconnect', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: true, name: 'Anthropic'}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createJsonCommand('anthropic').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('providers disconnect')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({providerId: 'anthropic'})
    })

    it('should output JSON on error', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createJsonCommand('unknown').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('providers disconnect')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle connection errors gracefully', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand('anthropic').run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })
  })
})
