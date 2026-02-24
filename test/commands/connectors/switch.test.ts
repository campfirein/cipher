import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ConnectorsSwitch from '../../../src/oclif/commands/connectors/switch.js'

// ==================== TestableConnectorsSwitchCommand ====================

class TestableConnectorsSwitchCommand extends ConnectorsSwitch {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async switchConnector(params: {agentId: string; connectorType: string}) {
    return super.switchConnector(params, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Helpers ====================

const MOCK_CONNECTORS = [
  {agent: 'Claude Code', connectorType: 'hook', defaultType: 'skill', supportedTypes: ['rules', 'hook', 'mcp', 'skill']},
  {agent: 'Windsurf', connectorType: 'rules', defaultType: 'rules', supportedTypes: ['rules', 'mcp']},
]

// ==================== Tests ====================

describe('Connectors Switch Command', () => {
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

  function createCommand(...argv: string[]): TestableConnectorsSwitchCommand {
    const command = new TestableConnectorsSwitchCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableConnectorsSwitchCommand {
    const command = new TestableConnectorsSwitchCommand(['--format', 'json', ...argv], mockConnector, config)
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

  // ==================== Successful Switch ====================

  describe('successful switch', () => {
    it('should switch connector type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code switched from Hook to MCP'))).to.be.true
    })

    it('should show restart warning for types that require restart', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Please restart Claude Code'))).to.be.true
    })

    it('should not show restart warning when switching to rules', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'rules').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code switched from Hook to Rules'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('restart'))).to.be.false
    })

    it('should match agent name case-insensitively', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('claude code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code switched from Hook to MCP'))).to.be.true
    })

    it('should send correct install event payload', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'rules').run()

      const [event, payload] = requestStub.secondCall.args
      expect(event).to.equal('connectors:install')
      expect(payload).to.deep.equal({agentId: 'Claude Code', connectorType: 'rules'})
    })
  })

  // ==================== Same Type ====================

  describe('same type selected', () => {
    it('should show already using message when same type', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({connectors: MOCK_CONNECTORS})

      await createCommand('Claude Code', '--type', 'hook').run()

      expect(loggedMessages.some((m) => m.includes('"Claude Code" is already using Hook'))).to.be.true
    })

    it('should not call install when same type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.resolves({connectors: MOCK_CONNECTORS})

      await createCommand('Claude Code', '--type', 'hook').run()

      expect(requestStub.calledOnce).to.be.true
      expect(requestStub.firstCall.args[0]).to.equal('connectors:list')
    })
  })

  // ==================== Error Cases ====================

  describe('error cases', () => {
    it('should error when agent is not connected', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({connectors: []})

      await createCommand('Cursor', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('"Cursor" is not connected'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv connectors install'))).to.be.true
    })

    it('should error for unsupported connector type', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({connectors: MOCK_CONNECTORS})

      await createCommand('Windsurf', '--type', 'skill').run()

      expect(loggedMessages.some((m) => m.includes('"Windsurf" does not support'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Supported types:'))).to.be.true
    })

    it('should error when server returns install failure', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({message: 'Permission denied', success: false})

      await createCommand('Claude Code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Permission denied'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on successful switch', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onSecondCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createJsonCommand('Claude Code', '--type', 'mcp').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors switch')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('agentId', 'Claude Code')
      expect(json.data).to.have.property('connectorType', 'mcp')
    })

    it('should output JSON with message when same type', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({connectors: MOCK_CONNECTORS})

      await createJsonCommand('Claude Code', '--type', 'hook').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors switch')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('message', 'Already using this connector type')
    })

    it('should output JSON on error', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({connectors: []})

      await createJsonCommand('Cursor', '--type', 'mcp').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors switch')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error').that.includes('not connected')
    })
  })

})
