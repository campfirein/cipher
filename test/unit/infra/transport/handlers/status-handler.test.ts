import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {CurateLogEntry} from '../../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICurateLogStore} from '../../../../../src/server/core/interfaces/storage/i-curate-log-store.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'

// ==================== Test Helpers ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any, clientId: string) => any

function createMockTransport(): SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>} {
  const handlers = new Map<string, AnyHandler>()
  return {
    _handlers: handlers,
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub().returns(54_321),
    isRunning: stub(),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub().callsFake((event: string, handler: AnyHandler) => {
      handlers.set(event, handler)
    }),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub(),
    stop: stub(),
  } as unknown as SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>}
}

function makeCompletedEntry(ops: CurateLogEntry['operations']): CurateLogEntry {
  return {
    completedAt: Date.now(),
    id: 'cur-1',
    input: {},
    operations: ops,
    startedAt: Date.now() - 1000,
    status: 'completed' as const,
    summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    taskId: 'task-1',
  } as CurateLogEntry
}

// ==================== Tests ====================

describe('StatusHandler – pending review integration', () => {
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let contextTreeService: SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: SinonStubbedInstance<IContextTreeSnapshotService>
  let projectConfigStore: SinonStubbedInstance<IProjectConfigStore>
  let curateLogStore: ICurateLogStore & {list: ReturnType<typeof stub>}
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    tokenStore = {
      clear: stub(),
      load: stub().resolves(),
      save: stub(),
    } as unknown as SinonStubbedInstance<ITokenStore>

    contextTreeService = {
      delete: stub(),
      exists: stub().resolves(false),
      initialize: stub(),
    } as unknown as SinonStubbedInstance<IContextTreeService>

    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      getSnapshotState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
      saveSnapshotFromState: stub(),
    } as unknown as SinonStubbedInstance<IContextTreeSnapshotService>

    projectConfigStore = {
      exists: stub().resolves(false),
      read: stub(),
      write: stub(),
    } as unknown as SinonStubbedInstance<IProjectConfigStore>

    curateLogStore = {
      getById: stub().resolves(null),
      getNextId: stub().resolves('cur-1'),
      list: stub().resolves([]),
      save: stub().resolves(),
      updateOperationReviewStatus: stub().resolves(true),
    }

    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): void {
    const handler = new StatusHandler({
      contextTreeService,
      contextTreeSnapshotService,
      curateLogStoreFactory: () => curateLogStore,
      projectConfigStore,
      resolveProjectPath: () => '/test/project',
      tokenStore,
      transport,
    })
    handler.setup()
  }

  async function getStatus(): Promise<StatusDTO> {
    const handler = transport._handlers.get('status:get')
    if (!handler) throw new Error('status:get handler not registered')
    const result = await handler(undefined, 'client-1')
    return result.status
  }

  it('should include pendingReviewCount when curate log has pending ops', async () => {
    createHandler()

    curateLogStore.list.resolves([
      makeCompletedEntry([
        {
          filePath: '/test/project/.brv/context-tree/auth/jwt.md',
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        },
        {
          filePath: '/test/project/.brv/context-tree/auth/oauth.md',
          needsReview: true,
          path: 'auth/oauth',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        },
      ]),
    ])

    const status = await getStatus()
    expect(status.pendingReviewCount).to.equal(2)
  })

  it('should include reviewUrl when pending reviews exist', async () => {
    createHandler()

    curateLogStore.list.resolves([
      makeCompletedEntry([
        {
          filePath: '/test/project/.brv/context-tree/auth/jwt.md',
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        },
      ]),
    ])

    const status = await getStatus()
    expect(status.reviewUrl).to.be.a('string')
    expect(status.reviewUrl).to.include('http://127.0.0.1:54321/review?project=')
  })

  it('should NOT include pendingReviewCount when no pending ops exist', async () => {
    createHandler()

    curateLogStore.list.resolves([
      makeCompletedEntry([
        {
          filePath: '/test/project/.brv/context-tree/auth/jwt.md',
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'approved',
          status: 'success',
          type: 'DELETE',
        },
      ]),
    ])

    const status = await getStatus()
    expect(status.pendingReviewCount).to.be.undefined
    expect(status.reviewUrl).to.be.undefined
  })

  it('should NOT include pendingReviewCount when curate log is empty', async () => {
    createHandler()
    curateLogStore.list.resolves([])

    const status = await getStatus()
    expect(status.pendingReviewCount).to.be.undefined
  })

  it('should count unique files, not operations', async () => {
    createHandler()

    // Same file appears in two entries
    curateLogStore.list.resolves([
      makeCompletedEntry([
        {
          filePath: '/test/project/.brv/context-tree/auth/jwt.md',
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        },
      ]),
      makeCompletedEntry([
        {
          filePath: '/test/project/.brv/context-tree/auth/jwt.md',
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'UPDATE',
        },
      ]),
    ])

    const status = await getStatus()
    expect(status.pendingReviewCount).to.equal(1)
  })

  it('should detect pending ops even when needsReview is undefined', async () => {
    createHandler()

    curateLogStore.list.resolves([
      makeCompletedEntry([
        {
          filePath: '/test/project/.brv/context-tree/auth/jwt.md',
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        },
      ]),
    ])

    const status = await getStatus()
    expect(status.pendingReviewCount).to.equal(1)
    expect(status.reviewUrl).to.be.a('string')
  })

  it('should gracefully handle curate log errors', async () => {
    createHandler()
    curateLogStore.list.rejects(new Error('disk error'))

    const status = await getStatus()
    // Should still return valid status without review fields
    expect(status.pendingReviewCount).to.be.undefined
    expect(status.reviewUrl).to.be.undefined
    expect(status.currentDirectory).to.equal('/test/project')
  })
})
