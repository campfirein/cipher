import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ModelList from '../../../src/oclif/commands/model/list.js'

// ==================== TestableModelListCommand ====================

class TestableModelListCommand extends ModelList {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchModels(providerFlag?: string) {
    return super.fetchModels(providerFlag, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Model List Command', () => {
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

  function createCommand(...argv: string[]): TestableModelListCommand {
    const command = new TestableModelListCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableModelListCommand {
    const command = new TestableModelListCommand(['--format', 'json', ...argv], mockConnector, config)
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

  // ==================== List Models ====================

  describe('list models from all connected providers', () => {
    it('should display models grouped by provider', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({
        providers: [
          {id: 'anthropic', isConnected: true, name: 'Anthropic'},
          {id: 'openai', isConnected: true, name: 'OpenAI'},
        ],
      })
      requestStub.onThirdCall().resolves({
        models: [
          {id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', providerId: 'anthropic'},
          {id: 'gpt-4.1', name: 'GPT-4.1', providerId: 'openai'},
        ],
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('anthropic:'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('openai:'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Claude Sonnet 4.5') && m.includes('[claude-sonnet-4-5]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('GPT-4.1') && m.includes('[gpt-4.1]'))).to.be.true
    })

    it('should mark current model with "(current)"', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({
        providers: [{id: 'anthropic', isConnected: true, name: 'Anthropic'}],
      })
      requestStub.onThirdCall().resolves({
        models: [
          {id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', providerId: 'anthropic'},
          {id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', providerId: 'anthropic'},
        ],
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Claude Sonnet 4.5') && m.includes('(current)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Claude Haiku 3.5') && m.includes('(current)'))).to.be.false
    })

    it('should show empty message when no models available', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({providers: []})
      requestStub.onThirdCall().resolves({models: []})

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('No models available'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv providers connect'))).to.be.true
    })

    it('should show provider errors when model fetch fails', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({
        providers: [{id: 'anthropic', isConnected: true, name: 'Anthropic'}],
      })
      requestStub.onThirdCall().resolves({
        models: [],
        providerErrors: {anthropic: 'API key is invalid or expired.'},
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('anthropic:') && m.includes('API key is invalid or expired'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('No models available'))).to.be.false
    })
  })

  // ==================== --provider Flag ====================

  describe('--provider flag', () => {
    it('should list models for specified provider only', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeModel: 'gpt-4.1', activeProviderId: 'openai'})
      requestStub.onSecondCall().resolves({
        providers: [
          {id: 'anthropic', isConnected: true, name: 'Anthropic'},
          {id: 'openai', isConnected: true, name: 'OpenAI'},
        ],
      })
      requestStub.onThirdCall().resolves({
        models: [{id: 'gpt-4.1', name: 'GPT-4.1', providerId: 'openai'}],
      })

      await createCommand('--provider', 'openai').run()

      expect(loggedMessages.some((m) => m.includes('GPT-4.1'))).to.be.true
    })

    it('should error for unknown provider', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({providers: []})

      await createCommand('--provider', 'unknown').run()

      expect(loggedMessages.some((m) => m.includes('Unknown provider'))).to.be.true
    })

    it('should error for disconnected provider', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({
        providers: [{id: 'openai', isConnected: false, name: 'OpenAI'}],
      })

      await createCommand('--provider', 'openai').run()

      expect(loggedMessages.some((m) => m.includes('is not connected'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON with models data', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({
        providers: [{id: 'anthropic', isConnected: true, name: 'Anthropic'}],
      })
      requestStub.onThirdCall().resolves({
        models: [{id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', providerId: 'anthropic'}],
      })

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model list')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('models')
    })

    it('should output JSON error on connection failure', async () => {
      mockConnector.rejects(new Error('Connection failed'))

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model list')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle connection errors gracefully', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })
  })
})
