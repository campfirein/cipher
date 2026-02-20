import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ModelSet from '../../../src/oclif/commands/model/set.js'

// ==================== TestableModelSetCommand ====================

class TestableModelSetCommand extends ModelSet {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async setActiveModel(params: {modelId: string; providerFlag?: string}) {
    return super.setActiveModel(params, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Model Set Command', () => {
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

  function createCommand(...argv: string[]): TestableModelSetCommand {
    const command = new TestableModelSetCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableModelSetCommand {
    const command = new TestableModelSetCommand(['--json', ...argv], mockConnector, config)
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

  // ==================== Successful Set ====================

  describe('successful set', () => {
    it('should set model using active provider', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('claude-sonnet-4-5').run()

      expect(loggedMessages.some((m) => m.includes('Model set to: claude-sonnet-4-5') && m.includes('anthropic'))).to.be.true
    })

    it('should set model with explicit --provider flag', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({
        providers: [{id: 'openai', isConnected: true, name: 'OpenAI'}],
      })
      requestStub.onSecondCall().resolves({success: true})

      await createCommand('gpt-4.1', '--provider', 'openai').run()

      expect(loggedMessages.some((m) => m.includes('Model set to: gpt-4.1') && m.includes('openai'))).to.be.true
    })
  })

  // ==================== Error Cases ====================

  describe('error cases', () => {
    it('should error for unknown provider', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createCommand('gpt-4.1', '--provider', 'unknown').run()

      expect(loggedMessages.some((m) => m.includes('Unknown provider'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv provider list'))).to.be.true
    })

    it('should error for disconnected provider', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        providers: [{id: 'openai', isConnected: false, name: 'OpenAI'}],
      })

      await createCommand('gpt-4.1', '--provider', 'openai').run()

      expect(loggedMessages.some((m) => m.includes('is not connected'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv provider connect openai'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on successful set', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({activeProviderId: 'anthropic'})
      requestStub.onSecondCall().resolves({success: true})

      await createJsonCommand('claude-sonnet-4-5').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model set')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({modelId: 'claude-sonnet-4-5', providerId: 'anthropic'})
    })

    it('should output JSON on error', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers: []})

      await createJsonCommand('gpt-4.1', '--provider', 'unknown').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model set')
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
