import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Provider from '../../../src/oclif/commands/providers/index.js'

// ==================== TestableProviderCommand ====================

class TestableProviderCommand extends Provider {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchActiveProvider() {
    return super.fetchActiveProvider({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Provider Command', () => {
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

  function createCommand(...argv: string[]): TestableProviderCommand {
    const command = new TestableProviderCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableProviderCommand {
    const command = new TestableProviderCommand(['--format', 'json', ...argv], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  async function runJsonCommand(command: TestableProviderCommand): Promise<void> {
    const stdoutStub = stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    try {
      await command.run()
    } finally {
      stdoutStub.restore()
    }
  }

  function parseJsonOutput(): {command: string; data: Record<string, unknown>; success: boolean} {
    const output = stdoutOutput.join('')
    return JSON.parse(output.trim())
  }

  function mockProviderResponses(
    activeResponse: Record<string, unknown>,
    listResponse: Record<string, unknown>,
  ): void {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.onFirstCall().resolves(activeResponse)
    requestStub.onSecondCall().resolves(listResponse)
  }

  // ==================== Active Provider ====================

  describe('show active provider', () => {
    it('should display provider name and model', async () => {
      mockProviderResponses(
        {activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'},
        {providers: [{id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Anthropic (anthropic)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('claude-sonnet-4-5'))).to.be.true
    })

    it('should not show model line for byterover provider', async () => {
      mockProviderResponses(
        {activeProviderId: 'byterover'},
        {providers: [{id: 'byterover', isConnected: true, isCurrent: true, name: 'ByteRover'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('ByteRover (byterover)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Model:'))).to.be.false
    })

    it('should show "Not set" with suggestions when no model is set', async () => {
      mockProviderResponses(
        {activeProviderId: 'openai'},
        {providers: [{id: 'openai', isConnected: true, isCurrent: true, name: 'OpenAI'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Not set'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv model list'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON with provider info', async () => {
      mockProviderResponses(
        {activeModel: 'claude-sonnet-4-5', activeProviderId: 'anthropic'},
        {providers: [{id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'}]},
      )

      await runJsonCommand(createJsonCommand())

      const json = parseJsonOutput()
      expect(json.command).to.equal('providers')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({activeModel: 'claude-sonnet-4-5', providerId: 'anthropic'})
    })

    it('should output JSON error on connection failure', async () => {
      mockConnector.rejects(new Error('Connection failed'))

      await runJsonCommand(createJsonCommand())

      const json = parseJsonOutput()
      expect(json.command).to.equal('providers')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })
  })

  // ==================== ByteRover Auth Warning ====================

  describe('ByteRover auth warning', () => {
    it('should show warning when byterover is active and user is unauthenticated', async () => {
      mockProviderResponses(
        {activeProviderId: 'byterover', loginRequired: true},
        {providers: [{id: 'byterover', isConnected: true, isCurrent: true, name: 'ByteRover'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Warning'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv login'))).to.be.true
    })

    it('should include warning in JSON output when unauthenticated', async () => {
      mockProviderResponses(
        {activeProviderId: 'byterover', loginRequired: true},
        {providers: [{id: 'byterover', isConnected: true, isCurrent: true, name: 'ByteRover'}]},
      )

      await runJsonCommand(createJsonCommand())

      const json = parseJsonOutput()
      expect(json.success).to.be.true
      expect(json.data).to.have.property('warning')
      expect(json.data).to.not.have.property('loginRequired')
    })

    it('should not show warning when byterover is active and user is authenticated', async () => {
      mockProviderResponses(
        {activeProviderId: 'byterover'},
        {providers: [{id: 'byterover', isConnected: true, isCurrent: true, name: 'ByteRover'}]},
      )

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Warning'))).to.be.false
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
