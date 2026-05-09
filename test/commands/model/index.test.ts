import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Model from '../../../src/oclif/commands/model/index.js'

// ==================== TestableModelCommand ====================

class TestableModelCommand extends Model {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchActiveModel() {
    return super.fetchActiveModel({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Model Command', () => {
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

  function createCommand(...argv: string[]): TestableModelCommand {
    const command = new TestableModelCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableModelCommand {
    const command = new TestableModelCommand(['--format', 'json', ...argv], mockConnector, config)
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

  function mockResponses(activeResponse: Record<string, unknown>, listResponse: Record<string, unknown>): void {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.onFirstCall().resolves(activeResponse)
    requestStub.onSecondCall().resolves(listResponse)
  }

  // ==================== Active Model ====================

  describe('show active model', () => {
    it('should display model and provider when model is set', async () => {
      mockResponses(
        {activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'},
        {providers: [{id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Model: claude-sonnet-4-5'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Provider: Anthropic (anthropic)'))).to.be.true
    })

    it('should show internal LLM message for byterover provider', async () => {
      mockResponses(
        {activeProviderId: 'byterover'},
        {providers: [{id: 'byterover', isConnected: true, isCurrent: true, name: 'ByteRover'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('internal LLM'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Model:'))).to.be.false
    })

    it('should show "No model set" with suggestions when no model is set', async () => {
      mockResponses(
        {activeProviderId: 'openai'},
        {providers: [{id: 'openai', isConnected: true, isCurrent: true, name: 'OpenAI'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('No model set for OpenAI (openai)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv model list'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv model switch'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON with model info', async () => {
      mockResponses(
        {activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'},
        {providers: [{id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'}]},
      )

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({activeModel: 'claude-sonnet-4-5', providerId: 'anthropic'})
    })

    it('should output JSON error on connection failure', async () => {
      mockConnector.rejects(new Error('Connection failed'))

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('model')
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
