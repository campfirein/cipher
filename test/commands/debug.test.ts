import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon from 'sinon'

import type {DaemonStatus} from '../../src/server/infra/daemon/daemon-discovery.js'

import Debug from '../../src/oclif/commands/debug.js'

// ==================== Helpers ====================

const discoverNotRunning = (): DaemonStatus => ({reason: 'no_instance', running: false})
const discoverRunning = (): DaemonStatus => ({pid: 12_345, port: 37_847, running: true})

/**
 * Testable subclass that overrides discover() and connect()
 * to avoid ES module stubbing issues.
 */
class TestableDebug extends Debug {
  constructor(
    private readonly mockDiscover: () => DaemonStatus,
    private readonly mockConnect: () => Promise<{client: ITransportClient; projectRoot: string}>,
    argv: string[],
    config: Config,
  ) {
    super(argv, config)
  }

  protected connect(): Promise<{client: ITransportClient; projectRoot: string}> {
    return this.mockConnect()
  }

  protected discover(): DaemonStatus {
    return this.mockDiscover()
  }
}

/**
 * Capture log output from the command.
 */
function captureOutput(command: Debug): string[] {
  const lines: string[] = []
  sinon.stub(command, 'log').callsFake((msg?: string) => {
    if (msg !== undefined) lines.push(msg)
  })
  return lines
}

/**
 * Sample daemon state for testing.
 */
function makeDaemonState() {
  return {
    agentPool: {
      entries: [
        {
          childPid: 12_346,
          createdAt: Date.now() - 600_000,
          hasActiveTask: true,
          isIdle: false,
          lastUsedAt: Date.now() - 120_000,
          projectPath: '/Users/foo/project-a',
        },
        {
          childPid: 12_347,
          createdAt: Date.now() - 1_800_000,
          hasActiveTask: false,
          isIdle: true,
          lastUsedAt: Date.now() - 900_000,
          projectPath: '/Users/foo/project-b',
        },
      ],
      maxSize: 5,
      queue: [],
      size: 2,
    },
    clients: [
      {connectedAt: Date.now() - 600_000, id: 'socket-123', projectPath: '/Users/foo/project-a', type: 'tui'},
      {connectedAt: Date.now() - 600_000, id: 'socket-456', projectPath: '/Users/foo/project-a', type: 'agent'},
      {connectedAt: Date.now() - 300_000, id: 'socket-789', type: 'mcp'},
    ],
    daemon: {
      pid: 12_345,
      port: 37_847,
      startedAt: Date.now() - 3_600_000,
      uptime: 3_600_000,
      version: '1.0.0',
    },
    tasks: {
      activeTasks: [
        {
          clientId: 'socket-123',
          createdAt: Date.now() - 30_000,
          projectPath: '/Users/foo/project-a',
          taskId: 'task-abc-123',
          type: 'curate',
        },
      ],
      agentClients: [
        {clientId: 'socket-456', projectPath: '/Users/foo/project-a'},
      ],
    },
    transport: {
      connectedSockets: 3,
      port: 37_847,
      running: true,
    },
  }
}

function makeMockClient(state: ReturnType<typeof makeDaemonState>): ITransportClient {
  return {
    disconnect: sinon.stub().resolves(),
    getClientId: sinon.stub().returns('debug-client'),
    getState: sinon.stub().returns('connected'),
    isConnected: sinon.stub().resolves(true),
    on: sinon.stub().returns(() => {}),
    once: sinon.stub(),
    request: sinon.stub(),
    requestWithAck: sinon.stub().resolves({data: state, success: true}),
  } as unknown as ITransportClient
}

// ==================== Tests ====================

describe('Debug Command', () => {
  let config: Config
  let sandbox: sinon.SinonSandbox

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    sandbox.stub(console, 'log')
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('daemon not running', () => {
    it('should show not-running message in tree format', async () => {
      const connect = sinon.stub().rejects(new Error('should not connect'))

      const cmd = new TestableDebug(discoverNotRunning, connect, [], config)
      const output = captureOutput(cmd)
      await cmd.run()

      expect(output.join('\n')).to.include('not running')
      expect(connect.called).to.be.false
    })

    it('should show JSON output when daemon is not running', async () => {
      const connect = sinon.stub().rejects(new Error('should not connect'))

      const cmd = new TestableDebug(discoverNotRunning, connect, ['--format', 'json'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const json: unknown = JSON.parse(output.join(''))
      expect(json).to.have.property('running', false)
      expect(json).to.have.property('reason', 'no_instance')
    })
  })

  describe('daemon running — tree format', () => {
    it('should render tree with agent pool, tasks, and clients', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = sinon.stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(discoverRunning, connect, [], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const tree = output.join('\n')

      // Root
      expect(tree).to.include('Daemon')
      expect(tree).to.include('PID: 12345')
      expect(tree).to.include('port: 37847')

      // Transport
      expect(tree).to.include('Transport Server')
      expect(tree).to.include('Connected sockets: 3')

      // Agent Pool
      expect(tree).to.include('Agent Pool (2/5)')
      expect(tree).to.include('/Users/foo/project-a')
      expect(tree).to.include('/Users/foo/project-b')
      expect(tree).to.include('PID: 12346')
      expect(tree).to.include('PID: 12347')

      // Active Tasks
      expect(tree).to.include('Active Tasks (1)')
      expect(tree).to.include('task-abc-123')
      expect(tree).to.include('Type: curate')

      // Connected Clients
      expect(tree).to.include('Connected Clients (3)')
      expect(tree).to.include('socket-123')
      expect(tree).to.include('socket-789')
    })

    it('should render empty pool and no tasks', async () => {
      const state = makeDaemonState()
      state.agentPool.entries = []
      state.agentPool.size = 0
      state.tasks.activeTasks = []
      state.clients = []

      const mockClient = makeMockClient(state)
      const connect = sinon.stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(discoverRunning, connect, [], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const tree = output.join('\n')
      expect(tree).to.include('Agent Pool (0/5)')
      expect(tree).to.include('(empty)')
      expect(tree).to.include('Active Tasks (0)')
      expect(tree).to.include('(none)')
    })

    it('should disconnect client after request', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const disconnectStub = mockClient.disconnect as sinon.SinonStub
      const connect = sinon.stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(discoverRunning, connect, [], config)
      captureOutput(cmd)
      await cmd.run()

      expect(disconnectStub.calledOnce).to.be.true
    })
  })

  describe('daemon running — json format', () => {
    it('should output valid JSON with full state', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = sinon.stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(discoverRunning, connect, ['--format', 'json'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const json: unknown = JSON.parse(output.join(''))
      expect(json).to.have.property('daemon')
      expect(json).to.have.property('agentPool')
      expect(json).to.have.property('transport')
      expect(json).to.have.property('tasks')
      expect(json).to.have.property('clients')
    })
  })
})
