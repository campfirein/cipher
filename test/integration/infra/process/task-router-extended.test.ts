/**
 * TaskRouter — extended handlers (M2.09).
 *
 * Integration test: real `FileTaskHistoryStore` (per-test tempDir) + stub
 * transport/agentPool/projectRouter/projectRegistry. Drives the full
 * lifecycle through the TaskRouter handlers and verifies on-disk + broadcast
 * effects.
 *
 * No production-code escape hatches — custom store factories are injected
 * via `TaskRouterOptions.getTaskHistoryStore` directly.
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rm, unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {TaskHistoryEntry} from '../../../../src/server/core/domain/entities/task-history-entry.js'
import type {IAgentPool, SubmitTaskResult} from '../../../../src/server/core/interfaces/agent/i-agent-pool.js'
import type {IProjectRegistry} from '../../../../src/server/core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../../../src/server/core/interfaces/routing/i-project-router.js'
import type {ITaskHistoryStore} from '../../../../src/server/core/interfaces/storage/i-task-history-store.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {TransportTaskEventNames} from '../../../../src/server/core/domain/transport/schemas.js'
import {TaskRouter} from '../../../../src/server/infra/process/task-router.js'
import {FileTaskHistoryStore} from '../../../../src/server/infra/storage/file-task-history-store.js'

// ============================================================================
// Helpers
// ============================================================================

function makeProjectInfo(projectPath: string) {
  return {
    projectPath,
    registeredAt: Date.now(),
    sanitizedPath: projectPath.replaceAll('/', '_'),
    storagePath: `/data${projectPath}`,
  }
}

function makeStubTransportServer(sandbox: SinonSandbox) {
  const requestHandlers = new Map<string, RequestHandler>()
  const transport: ITransportServer = {
    addToRoom: sandbox.stub(),
    broadcast: sandbox.stub(),
    broadcastTo: sandbox.stub(),
    getPort: sandbox.stub().returns(3000),
    isRunning: sandbox.stub().returns(true),
    onConnection: sandbox.stub(),
    onDisconnection: sandbox.stub(),
    onRequest: sandbox.stub().callsFake((event: string, handler: RequestHandler) => {
      requestHandlers.set(event, handler)
    }),
    removeFromRoom: sandbox.stub(),
    sendTo: sandbox.stub(),
    start: sandbox.stub().resolves(),
    stop: sandbox.stub().resolves(),
  }
  return {requestHandlers, transport}
}

function makeStubAgentPool(sandbox: SinonSandbox): IAgentPool {
  return {
    getEntries: sandbox.stub().returns([]),
    getSize: sandbox.stub().returns(0),
    handleAgentDisconnected: sandbox.stub(),
    hasAgent: sandbox.stub().returns(false),
    markIdle: sandbox.stub(),
    notifyTaskCompleted: sandbox.stub(),
    shutdown: sandbox.stub().resolves(),
    submitTask: sandbox.stub().resolves({success: true} as SubmitTaskResult),
  }
}

function makeStubProjectRegistry(sandbox: SinonSandbox): IProjectRegistry {
  return {
    get: sandbox.stub().callsFake((path: string) => makeProjectInfo(path)),
    getAll: sandbox.stub().returns(new Map()),
    register: sandbox.stub().callsFake((path: string) => makeProjectInfo(path)),
    unregister: sandbox.stub().returns(true),
  }
}

function makeStubProjectRouter(sandbox: SinonSandbox): IProjectRouter & {broadcastToProject: SinonStub} {
  return {
    addToProjectRoom: sandbox.stub(),
    broadcastToProject: sandbox.stub(),
    getProjectMembers: sandbox.stub().returns([]),
    removeFromProjectRoom: sandbox.stub(),
  }
}

function makeTaskCreateRequest(overrides: Record<string, unknown> = {}) {
  return {
    content: 'test content',
    projectPath: '/app',
    taskId: randomUUID(),
    type: 'curate' as const,
    ...overrides,
  }
}

function makeStoredEntry(overrides: Partial<TaskHistoryEntry> & {taskId: string}): TaskHistoryEntry {
  const base = {
    completedAt: 1_745_432_001_000,
    content: `prompt for ${overrides.taskId}`,
    createdAt: 1_745_432_000_000,
    id: `tsk-${overrides.taskId}`,
    projectPath: '/app',
    result: 'done',
    schemaVersion: 1 as const,
    status: 'completed' as const,
    taskId: overrides.taskId,
    type: 'curate',
  }
  return {...base, ...overrides} as TaskHistoryEntry
}

// ============================================================================
// Tests
// ============================================================================

describe('TaskRouter — extended handlers', () => {
  let sandbox: SinonSandbox
  let transportHelper: ReturnType<typeof makeStubTransportServer>
  let agentPool: ReturnType<typeof makeStubAgentPool>
  let projectRegistry: ReturnType<typeof makeStubProjectRegistry>
  let projectRouter: ReturnType<typeof makeStubProjectRouter>
  let getAgentForProject: SinonStub
  let tempDir: string
  let store: FileTaskHistoryStore
  let router: TaskRouter

  beforeEach(async () => {
    sandbox = createSandbox()
    transportHelper = makeStubTransportServer(sandbox)
    agentPool = makeStubAgentPool(sandbox)
    projectRegistry = makeStubProjectRegistry(sandbox)
    projectRouter = makeStubProjectRouter(sandbox)
    getAgentForProject = sandbox.stub().returns('agent-1')

    tempDir = join(tmpdir(), `brv-task-router-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})

    // Disable stale recovery + prune + compaction in default fixture so legacy
    // createdAt timestamps don't mutate test data unexpectedly. The dedicated
    // stale-recovery test (and any prune-specific tests) override per-test.
    store = new FileTaskHistoryStore({
      baseDir: tempDir,
      maxAgeDays: 0,
      maxEntries: Number.POSITIVE_INFINITY,
      maxIndexBloatRatio: Number.POSITIVE_INFINITY,
      staleThresholdMs: Number.POSITIVE_INFINITY,
    })

    router = new TaskRouter({
      agentPool,
      getAgentForProject,
      getTaskHistoryStore: () => store,
      projectRegistry,
      projectRouter,
      resolveClientProjectPath: () => '/app',
      transport: transportHelper.transport,
    })
    router.setup()
  })

  afterEach(async () => {
    sandbox.restore()
    await rm(tempDir, {force: true, recursive: true})
  })

  function getDeletedBroadcastTaskIds(): string[] {
    return projectRouter.broadcastToProject
      .getCalls()
      .filter((c) => c.args[1] === TransportTaskEventNames.DELETED)
      .map((c) => (c.args[2] as {taskId: string}).taskId)
  }

  // ==========================================================================
  // handleTaskList
  // ==========================================================================

  describe('handleTaskList', () => {
    it('honors before + limit', async () => {
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.save(makeStoredEntry({createdAt: 100 * (i + 1), taskId: `t${i}`}))
      }

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await handler!({before: 350, limit: 2, projectPath: '/app'}, 'client-1')) as {
        nextCursor?: number
        tasks: Array<{taskId: string}>
      }

      // 5 entries (createdAt 100,200,300,400,500). before=350 → keep 100,200,300. limit=2 → newest two.
      expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['t2', 't1'])
      // Page is full (limit=2) and there's still 't0' below → expect nextCursor.
      expect(result.nextCursor).to.equal(200)
    })

    it('returns nextCursor when more entries exist past the page', async () => {
      for (let i = 0; i < 4; i++) {
        // eslint-disable-next-line no-await-in-loop
        await store.save(makeStoredEntry({createdAt: 100 * (i + 1), taskId: `n${i}`}))
      }

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await handler!({limit: 2, projectPath: '/app'}, 'client-1')) as {
        nextCursor?: number
        tasks: unknown[]
      }

      expect(result.tasks).to.have.lengthOf(2)
      expect(result.nextCursor).to.be.a('number')
    })

    it('merges in-memory + persisted, in-memory wins by taskId', async () => {
      // Save older 'completed' state to disk
      await store.save(
        makeStoredEntry({createdAt: 100, status: 'completed', taskId: 'shared'}),
      )

      // Drive create through TaskRouter so in-memory has fresher state with status 'created'
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      await createHandler!(makeTaskCreateRequest({content: 'fresh', taskId: 'shared'}), 'client-1')

      const listHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await listHandler!({projectPath: '/app'}, 'client-1')) as {
        tasks: Array<{content: string; status: string; taskId: string}>
      }

      const shared = result.tasks.find((t) => t.taskId === 'shared')
      expect(shared).to.exist
      expect(shared!.status).to.equal('created') // in-memory wins
      expect(shared!.content).to.equal('fresh')
    })

    it('project filter isolates results', async () => {
      await store.save(makeStoredEntry({projectPath: '/app', taskId: 'in'}))
      await store.save(makeStoredEntry({projectPath: '/other', taskId: 'out'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await handler!({projectPath: '/app'}, 'client-1')) as {
        tasks: Array<{taskId: string}>
      }

      expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['in'])
    })

    it('status filter applied at index read', async () => {
      await store.save(makeStoredEntry({status: 'completed', taskId: 'c'}))
      await store.save(
        makeStoredEntry({
          completedAt: 1,
          error: {code: 'X', message: 'x', name: 'X'},
          status: 'error',
          taskId: 'e',
        }),
      )

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await handler!({projectPath: '/app', status: ['error']}, 'client-1')) as {
        tasks: Array<{taskId: string}>
      }

      expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['e'])
    })

    it('sorted createdAt desc', async () => {
      await store.save(makeStoredEntry({createdAt: 100, taskId: 'old'}))
      await store.save(makeStoredEntry({createdAt: 500, taskId: 'new'}))
      await store.save(makeStoredEntry({createdAt: 300, taskId: 'mid'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await handler!({projectPath: '/app'}, 'client-1')) as {
        tasks: Array<{taskId: string}>
      }

      expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['new', 'mid', 'old'])
    })

    it('stale-recovery surfaces in response', async () => {
      // Recreate the router with a stale-friendly store (small threshold).
      sandbox.restore()
      sandbox = createSandbox()
      transportHelper = makeStubTransportServer(sandbox)
      agentPool = makeStubAgentPool(sandbox)
      projectRegistry = makeStubProjectRegistry(sandbox)
      projectRouter = makeStubProjectRouter(sandbox)
      getAgentForProject = sandbox.stub().returns('agent-1')

      const staleStore = new FileTaskHistoryStore({
        baseDir: tempDir,
        maxAgeDays: 0,
        maxEntries: Number.POSITIVE_INFINITY,
        maxIndexBloatRatio: Number.POSITIVE_INFINITY,
        staleThresholdMs: 100,
      })
      router = new TaskRouter({
        agentPool,
        getAgentForProject,
        getTaskHistoryStore: () => staleStore,
        projectRegistry,
        projectRouter,
        resolveClientProjectPath: () => '/app',
        transport: transportHelper.transport,
      })
      router.setup()

      const oldCreatedAt = Date.now() - 200
      await staleStore.save(
        makeStoredEntry({
          createdAt: oldCreatedAt,
          startedAt: oldCreatedAt + 10,
          status: 'started',
          taskId: 'ghost',
        }),
      )

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await handler!({projectPath: '/app'}, 'client-1')) as {
        tasks: Array<{status: string; taskId: string}>
      }

      const ghost = result.tasks.find((t) => t.taskId === 'ghost')
      expect(ghost).to.exist
      expect(ghost!.status).to.equal('error')
    })

    it('store error falls back to in-memory only', async () => {
      const erroringStore: ITaskHistoryStore = {
        clear: sandbox.stub().resolves({deletedCount: 0, taskIds: []}),
        delete: sandbox.stub().resolves(false),
        deleteMany: sandbox.stub().resolves(0),
        getById: sandbox.stub().resolves(),
        list: sandbox.stub().rejects(new Error('disk down')),
        save: sandbox.stub().resolves(),
      }

      // Rebuild router with the failing store
      sandbox.restore()
      sandbox = createSandbox()
      transportHelper = makeStubTransportServer(sandbox)
      agentPool = makeStubAgentPool(sandbox)
      projectRegistry = makeStubProjectRegistry(sandbox)
      projectRouter = makeStubProjectRouter(sandbox)
      getAgentForProject = sandbox.stub().returns('agent-1')

      router = new TaskRouter({
        agentPool,
        getAgentForProject,
        getTaskHistoryStore: () => erroringStore,
        projectRegistry,
        projectRouter,
        resolveClientProjectPath: () => '/app',
        transport: transportHelper.transport,
      })
      router.setup()

      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      await createHandler!(makeTaskCreateRequest({taskId: 'in-mem'}), 'client-1')

      const listHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
      const result = (await listHandler!({projectPath: '/app'}, 'client-1')) as {
        tasks: Array<{taskId: string}>
      }

      expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['in-mem'])
    })
  })

  // ==========================================================================
  // handleTaskGet
  // ==========================================================================

  describe('handleTaskGet', () => {
    it('returns synthesized entry from in-memory TaskInfo when present', async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const taskId = randomUUID()
      await createHandler!(makeTaskCreateRequest({taskId}), 'client-1')

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.GET)
      const result = (await handler!({taskId}, 'client-1')) as {task: null | TaskHistoryEntry}

      expect(result.task).to.exist
      expect(result.task!.taskId).to.equal(taskId)
      expect(result.task!.status).to.equal('created')
    })

    it('falls back to store.getById when not in-memory', async () => {
      await store.save(makeStoredEntry({taskId: 'on-disk'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.GET)
      const result = (await handler!({taskId: 'on-disk'}, 'client-1')) as {task: null | TaskHistoryEntry}

      expect(result.task).to.exist
      expect(result.task!.taskId).to.equal('on-disk')
    })

    it('returns {task: null} when neither has it', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.GET)
      const result = (await handler!({taskId: 'never'}, 'client-1')) as {task: null | TaskHistoryEntry}

      expect(result.task).to.equal(null)
    })

    it('returns {task: null} for orphan-index entry', async () => {
      await store.save(makeStoredEntry({taskId: 'orphan'}))
      // Manually unlink the data file — index says alive but data is gone.
      await unlink(join(tempDir, 'task-history', 'data', 'tsk-orphan.json'))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.GET)
      const result = (await handler!({taskId: 'orphan'}, 'client-1')) as {task: null | TaskHistoryEntry}

      expect(result.task).to.equal(null)
    })
  })

  // ==========================================================================
  // handleTaskDelete
  // ==========================================================================

  describe('handleTaskDelete', () => {
    it('refuses non-terminal status', async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const taskId = randomUUID()
      await createHandler!(makeTaskCreateRequest({taskId}), 'client-1')

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      const result = (await handler!({taskId}, 'client-1')) as {error?: string; success: boolean}

      expect(result.success).to.equal(false)
      expect(result.error).to.exist
    })

    it('removes from in-memory + writes tombstone + unlinks', async () => {
      await store.save(makeStoredEntry({taskId: 'die'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      const result = (await handler!({taskId: 'die'}, 'client-1')) as {success: boolean}

      expect(result.success).to.equal(true)

      // Tombstone present in index
      const indexRaw = await readFile(join(tempDir, 'task-history', '_index.jsonl'), 'utf8')
      const lines = indexRaw.split('\n').filter(Boolean)
      const lastLine = JSON.parse(lines.at(-1) ?? '') as Record<string, unknown>
      expect(lastLine).to.include({_deleted: true, taskId: 'die'})

      // Data file gone
      const dataPath = join(tempDir, 'task-history', 'data', 'tsk-die.json')
      let dataExists = true
      try {
        await readFile(dataPath, 'utf8')
      } catch {
        dataExists = false
      }

      expect(dataExists).to.equal(false)
    })

    it('broadcasts task:deleted', async () => {
      await store.save(makeStoredEntry({taskId: 'broadcast-me'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      await handler!({taskId: 'broadcast-me'}, 'client-1')

      expect(getDeletedBroadcastTaskIds()).to.include('broadcast-me')
    })

    it('idempotent — second call returns success, no second broadcast', async () => {
      await store.save(makeStoredEntry({taskId: 'twice'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      const r1 = (await handler!({taskId: 'twice'}, 'client-1')) as {success: boolean}
      const r2 = (await handler!({taskId: 'twice'}, 'client-1')) as {success: boolean}

      expect(r1.success).to.equal(true)
      expect(r2.success).to.equal(true)

      const broadcasts = getDeletedBroadcastTaskIds().filter((id) => id === 'twice')
      expect(broadcasts).to.have.lengthOf(1)
    })
  })

  // ==========================================================================
  // handleTaskDeleteBulk
  // ==========================================================================

  describe('handleTaskDeleteBulk', () => {
    it('skips non-terminal, reports correct deletedCount', async () => {
      // Two completed entries on disk
      await store.save(makeStoredEntry({taskId: 'b1'}))
      await store.save(makeStoredEntry({taskId: 'b2'}))

      // One non-terminal in-memory
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const liveId = randomUUID()
      await createHandler!(makeTaskCreateRequest({taskId: liveId}), 'client-1')

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
      const result = (await handler!({taskIds: ['b1', 'b2', liveId]}, 'client-1')) as {
        deletedCount: number
      }

      expect(result.deletedCount).to.equal(2)
    })

    it('broadcasts task:deleted per successful removal', async () => {
      await store.save(makeStoredEntry({taskId: 'k1'}))
      await store.save(makeStoredEntry({taskId: 'k2'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
      await handler!({taskIds: ['k1', 'k2']}, 'client-1')

      const broadcasts = getDeletedBroadcastTaskIds()
      expect(broadcasts).to.include('k1')
      expect(broadcasts).to.include('k2')
    })
  })

  // ==========================================================================
  // handleTaskClearCompleted
  // ==========================================================================

  describe('handleTaskClearCompleted', () => {
    it('unions in-memory completedTasks + store.clear results', async () => {
      // Persistent terminal entries
      await store.save(makeStoredEntry({taskId: 'p1'}))
      await store.save(makeStoredEntry({taskId: 'p2'}))

      // Drive a task through to completed (in-memory grace period)
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const completedHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)
      const inMemId = randomUUID()
      await createHandler!(makeTaskCreateRequest({taskId: inMemId}), 'client-1')
      completedHandler!({result: 'done', taskId: inMemId}, 'agent-1')

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CLEAR_COMPLETED)
      const result = (await handler!({projectPath: '/app'}, 'client-1')) as {deletedCount: number}

      // 2 from disk + 1 from in-memory completedTasks = 3
      expect(result.deletedCount).to.equal(3)
    })

    it('broadcasts task:deleted per removed entry', async () => {
      await store.save(makeStoredEntry({taskId: 'cb1'}))
      await store.save(makeStoredEntry({taskId: 'cb2'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CLEAR_COMPLETED)
      await handler!({projectPath: '/app'}, 'client-1')

      const broadcasts = getDeletedBroadcastTaskIds()
      expect(broadcasts).to.include('cb1')
      expect(broadcasts).to.include('cb2')
    })
  })
})
