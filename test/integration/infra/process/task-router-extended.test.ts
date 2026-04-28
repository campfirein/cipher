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

    it('cursor tiebreaker — same-millisecond cluster paginates without skips', async () => {
      // Reproduces the regression: 4 tasks share createdAt=100. With limit=2,
      // page 1 returns 2 of them; without a tiebreaker, page 2 (using
      // before=100 alone) skips the remaining 2 because the store's filter
      // excludes `createdAt >= before`. With (before, beforeTaskId), page 2
      // returns the missing 2.
      const sharedCreatedAt = 100
      // Task IDs are sorted DESC by the handler, so secondary sort is taskId DESC.
      // Use predictable lexical order: 'd' > 'c' > 'b' > 'a'.
      for (const id of ['a', 'b', 'c', 'd']) {
        // eslint-disable-next-line no-await-in-loop
        await store.save(makeStoredEntry({createdAt: sharedCreatedAt, taskId: id}))
      }

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)

      // Page 1: limit=2 → expect ['d', 'c'] (taskId DESC tiebreaker on equal createdAt)
      const page1 = (await handler!({limit: 2, projectPath: '/app'}, 'client-1')) as {
        nextCursor?: number
        nextCursorTaskId?: string
        tasks: Array<{createdAt: number; taskId: string}>
      }
      expect(page1.tasks.map((t) => t.taskId)).to.deep.equal(['d', 'c'])
      expect(page1.nextCursor).to.equal(sharedCreatedAt)
      expect(page1.nextCursorTaskId).to.equal('c')

      // Page 2: pass back (nextCursor, nextCursorTaskId) → expect ['b', 'a']
      const page2 = (await handler!(
        {
          before: page1.nextCursor,
          beforeTaskId: page1.nextCursorTaskId,
          limit: 2,
          projectPath: '/app',
        },
        'client-1',
      )) as {
        nextCursor?: number
        nextCursorTaskId?: string
        tasks: Array<{createdAt: number; taskId: string}>
      }
      expect(page2.tasks.map((t) => t.taskId)).to.deep.equal(['b', 'a'])
      expect(page2.nextCursor).to.equal(undefined) // no more pages
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

    // B1 — `task:list` schema declares `type?: string[]`, the store applies it,
    // but `handleTaskList` historically dropped the field on the floor. WebUI
    // calling `task:list({type: ['curate']})` would receive every task type.
    describe('type filter (B1)', () => {
      it('single type — only matching persisted tasks returned', async () => {
        await store.save(makeStoredEntry({taskId: 'c1', type: 'curate'}))
        await store.save(makeStoredEntry({taskId: 'q1', type: 'query'}))
        await store.save(makeStoredEntry({taskId: 's1', type: 'search'}))

        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
        const result = (await handler!({projectPath: '/app', type: ['curate']}, 'client-1')) as {
          tasks: Array<{taskId: string; type: string}>
        }

        expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['c1'])
        expect(result.tasks[0].type).to.equal('curate')
      })

      it('multiple types — union of matching persisted tasks returned', async () => {
        await store.save(makeStoredEntry({taskId: 'c1', type: 'curate'}))
        await store.save(makeStoredEntry({taskId: 'q1', type: 'query'}))
        await store.save(makeStoredEntry({taskId: 's1', type: 'search'}))

        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
        const result = (await handler!(
          {projectPath: '/app', type: ['curate', 'query']},
          'client-1',
        )) as {
          tasks: Array<{taskId: string; type: string}>
        }

        // Same createdAt for all three → secondary sort by taskId DESC: q1 then c1.
        expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['q1', 'c1'])
      })

      it('in-memory tasks honor type filter (not just persisted)', async () => {
        // Persisted curate.
        await store.save(makeStoredEntry({taskId: 'persisted-c', type: 'curate'}))

        // In-memory query via createHandler — must be excluded when filter is ['curate'].
        const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
        await createHandler!(
          makeTaskCreateRequest({taskId: 'live-q', type: 'query'}),
          'client-1',
        )

        const listHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
        const result = (await listHandler!({projectPath: '/app', type: ['curate']}, 'client-1')) as {
          tasks: Array<{taskId: string}>
        }

        expect(result.tasks.map((t) => t.taskId)).to.deep.equal(['persisted-c'])
      })

      it('omitted type filter returns all types (back-compat)', async () => {
        await store.save(makeStoredEntry({taskId: 'c1', type: 'curate'}))
        await store.save(makeStoredEntry({taskId: 'q1', type: 'query'}))

        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
        const result = (await handler!({projectPath: '/app'}, 'client-1')) as {
          tasks: Array<{taskId: string}>
        }

        expect(result.tasks).to.have.lengthOf(2)
      })

      it('empty type[] returns all types (matches store ?.length semantics)', async () => {
        await store.save(makeStoredEntry({taskId: 'c1', type: 'curate'}))
        await store.save(makeStoredEntry({taskId: 'q1', type: 'query'}))

        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.LIST)
        const result = (await handler!({projectPath: '/app', type: []}, 'client-1')) as {
          tasks: Array<{taskId: string}>
        }

        expect(result.tasks).to.have.lengthOf(2)
      })
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
        // Far-future daemonStartedAt so this test's saves register as pre-boot
        // (eligible for stale-recovery via the C0 daemon-startup gate). Without
        // this override the entry would be treated as a live in-flight task.
        daemonStartedAt: Date.now() + 60_000_000_000,
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
        deleteMany: sandbox.stub().resolves([]),
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

    it('C4 — does NOT inflate deletedCount for unknown taskIds', async () => {
      // Bug: `handleTaskDelete` returned {success: true} unconditionally even
      // for taskIds the daemon had never heard of. The bulk handler counted on
      // `success`, so 50 unknown ids reported `deletedCount: 50`. The fix uses
      // the new `removed` flag.
      await store.save(makeStoredEntry({taskId: 'known-1'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
      const result = (await handler!(
        {taskIds: ['known-1', 'ghost-1', 'ghost-2', 'ghost-3', 'ghost-4', 'ghost-5']},
        'client-1',
      )) as {deletedCount: number}

      expect(result.deletedCount).to.equal(1) // only known-1; ghosts must not inflate
    })

    it('C4 — bulk delete of all-unknown ids returns deletedCount: 0', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
      const result = (await handler!(
        {taskIds: ['nope-1', 'nope-2', 'nope-3']},
        'client-1',
      )) as {deletedCount: number}

      expect(result.deletedCount).to.equal(0)
    })

    it('C4 — does NOT broadcast task:deleted for unknown taskIds', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
      await handler!({taskIds: ['unseen-1', 'unseen-2']}, 'client-1')

      const broadcasts = getDeletedBroadcastTaskIds()
      // Pre-fix: unknown ids still triggered the wasInMemory||wasLive check
      // which was `false` so no broadcast. So this test asserts the existing
      // correct behaviour stays correct under the new `removed` semantics.
      expect(broadcasts).to.not.include('unseen-1')
      expect(broadcasts).to.not.include('unseen-2')
    })

    // N3 — `handleTaskDeleteBulk` previously called `handleTaskDelete`
    // sequentially per id, each invoking `store.delete` which re-reads the
    // entire `_index.jsonl` (cache invalidated by tombstone append). 200 ids
    // = 200 full index reads. The store interface already exposes
    // `deleteMany` for batched removal — the router should use it.
    describe('N3 — batches store.deleteMany per project', () => {
      it('issues one store.deleteMany call (not N store.delete calls) for ids in a single project', async () => {
        for (let i = 0; i < 5; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeStoredEntry({taskId: `bulk-${i}`}))
        }

        const deleteSpy = sandbox.spy(store, 'delete')
        const deleteManySpy = sandbox.spy(store, 'deleteMany')

        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
        const result = (await handler!(
          {taskIds: ['bulk-0', 'bulk-1', 'bulk-2', 'bulk-3', 'bulk-4']},
          'client-1',
        )) as {deletedCount: number}

        expect(result.deletedCount).to.equal(5)

        // Per-id store.delete must NOT be called for bulk operations.
        expect(deleteSpy.callCount, 'store.delete should not be called by bulk handler').to.equal(0)

        // store.deleteMany called once with all 5 ids.
        expect(deleteManySpy.callCount).to.equal(1)
        const argIds = deleteManySpy.firstCall.args[0]
        expect(argIds).to.have.members(['bulk-0', 'bulk-1', 'bulk-2', 'bulk-3', 'bulk-4'])
      })

      it('continues to broadcast task:deleted per id (one event per removal)', async () => {
        for (let i = 0; i < 3; i++) {
          // eslint-disable-next-line no-await-in-loop
          await store.save(makeStoredEntry({taskId: `bcast-${i}`}))
        }

        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE_BULK)
        await handler!({taskIds: ['bcast-0', 'bcast-1', 'bcast-2']}, 'client-1')

        const broadcasts = getDeletedBroadcastTaskIds()
        expect(broadcasts).to.include.members(['bcast-0', 'bcast-1', 'bcast-2'])
      })
    })
  })

  // ==========================================================================
  // handleTaskDelete (single) — C4 contract for `removed` flag
  // ==========================================================================

  describe('handleTaskDelete contract (C4)', () => {
    it('returns {success: true, removed: true} for a real removal', async () => {
      await store.save(makeStoredEntry({taskId: 'real-1'}))

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      const result = (await handler!({taskId: 'real-1'}, 'client-1')) as {
        removed?: boolean
        success: boolean
      }

      expect(result.success).to.equal(true)
      expect(result.removed).to.equal(true)
    })

    it('returns {success: true, removed: false} for an unknown taskId', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      const result = (await handler!({taskId: 'never-existed'}, 'client-1')) as {
        removed?: boolean
        success: boolean
      }

      expect(result.success).to.equal(true)
      expect(result.removed).to.equal(false)
    })

    it('returns {success: false, removed: false} for non-terminal in-memory task', async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const liveId = randomUUID()
      await createHandler!(makeTaskCreateRequest({taskId: liveId}), 'client-1')

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.DELETE)
      const result = (await handler!({taskId: liveId}, 'client-1')) as {
        removed?: boolean
        success: boolean
      }

      expect(result.success).to.equal(false)
      expect(result.removed).to.equal(false)
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
