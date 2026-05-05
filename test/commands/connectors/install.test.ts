import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ConnectorsInstall from '../../../src/oclif/commands/connectors/install.js'
import {CLAUDE_DESKTOP} from '../../../src/shared/types/agent.js'

// ==================== TestableConnectorsInstallCommand ====================

class TestableConnectorsInstallCommand extends ConnectorsInstall {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async installConnector(params: {agentId: string; connectorType?: string}) {
    return super.installConnector(params, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Helpers ====================

const MOCK_AGENTS = [
  {
    defaultConnectorType: 'skill',
    id: 'Claude Code',
    name: 'Claude Code',
    supportedConnectorTypes: ['rules', 'hook', 'mcp', 'skill'],
  },
  {defaultConnectorType: 'mcp', id: 'Claude Desktop', name: 'Claude Desktop', supportedConnectorTypes: ['mcp']},
  {defaultConnectorType: 'skill', id: 'Cursor', name: 'Cursor', supportedConnectorTypes: ['rules', 'mcp', 'skill']},
  {defaultConnectorType: 'rules', id: 'Windsurf', name: 'Windsurf', supportedConnectorTypes: ['rules', 'mcp']},
]

const MOCK_CONNECTORS = [
  {
    agent: 'Claude Code',
    connectorType: 'hook',
    defaultType: 'skill',
    supportedTypes: ['rules', 'hook', 'mcp', 'skill'],
  },
  {agent: 'Windsurf', connectorType: 'rules', defaultType: 'rules', supportedTypes: ['rules', 'mcp']},
]

// ==================== Tests ====================

describe('Connectors Install Command', () => {
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

  function createCommand(...argv: string[]): TestableConnectorsInstallCommand {
    const command = new TestableConnectorsInstallCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableConnectorsInstallCommand {
    const command = new TestableConnectorsInstallCommand(['--format', 'json', ...argv], mockConnector, config)
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

  // ==================== Successful Install ====================

  describe('successful install', () => {
    it('should install with default connector type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub
        .onThirdCall()
        .resolves({configPath: '/test/.brv/connectors/claude-code', message: 'Installed', success: true})

      await createCommand('Claude Code').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code connected via Agent Skill'))).to.be.true
    })

    it('should install with explicit --type flag', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub
        .onThirdCall()
        .resolves({configPath: '/test/.brv/connectors/claude-code', message: 'Installed', success: true})

      await createCommand('Claude Code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code connected via MCP'))).to.be.true
    })

    it('should show restart warning for types that require restart', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub
        .onThirdCall()
        .resolves({configPath: '/test/.brv/connectors/claude-code', message: 'Installed', success: true})

      await createCommand('Claude Code', '--type', 'hook').run()

      expect(loggedMessages.some((m) => m.includes('Please restart Claude Code'))).to.be.true
    })

    it('should show quit hint for Claude Desktop instead of generic restart', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub
        .onThirdCall()
        .resolves({configPath: '/test/claude-desktop-config.json', message: 'Installed', success: true})

      await createCommand('Claude Desktop').run()

      expect(loggedMessages.some((m) => m.includes(`Quit ${CLAUDE_DESKTOP} from the system tray`))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Please restart'))).to.be.false
    })

    it('should not show restart warning for rules type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub
        .onThirdCall()
        .resolves({configPath: '/test/.brv/connectors/windsurf', message: 'Installed', success: true})

      await createCommand('Windsurf', '--type', 'rules').run()

      expect(loggedMessages.some((m) => m.includes('Windsurf connected via Rules'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('restart'))).to.be.false
    })

    it('should match agent name case-insensitively', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub
        .onThirdCall()
        .resolves({configPath: '/test/.brv/connectors/cursor', message: 'Installed', success: true})

      await createCommand('cursor').run()

      expect(loggedMessages.some((m) => m.includes('Cursor connected via Agent Skill'))).to.be.true
    })

    it('should send correct install event payload', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({configPath: '/test/path', message: 'Installed', success: true})

      await createCommand('Claude Code', '--type', 'mcp').run()

      const [event, payload] = requestStub.thirdCall.args
      expect(event).to.equal('connectors:install')
      expect(payload).to.deep.equal({agentId: 'Claude Code', connectorType: 'mcp'})
    })
  })

  // ==================== Switch (Already Connected) ====================

  describe('switch connector type', () => {
    it('should switch when already connected with different type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onThirdCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code switched from Hook to MCP'))).to.be.true
    })

    it('should show restart warning when switching to type that requires restart', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onThirdCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Please restart Claude Code'))).to.be.true
    })

    it('should not show restart warning when switching to rules', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})
      requestStub.onThirdCall().resolves({configPath: '/test/path', message: 'Switched', success: true})

      await createCommand('Claude Code', '--type', 'rules').run()

      expect(loggedMessages.some((m) => m.includes('Claude Code switched from Hook to Rules'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('restart'))).to.be.false
    })

    it('should show already using message when same type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})

      await createCommand('Claude Code', '--type', 'hook').run()

      expect(loggedMessages.some((m) => m.includes('"Claude Code" is already using Hook'))).to.be.true
    })

    it('should not call install when same type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})

      await createCommand('Claude Code', '--type', 'hook').run()

      expect(requestStub.calledTwice).to.be.true
    })

    it('should show already using message when no --type flag and already connected', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})

      await createCommand('Claude Code').run()

      expect(loggedMessages.some((m) => m.includes('"Claude Code" is already using Hook'))).to.be.true
    })
  })

  // ==================== Manual MCP Setup ====================

  describe('manual MCP setup', () => {
    it('should display manual instructions when requiresManualSetup is true', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({
        manualInstructions: {
          configContent:
            '{\n  "mcpServers": {\n    "brv": {\n      "command": "brv",\n      "args": ["mcp"]\n    }\n  }\n}',
          guide: 'https://docs.example.com/mcp-setup',
        },
        message: 'Manual setup required',
        requiresManualSetup: true,
        success: true,
      })

      await createCommand('Windsurf', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Manual setup required for Windsurf'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Add this configuration to your MCP settings'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('"mcpServers"'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('https://docs.example.com/mcp-setup'))).to.be.true
    })

    it('should not show restart warning when manual setup is required', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({
        manualInstructions: {
          configContent: '{"mcpServers": {}}',
          guide: 'https://docs.example.com',
        },
        message: 'Manual setup required',
        requiresManualSetup: true,
        success: true,
      })

      await createCommand('Windsurf', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('restart'))).to.be.false
    })

    it('should display manual instructions without guide when guide is empty', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({
        manualInstructions: {
          configContent: '{"mcpServers": {}}',
          guide: '',
        },
        message: 'Manual setup required',
        requiresManualSetup: true,
        success: true,
      })

      await createCommand('Windsurf', '--type', 'mcp').run()

      expect(loggedMessages.some((m) => m.includes('Manual setup required for Windsurf'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('detailed instructions'))).to.be.false
    })

    it('should include manual instructions in JSON output', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({
        manualInstructions: {
          configContent: '{"mcpServers": {}}',
          guide: 'https://docs.example.com/mcp-setup',
        },
        message: 'Manual setup required',
        requiresManualSetup: true,
        success: true,
      })

      await createJsonCommand('Windsurf', '--type', 'mcp').run()

      const json = parseJsonOutput()
      expect(json.success).to.be.true
      expect(json.data).to.have.property('requiresManualSetup', true)
      expect(json.data).to.have.property('manualInstructions').that.deep.equals({
        configContent: '{"mcpServers": {}}',
        guide: 'https://docs.example.com/mcp-setup',
      })
    })
  })

  // ==================== Error Cases ====================

  describe('error cases', () => {
    it('should error for unknown agent', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({agents: MOCK_AGENTS})

      await createCommand('Unknown Agent').run()

      expect(loggedMessages.some((m) => m.includes('Unknown agent "Unknown Agent"'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv connectors install --help'))).to.be.true
    })

    it('should error for unsupported connector type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})

      await createCommand('Windsurf', '--type', 'skill').run()

      expect(loggedMessages.some((m) => m.includes('"Windsurf" does not support'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Supported types:'))).to.be.true
    })

    it('should error when server returns install failure', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({message: 'Failed to write config file', success: false})

      await createCommand('Claude Code').run()

      expect(loggedMessages.some((m) => m.includes('Failed to write config file'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on successful install', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: []})
      requestStub.onThirdCall().resolves({configPath: '/test/path', message: 'Installed', success: true})

      await createJsonCommand('Claude Code', '--type', 'mcp').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors install')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('agentId', 'Claude Code')
      expect(json.data).to.have.property('connectorType', 'mcp')
      expect(json.data).to.have.property('configPath', '/test/path')
    })

    it('should output JSON with message when same type', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.onFirstCall().resolves({agents: MOCK_AGENTS})
      requestStub.onSecondCall().resolves({connectors: MOCK_CONNECTORS})

      await createJsonCommand('Claude Code', '--type', 'hook').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors install')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('message', 'Already using this connector type')
    })

    it('should output JSON on error', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({agents: MOCK_AGENTS})

      await createJsonCommand('Unknown Agent').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('connectors install')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error').that.includes('Unknown agent')
    })
  })
})
