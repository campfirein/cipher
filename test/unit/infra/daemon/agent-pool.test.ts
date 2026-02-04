import {expect} from 'chai'
import {EventEmitter} from 'node:events'
import {createSandbox, type SinonSandbox, type SinonStub, stub} from 'sinon'

import type {TaskExecute} from '../../../../src/server/core/domain/transport/schemas.js'
import type {ITransportServer} from '../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {AgentPool} from '../../../../src/server/infra/daemon/agent-pool.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Minimal ChildProcess mock using EventEmitter.
 * Supports IPC message emission and exit simulation.
 */
// eslint-disable-next-line unicorn/prefer-event-target -- ChildProcess uses EventEmitter API (.emit/.on)
class MockChildProcess extends EventEmitter {
  connected = true
  exitCode: null | number = null
  pid: number

  constructor(pid = Math.floor(Math.random() * 10_000) + 1000) {
    super()
    this.pid = pid
  }

  kill(_signal?: string): boolean {
    this.connected = false
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
  }

  /**
   * Simulate the child sending IPC { type: 'ready', clientId }.
   */
  sendReady(clientId: string): void {
    this.emit('message', {clientId, type: 'ready'})
  }

  /**
   * Simulate unexpected exit.
   */
  simulateExit(code: null | number): void {
    this.connected = false
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

function makeStubTransportServer(): ITransportServer & {sendTo: SinonStub} {
  return {
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub().returns(37_847),
    isRunning: stub().returns(true),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub(),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub().resolves(),
    stop: stub().resolves(),
  }
}

function makeTask(overrides: Partial<TaskExecute> = {}): TaskExecute {
  return {
    clientId: 'client-1',
    content: 'test content',
    projectPath: '/app',
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    type: 'curate',
    ...overrides,
  }
}

/**
 * Creates an AgentPool with a stubbed factory that creates MockChildProcess
 * instances. Each mock auto-sends 'ready' with a unique clientId after
 * a microtask delay (simulating real child process boot).
 */
function createPool(
  options: {
    maxSize?: number
    readyTimeoutMs?: number
    transportServer?: ReturnType<typeof makeStubTransportServer>
  } = {},
) {
  const children: MockChildProcess[] = []
  const transportServer = options.transportServer ?? makeStubTransportServer()
  let clientIdCounter = 0

  const stubFactory = stub().callsFake(() => {
    const child = new MockChildProcess()
    children.push(child)

    // Auto-send ready after microtask (like real child process)
    const clientId = `agent-client-${++clientIdCounter}`
    queueMicrotask(() => {
      child.sendReady(clientId)
    })

    return child
  })

  const pool = new AgentPool({
    agentProcessFactory: stubFactory,
    maxSize: options.maxSize ?? 3,
    readyTimeoutMs: options.readyTimeoutMs ?? 2000,
    stopTimeoutMs: 500,
    transportServer,
  })

  return {children, pool, stubFactory, transportServer}
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentPool', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
    sandbox.stub(console, 'log')
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('submitTask — create agent', () => {
    it('should fork agent process for the first task', async () => {
      const {children, pool, stubFactory} = createPool()

      const result = await pool.submitTask(makeTask({projectPath: '/app'}))

      expect(result).to.deep.equal({success: true})
      expect(pool.getSize()).to.equal(1)
      expect(pool.hasAgent('/app')).to.be.true
      expect(children).to.have.lengthOf(1)
      expect(stubFactory.calledOnce).to.be.true
      expect(stubFactory.firstCall.args[0]).to.equal('/app')
    })

    it('should reuse existing agent for same project', async () => {
      const {children, pool} = createPool()

      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))

      // Mark task completed so agent is not busy
      pool.notifyTaskCompleted('/app')

      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't2'}))

      expect(pool.getSize()).to.equal(1)
      expect(children).to.have.lengthOf(1) // Only one child process forked
    })

    it('should create separate agents for different projects', async () => {
      const {children, pool} = createPool()

      await pool.submitTask(makeTask({projectPath: '/app-a', taskId: 't1'}))
      await pool.submitTask(makeTask({projectPath: '/app-b', taskId: 't2'}))

      expect(pool.getSize()).to.equal(2)
      expect(children).to.have.lengthOf(2)
    })

    it('should send task via transportServer.sendTo()', async () => {
      const transportServer = makeStubTransportServer()
      const {pool} = createPool({transportServer})

      const task = makeTask({projectPath: '/app'})
      await pool.submitTask(task)

      expect(transportServer.sendTo.calledOnce).to.be.true
      expect(transportServer.sendTo.firstCall.args[0]).to.equal('agent-client-1')
      expect(transportServer.sendTo.firstCall.args[1]).to.equal('task:execute')
      expect(transportServer.sendTo.firstCall.args[2]).to.deep.equal(task)
    })
  })

  describe('submitTask — factory errors', () => {
    it('should return create_failed when factory throws', async () => {
      const transportServer = makeStubTransportServer()
      const factory = stub().throws(new Error('Fork failed'))
      const pool = new AgentPool({
        agentProcessFactory: factory,
        maxSize: 3,
        readyTimeoutMs: 2000,
        transportServer,
      })

      const result = await pool.submitTask(makeTask())

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('create_failed')
        expect(result.message).to.include('Fork failed')
      }
    })

    it('should return create_failed when child exits before ready', async () => {
      const transportServer = makeStubTransportServer()
      const factory = stub().callsFake(() => {
        const child = new MockChildProcess()
        // Child exits immediately without sending ready
        // eslint-disable-next-line max-nested-callbacks
        queueMicrotask(() => {
          child.simulateExit(1)
        })

        return child
      })

      const pool = new AgentPool({
        agentProcessFactory: factory,
        maxSize: 3,
        readyTimeoutMs: 2000,
        transportServer,
      })

      const result = await pool.submitTask(makeTask())

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('create_failed')
        expect(result.message).to.include('exited before ready')
      }
    })

    it('should reject when task has no projectPath', async () => {
      const {pool} = createPool()

      const result = await pool.submitTask(makeTask({projectPath: undefined}))

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('invalid_task')
      }
    })
  })

  describe('submitTask — queuing', () => {
    it('should queue task when agent is busy', async () => {
      const {pool} = createPool()

      // Create agent with first task (marks agent busy)
      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))
      // Agent is busy (isBusy=true after sendTaskToAgent)

      // Submit second task while agent is busy
      const result = await pool.submitTask(makeTask({projectPath: '/app', taskId: 't2'}))

      expect(result).to.deep.equal({success: true})
      expect(pool.getSize()).to.equal(1) // No new agent forked
    })

    it('should drain queue when notifyTaskCompleted is called', async () => {
      const transportServer = makeStubTransportServer()
      const {pool} = createPool({transportServer})

      // First task
      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))
      // Second task queued (agent busy from first)
      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't2'}))

      // Only first task sent so far
      expect(transportServer.sendTo.callCount).to.equal(1)

      // Complete first task → should drain t2 from queue
      pool.notifyTaskCompleted('/app')

      expect(transportServer.sendTo.callCount).to.equal(2)
      expect(transportServer.sendTo.secondCall.args[1]).to.equal('task:execute')
    })
  })

  describe('pool capacity', () => {
    it('should return pool_full error when pool is full and new project needs agent', async () => {
      const {pool} = createPool({maxSize: 2})

      // Fill pool
      await pool.submitTask(makeTask({projectPath: '/a', taskId: 't1'}))
      await pool.submitTask(makeTask({projectPath: '/b', taskId: 't2'}))
      expect(pool.getSize()).to.equal(2)

      // Pool full → should return error for new project /c
      const result = await pool.submitTask(makeTask({projectPath: '/c', taskId: 't3'}))

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('pool_full')
        expect(result.message).to.include('Agent pool is full')
      }

      expect(pool.hasAgent('/c')).to.be.false
      expect(pool.getSize()).to.equal(2)
    })

    it('should allow task queuing for existing agents even when pool is full', async () => {
      const {pool} = createPool({maxSize: 2})

      // Fill pool
      await pool.submitTask(makeTask({projectPath: '/a', taskId: 't1'}))
      await pool.submitTask(makeTask({projectPath: '/b', taskId: 't2'}))

      // Queue more tasks for existing projects - should succeed
      const resultA = await pool.submitTask(makeTask({projectPath: '/a', taskId: 't3'}))
      const resultB = await pool.submitTask(makeTask({projectPath: '/b', taskId: 't4'}))

      expect(resultA.success).to.be.true
      expect(resultB.success).to.be.true
      expect(pool.getSize()).to.equal(2) // No new agents created
    })
  })

  describe('markIdle', () => {
    it('should mark agent as idle', async () => {
      const {pool} = createPool()
      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))

      pool.notifyTaskCompleted('/app')
      pool.markIdle('/app')

      const entries = pool.getEntries()
      expect(entries[0].isIdle).to.be.true
    })

    it('should be safe to call for non-existent project', () => {
      const {pool} = createPool()
      expect(() => pool.markIdle('/nonexistent')).to.not.throw()
    })
  })

  describe('notifyTaskCompleted', () => {
    it('should clear busy flag', async () => {
      const {pool} = createPool()
      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))

      const entries = pool.getEntries()
      expect(entries[0].hasActiveTask).to.be.true

      pool.notifyTaskCompleted('/app')

      const entriesAfter = pool.getEntries()
      expect(entriesAfter[0].hasActiveTask).to.be.false
    })

    it('should be safe to call for non-existent project', () => {
      const {pool} = createPool()
      expect(() => pool.notifyTaskCompleted('/nonexistent')).to.not.throw()
    })
  })

  describe('getEntries', () => {
    it('should return pool entries with child PID', async () => {
      const {children, pool} = createPool()

      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))

      const entries = pool.getEntries()
      expect(entries).to.have.lengthOf(1)
      expect(entries[0].projectPath).to.equal('/app')
      expect(entries[0].childPid).to.equal(children[0].pid)
      expect(entries[0].createdAt).to.be.a('number')
      expect(entries[0].lastUsedAt).to.be.a('number')
      expect(entries[0].hasActiveTask).to.be.true
      expect(entries[0].isIdle).to.be.false
    })

    it('should return empty array when pool is empty', () => {
      const {pool} = createPool()
      expect(pool.getEntries()).to.deep.equal([])
    })
  })

  describe('shutdown', () => {
    it('should stop all agent processes and clear pool', async () => {
      const {children, pool} = createPool()

      await pool.submitTask(makeTask({projectPath: '/a', taskId: 't1'}))
      await pool.submitTask(makeTask({projectPath: '/b', taskId: 't2'}))

      await pool.shutdown()

      expect(pool.getSize()).to.equal(0)
      // Both children should have received SIGTERM (via kill())
      expect(children[0].connected).to.be.false
      expect(children[1].connected).to.be.false
    })

    it('should handle already-exited processes gracefully', async () => {
      const {children, pool} = createPool()

      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))

      // Simulate child already exited
      children[0].connected = false
      children[0].exitCode = 0

      // Should not throw
      await pool.shutdown()
      expect(pool.getSize()).to.equal(0)
    })
  })

  describe('force eviction', () => {
    it('should return pool_full when pool is full and new project needs agent', async () => {
      const {pool} = createPool({maxSize: 1})

      // Create first agent
      await pool.submitTask(makeTask({projectPath: '/a', taskId: 't1'}))

      // Pool is full (1/1), try to create agent for new project /b
      const result = await pool.submitTask(makeTask({projectPath: '/b', taskId: 't2'}))

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('pool_full')
        expect(result.message).to.include('Agent pool is full')
      }
    })

    it('should allow queuing tasks for existing agents even when pool is full', async () => {
      const {pool} = createPool({maxSize: 1})

      // Create first agent for /a
      await pool.submitTask(makeTask({projectPath: '/a', taskId: 't1'}))

      // Queue another task for same project - should succeed even though pool is full
      const result = await pool.submitTask(makeTask({projectPath: '/a', taskId: 't2'}))

      expect(result.success).to.be.true
      expect(pool.hasAgent('/a')).to.be.true
      expect(pool.getSize()).to.equal(1)
    })
  })

  describe('getQueueState', () => {
    it('should return empty array when no tasks are queued', () => {
      const {pool} = createPool()
      expect(pool.getQueueState()).to.deep.equal([])
    })

    it('should return per-project queue lengths when tasks are queued for busy agents', async () => {
      const {children, pool} = createPool({maxSize: 1})

      // Submit first task to create agent for /app-a
      await pool.submitTask(makeTask({projectPath: '/app-a', taskId: 't1'}))

      // Agent is now busy — submit more tasks for SAME project (gets queued)
      await pool.submitTask(makeTask({projectPath: '/app-a', taskId: 't2'}))
      await pool.submitTask(makeTask({projectPath: '/app-a', taskId: 't3'}))

      const queueState = pool.getQueueState()
      const appAQueue = queueState.find((q) => q.projectPath === '/app-a')
      expect(appAQueue).to.exist
      expect(appAQueue!.queueLength).to.equal(2)

      await pool.shutdown()
      // Force-kill any remaining children
      for (const child of children) {
        if (child.connected) child.kill()
      }
    })
  })

  describe('child process crash handling', () => {
    it('should remove agent from pool when child exits unexpectedly', async () => {
      const {children, pool} = createPool()

      await pool.submitTask(makeTask({projectPath: '/app', taskId: 't1'}))
      expect(pool.hasAgent('/app')).to.be.true

      // Simulate unexpected exit
      children[0].simulateExit(1)

      // Pool should have removed the entry
      expect(pool.hasAgent('/app')).to.be.false
      expect(pool.getSize()).to.equal(0)
    })
  })
})
