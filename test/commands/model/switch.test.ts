import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ModelSwitch from '../../../src/oclif/commands/model/switch.js'

// ==================== TestableModelSwitchCommand ====================

class TestableModelSwitchCommand extends ModelSwitch {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async switchModel(params: {modelId: string; providerFlag?: string}) {
    return super.switchModel(params, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Model Switch Command', () => {
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

  function createCommand(...argv: string[]): TestableModelSwitchCommand {
    const command = new TestableModelSwitchCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableModelSwitchCommand {
    const command = new TestableModelSwitchCommand(['--format', 'json', ...argv], mockConnector, config)
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

  // ==================== Successful Switch ====================

  describe('successful switch', () => {
    it('should switch model using active provider', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('claude-sonnet-4-5').run()

      expect(loggedMessages.some((m) => m.includes('Model switched to: claude-sonnet-4-5') && m.includes('anthropic'))).to.be.true
    })

    it('should switch model with explicit --provider flag', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'openai', isConnected: true, name: 'OpenAI'}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('gpt-4.1', '--provider', 'openai').run()

      expect(loggedMessages.some((m) => m.includes('Model switched to: gpt-4.1') && m.includes('openai'))).to.be.true
    })
  })

  // ==================== Error Cases ====================

  describe('error cases', () => {
    it('should error for unknown provider', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createCommand('gpt-4.1', '--provider', 'unknown').run()

      expect(loggedMessages.some((m) => m.includes('Unknown provider'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv providers list'))).to.be.true
    })

    it('should error for disconnected provider', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        providers: [{id: 'openai', isConnected: false, name: 'OpenAI'}],
      })

      await createCommand('gpt-4.1', '--provider', 'openai').run()

      expect(loggedMessages.some((m) => m.includes('is not connected'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv providers connect openai'))).to.be.true
    })

    it('should error when active provider is byterover', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({activeProviderId: 'byterover'})

      await createCommand('claude-sonnet-4-5').run()

      expect(loggedMessages.some((m) => m.includes('does not support model switching'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv providers switch'))).to.be.true
    })

    it('should error when --provider flag is byterover', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        providers: [{id: 'byterover', isConnected: true, name: 'ByteRover'}],
      })

      await createCommand('claude-sonnet-4-5', '--provider', 'byterover').run()

      expect(loggedMessages.some((m) => m.includes('does not support model switching'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv providers switch'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on successful switch', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({success: true})

      await createJsonCommand('claude-sonnet-4-5').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model switch')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({modelId: 'claude-sonnet-4-5', providerId: 'anthropic'})
    })

    it('should output JSON on error', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createJsonCommand('gpt-4.1', '--provider', 'unknown').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model switch')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle connection errors gracefully', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand('claude-sonnet-4-5').run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })
  })
})
