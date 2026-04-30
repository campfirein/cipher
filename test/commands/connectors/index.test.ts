import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Connectors from '../../../src/oclif/commands/connectors/index.js'

// ==================== TestableConnectorsCommand ====================

class TestableConnectorsCommand extends Connectors {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchConnectors() {
    return super.fetchConnectors({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Connectors Command', () => {
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
      requestWithAck: stub().resolves({connectors: []}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableConnectorsCommand {
    const command = new TestableConnectorsCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableConnectorsCommand {
    const command = new TestableConnectorsCommand(['--format', 'json', ...argv], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
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

  // ==================== List Connectors ====================

  describe('list connectors', () => {
    it('should show message when no connectors installed', async () => {
      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('No connectors installed.'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv connectors install --help'))).to.be.true
    })

    it('should list installed connectors with type and supported types', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        connectors: [
          {agent: 'Claude Code', connectorType: 'hook', defaultType: 'skill', supportedTypes: ['rules', 'hook', 'mcp', 'skill']},
          {agent: 'Cursor', connectorType: 'rules', defaultType: 'skill', supportedTypes: ['rules', 'mcp', 'skill']},
        ],
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Installed connectors:'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Claude Code') && m.includes('Hook'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Cursor') && m.includes('Rules'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv connectors install --help'))).to.be.true
    })

    it('should always show install help hint', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        connectors: [
          {agent: 'Claude Code', connectorType: 'hook', defaultType: 'skill', supportedTypes: ['rules', 'hook', 'mcp', 'skill']},
        ],
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('brv connectors install --help'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON with empty connectors list', async () => {
      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('connectors').that.is.an('array').with.length(0)
    })

    it('should output JSON with connectors data', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        connectors: [
          {agent: 'Claude Code', connectorType: 'hook', defaultType: 'skill', supportedTypes: ['rules', 'hook', 'mcp', 'skill']},
        ],
      })

      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors')
      expect(json.success).to.be.true
      const connectors = json.data.connectors as Array<Record<string, unknown>>
      expect(connectors).to.have.length(1)
      expect(connectors[0]).to.have.property('agent', 'Claude Code')
      expect(connectors[0]).to.have.property('connectorType', 'hook')
    })
  })

})
