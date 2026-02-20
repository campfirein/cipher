import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ProviderConnect from '../../../src/oclif/commands/provider/connect.js'

// ==================== TestableProviderConnectCommand ====================

class TestableProviderConnectCommand extends ProviderConnect {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async connectProvider(params: {apiKey?: string; model?: string; providerId: string}) {
    return super.connectProvider(params, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Provider Connect Command', () => {
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

  function createCommand(...argv: string[]): TestableProviderConnectCommand {
    const command = new TestableProviderConnectCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableProviderConnectCommand {
    const command = new TestableProviderConnectCommand(['--json', ...argv], mockConnector, config)
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

  // ==================== Successful Connect ====================

  describe('successful connect', () => {
    it('should connect provider without API key', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'byterover', isConnected: false, name: 'ByteRover', requiresApiKey: false}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('byterover').run()

      expect(loggedMessages.some((m) => m.includes('Connected to ByteRover (byterover)'))).to.be.true
    })

    it('should connect provider with valid API key', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: false, name: 'Anthropic', requiresApiKey: true}],
      })
      requestStub.onSecondCall().resolves({isValid: true})
      requestStub.onThirdCall().resolves({success: true})

      await createCommand('anthropic', '--api-key', 'sk-valid').run()

      expect(loggedMessages.some((m) => m.includes('Connected to Anthropic (anthropic)'))).to.be.true
    })

    it('should connect and set model when --model is provided', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: false, name: 'Anthropic', requiresApiKey: true}],
      })
      requestStub.onSecondCall().resolves({isValid: true})
      requestStub.onThirdCall().resolves({success: true})
      requestStub.resolves({success: true})

      await createCommand('anthropic', '--api-key', 'sk-valid', '--model', 'claude-sonnet-4-5').run()

      expect(loggedMessages.some((m) => m.includes('Connected to Anthropic'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Model set to: claude-sonnet-4-5'))).to.be.true
    })

    it('should re-connect already connected provider without API key', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: true, name: 'Anthropic', requiresApiKey: true}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('anthropic').run()

      expect(loggedMessages.some((m) => m.includes('Connected to Anthropic (anthropic)'))).to.be.true
    })
  })

  // ==================== Error Cases ====================

  describe('error cases', () => {
    it('should error for unknown provider', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createCommand('unknown-provider').run()

      expect(loggedMessages.some((m) => m.includes('Unknown provider'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv provider list'))).to.be.true
    })

    it('should error when API key is required but not provided', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        providers: [{id: 'openai', isConnected: false, name: 'OpenAI', requiresApiKey: true}],
      })

      await createCommand('openai').run()

      expect(loggedMessages.some((m) => m.includes('requires an API key'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('--api-key'))).to.be.true
    })

    it('should include API key URL in error when available', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        providers: [{apiKeyUrl: 'https://platform.openai.com/api-keys', id: 'openai', isConnected: false, name: 'OpenAI', requiresApiKey: true}],
      })

      await createCommand('openai').run()

      expect(loggedMessages.some((m) => m.includes('https://platform.openai.com/api-keys'))).to.be.true
    })

    it('should error when API key validation fails with message', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: false, name: 'Anthropic', requiresApiKey: true}],
      })
      requestStub.onSecondCall().resolves({error: 'Key expired', isValid: false})

      await createCommand('anthropic', '--api-key', 'sk-invalid').run()

      expect(loggedMessages.some((m) => m.includes('Key expired'))).to.be.true
    })

    it('should show fallback message when API key validation fails without message', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'anthropic', isConnected: false, name: 'Anthropic', requiresApiKey: true}],
      })
      requestStub.onSecondCall().resolves({isValid: false})

      await createCommand('anthropic', '--api-key', 'sk-invalid').run()

      expect(loggedMessages.some((m) => m.includes('API key provided is invalid'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on successful connect', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'byterover', isConnected: false, name: 'ByteRover', requiresApiKey: false}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createJsonCommand('byterover').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('provider connect')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({providerId: 'byterover'})
    })

    it('should output JSON on error', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createJsonCommand('unknown').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('provider connect')
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
