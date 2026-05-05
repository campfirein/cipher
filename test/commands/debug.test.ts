import type {EnsureDaemonResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub, stub} from 'sinon'

import Debug from '../../src/oclif/commands/debug.js'

// ==================== Helpers ====================

const ensureNotRunning = (): Promise<EnsureDaemonResult> =>
  Promise.resolve({reason: 'timeout' as const, success: false as const})
const ensureRunning = (): Promise<EnsureDaemonResult> =>
  Promise.resolve({info: {pid: 12_345, port: 37_847}, started: false, success: true as const})

/**
 * Testable subclass that overrides ensureDaemon(), connect(), and clearScreen()
 * to avoid ES module stubbing issues and terminal escape codes in tests.
 */
class TestableDebug extends Debug {
  constructor(
    private readonly mockEnsureDaemon: () => Promise<EnsureDaemonResult>,
    private readonly mockConnect: () => Promise<{client: ITransportClient; projectRoot: string}>,
    argv: string[],
    config: Config,
  ) {
    super(argv, config)
  }

  protected clearScreen(): void {
    // no-op in tests
  }

  protected connect(): Promise<{client: ITransportClient; projectRoot: string}> {
    return this.mockConnect()
  }

  protected ensureDaemon(): Promise<EnsureDaemonResult> {
    return this.mockEnsureDaemon()
  }

  protected async killExistingDaemon(): Promise<number | undefined> {
    // no-op in tests — kill logic is not exercised at command level
    return undefined
  }
}

/**
 * Capture log output from the command.
 */
function captureOutput(command: Debug): string[] {
  const lines: string[] = []
  stub(command, 'log').callsFake((msg?: string) => {
    if (msg !== undefined) lines.push(msg)
  })
  return lines
}

/**
 * Sample daemon state for testing.
 */
function makeDaemonState() {
  return {
    agentIdleStatus: [] as Array<{idleMs: number; projectPath: string; remainingMs: number}>,
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
    daemonIdleStatus: undefined,
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
      agentClients: [{clientId: 'socket-456', projectPath: '/Users/foo/project-a'}],
      completedTasks: [] as Array<{completedAt: number; projectPath?: string; taskId: string; type: string}>,
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
    disconnect: stub().resolves(),
    getClientId: stub().returns('debug-client'),
    getDaemonVersion: stub(),
    getState: stub().returns('connected'),
    isConnected: stub().resolves(true),
    on: stub().returns(() => {}),
    once: stub(),
    request: stub(),
    requestWithAck: stub().resolves(state),
  } as unknown as ITransportClient
}

// ==================== Tests ====================

describe('Debug Command', () => {
  let config: Config
  let sandbox: SinonSandbox

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    sandbox = createSandbox()
    sandbox.stub(console, 'log')
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('daemon not running (no --force)', () => {
    it('should show no-daemon message when connect throws NoInstanceRunningError', async () => {
      const {NoInstanceRunningError: NoInstance} = await import('@campfirein/brv-transport-client')
      const ensureSpy = stub().rejects(new Error('should not be called'))
      const connect = stub().rejects(new NoInstance())

      const cmd = new TestableDebug(ensureSpy, connect, ['--once'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      expect(output.join('\n')).to.include('No daemon is running')
      expect(ensureSpy.called).to.be.false
    })
  })

  describe('--force flag', () => {
    it('should call ensureDaemon before connecting when --force is set', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const ensureSpy = stub().resolves({info: {pid: 12_345, port: 37_847}, started: true, success: true})
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureSpy, connect, ['--force', '--once'], config)
      captureOutput(cmd)
      await cmd.run()

      expect(ensureSpy.calledOnce).to.be.true
      expect(connect.calledOnce).to.be.true
    })

    it('should not call ensureDaemon without --force', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const ensureSpy = stub().rejects(new Error('should not be called'))
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureSpy, connect, ['--once'], config)
      captureOutput(cmd)
      await cmd.run()

      expect(ensureSpy.called).to.be.false
      expect(connect.calledOnce).to.be.true
    })

    it('should show failure message when --force daemon start fails', async () => {
      const connect = stub().rejects(new Error('should not connect'))

      const cmd = new TestableDebug(ensureNotRunning, connect, ['--force', '--once'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      expect(output.join('\n')).to.include('failed to start')
      expect(connect.called).to.be.false
    })

    it('should show JSON failure when --force daemon start fails with json format', async () => {
      const connect = stub().rejects(new Error('should not connect'))

      const cmd = new TestableDebug(ensureNotRunning, connect, ['--force', '--format', 'json'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const json: unknown = JSON.parse(output.join(''))
      expect(json).to.have.property('running', false)
      expect(json).to.have.property('reason', 'timeout')
    })
  })

  describe('daemon running — one-shot tree format', () => {
    it('should render tree with agent pool, tasks, and clients', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
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

    it('should render storage paths section', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const tree = output.join('\n')
      expect(tree).to.include('Storage Paths')
      expect(tree).to.include('Data:')
      expect(tree).to.include('Projects:')
      expect(tree).to.include('Logs:')
      expect(tree).to.include('Overrides:')
    })

    it('should wrap storage paths in OSC 8 hyperlinks when stdout is TTY', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const originalIsTTY = process.stdout.isTTY
      try {
        Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: true})

        const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
        const output = captureOutput(cmd)
        await cmd.run()

        const tree = output.join('\n')
        expect(tree).to.include('\u001B]8;;file://')
        expect(tree).to.include('\u001B]8;;\u001B\\')
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: originalIsTTY})
      }
    })

    it('should show plain paths without OSC 8 escape sequences when stdout is not TTY', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const originalIsTTY = process.stdout.isTTY
      try {
        Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: false})

        const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
        const output = captureOutput(cmd)
        await cmd.run()

        const tree = output.join('\n')
        expect(tree).to.include('Storage Paths')
        expect(tree).to.include('Data:')
        expect(tree).to.not.include('\u001B]8;;')
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: originalIsTTY})
      }
    })

    it('should render empty pool and no tasks', async () => {
      const state = makeDaemonState()
      state.agentPool.entries = []
      state.agentPool.size = 0
      state.tasks.activeTasks = []
      state.clients = []

      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const tree = output.join('\n')
      expect(tree).to.include('Agent Pool (0/5)')
      expect(tree).to.include('(empty)')
      expect(tree).to.include('Active Tasks (0)')
      expect(tree).to.include('(none)')
    })

    it('should render recently completed tasks', async () => {
      const state = makeDaemonState()
      state.tasks.activeTasks = []
      state.tasks.completedTasks = [
        {
          completedAt: Date.now() - 2000,
          projectPath: '/Users/foo/project-a',
          taskId: 'task-done-456',
          type: 'query',
        },
      ]

      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const tree = output.join('\n')
      expect(tree).to.include('Recently Completed (1)')
      expect(tree).to.include('task-done-456')
      expect(tree).to.include('Type: query')
    })

    it('should disconnect client after request', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const disconnectStub = mockClient.disconnect as SinonStub
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
      captureOutput(cmd)
      await cmd.run()

      expect(disconnectStub.calledOnce).to.be.true
    })
  })

  describe('daemon running — json format (always one-shot)', () => {
    it('should output valid JSON with full state', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--format', 'json'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const json: unknown = JSON.parse(output.join(''))
      expect(json).to.have.property('daemon')
      expect(json).to.have.property('agentPool')
      expect(json).to.have.property('transport')
      expect(json).to.have.property('tasks')
      expect(json).to.have.property('clients')
    })

    it('should include paths in JSON output', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const cmd = new TestableDebug(ensureRunning, connect, ['--format', 'json'], config)
      const output = captureOutput(cmd)
      await cmd.run()

      const json = JSON.parse(output.join('')) as Record<string, unknown>
      expect(json).to.have.property('paths')

      const paths = json.paths as Record<string, unknown>
      expect(paths).to.have.property('data').that.is.a('string')
      expect(paths).to.have.property('projects').that.is.a('string')
      expect(paths).to.have.property('logs').that.is.a('string')
      expect(paths).to.have.property('overrides').that.is.an('array')
      expect(paths).to.have.property('existence').that.is.an('object')
    })
  })

  describe('storage paths overrides', () => {
    it('should show BRV_DATA_DIR override when set', async () => {
      const state = makeDaemonState()
      const mockClient = makeMockClient(state)
      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      const original = process.env.BRV_DATA_DIR
      process.env.BRV_DATA_DIR = '/custom/data/path'

      try {
        const cmd = new TestableDebug(ensureRunning, connect, ['--once'], config)
        const output = captureOutput(cmd)
        await cmd.run()

        const tree = output.join('\n')
        expect(tree).to.include('BRV_DATA_DIR=/custom/data/path')
      } finally {
        if (original === undefined) {
          delete process.env.BRV_DATA_DIR
        } else {
          process.env.BRV_DATA_DIR = original
        }
      }
    })
  })

  describe('monitor mode', () => {
    it('should poll and render until connection lost', async () => {
      const state = makeDaemonState()
      const requestStub = stub()
      // First call succeeds, second call throws (simulates connection lost)
      requestStub.onFirstCall().resolves(state)
      requestStub.onSecondCall().rejects(new Error('connection lost'))

      const mockClient: ITransportClient = {
        disconnect: stub().resolves(),
        getClientId: stub().returns('debug-client'),
        getState: stub().returns('connected'),
        isConnected: stub().resolves(true),
        on: stub().returns(() => {}),
        once: stub(),
        request: stub(),
        requestWithAck: requestStub,
      } as unknown as ITransportClient

      const connect = stub().resolves({client: mockClient, projectRoot: '/tmp'})

      // No --once flag → monitor mode
      const cmd = new TestableDebug(ensureRunning, connect, [], config)
      const output = captureOutput(cmd)
      await cmd.run()

      // First render happened
      expect(output.join('\n')).to.include('Daemon')
      // Connection lost message shown
      expect(output.join('\n')).to.include('Connection to daemon lost')
      // Client disconnected
      expect((mockClient.disconnect as SinonStub).calledOnce).to.be.true
    })
  })
})
