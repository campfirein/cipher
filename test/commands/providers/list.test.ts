import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ProviderList from '../../../src/oclif/commands/providers/list.js'

// ==================== TestableProviderListCommand ====================

class TestableProviderListCommand extends ProviderList {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchProviders() {
    return super.fetchProviders({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Provider List Command', () => {
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

  function createCommand(...argv: string[]): TestableProviderListCommand {
    const command = new TestableProviderListCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableProviderListCommand {
    const command = new TestableProviderListCommand(['--format', 'json', ...argv], mockConnector, config)
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

  function mockListResponse(providers: Record<string, unknown>[]): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves({providers})
  }

  // ==================== List Providers ====================

  describe('list providers', () => {
    it('should display all providers with their status', async () => {
      mockListResponse([
        {id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'},
        {id: 'openai', isConnected: true, isCurrent: false, name: 'OpenAI'},
        {id: 'groq', isConnected: false, isCurrent: false, name: 'Groq'},
      ])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Anthropic') && m.includes('[anthropic]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('OpenAI') && m.includes('[openai]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Groq') && m.includes('[groq]'))).to.be.true
    })

    it('should show "(current)" for the current provider', async () => {
      mockListResponse([
        {id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'},
      ])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('(current)'))).to.be.true
    })

    it('should show "(connected)" for connected non-active providers', async () => {
      mockListResponse([
        {id: 'openai', isConnected: true, isCurrent: false, name: 'OpenAI'},
      ])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('(connected)'))).to.be.true
    })

    it('should show no status for disconnected providers', async () => {
      mockListResponse([
        {id: 'groq', isConnected: false, isCurrent: false, name: 'Groq'},
      ])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('(current)'))).to.be.false
      expect(loggedMessages.some((m) => m.includes('(connected)'))).to.be.false
      expect(loggedMessages.some((m) => m.includes('Groq') && m.includes('[groq]'))).to.be.true
    })

    it('should print description on a separate indented line', async () => {
      mockListResponse([
        {
          description: 'Claude models by Anthropic',
          id: 'anthropic',
          isConnected: true,
          isCurrent: true,
          name: 'Anthropic',
        },
      ])

      await createCommand().run()

      const headerIndex = loggedMessages.findIndex((m) => m.includes('Anthropic') && m.includes('[anthropic]'))
      expect(headerIndex).to.be.greaterThan(-1)
      const descriptionLine = loggedMessages[headerIndex + 1]
      expect(descriptionLine).to.include('Claude models by Anthropic')
      expect(descriptionLine?.startsWith('    ')).to.be.true
    })

    it('should skip the description line when description is empty', async () => {
      mockListResponse([{description: '', id: 'groq', isConnected: false, isCurrent: false, name: 'Groq'}])

      await createCommand().run()

      const headerIndex = loggedMessages.findIndex((m) => m.includes('Groq'))
      const next = loggedMessages[headerIndex + 1]
      // Next entry must not be an indented empty line
      expect(next === undefined || !next.startsWith('    ')).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON with providers list', async () => {
      mockListResponse([
        {id: 'anthropic', isConnected: true, isCurrent: true, name: 'Anthropic'},
      ])

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('providers list')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('providers')
    })

    it('should output JSON error on connection failure', async () => {
      mockConnector.rejects(new Error('Connection failed'))

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('providers list')
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
