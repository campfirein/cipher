import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {CurateLogEntry} from '../../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICurateLogStore} from '../../../../../src/server/core/interfaces/storage/i-curate-log-store.js'
import type {IReviewBackupStore} from '../../../../../src/server/core/interfaces/storage/i-review-backup-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {ResetHandler} from '../../../../../src/server/infra/transport/handlers/reset-handler.js'
import {ResetEvents} from '../../../../../src/shared/transport/events/reset-events.js'

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
    getPort: stub(),
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

// ==================== Tests ====================

describe('ResetHandler', () => {
  let contextTreeService: SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: SinonStubbedInstance<IContextTreeSnapshotService>
  let curateLogStore: SinonStubbedInstance<ICurateLogStore>
  let reviewBackupStore: SinonStubbedInstance<IReviewBackupStore>
  let resolveProjectPath: ReturnType<typeof stub>
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    contextTreeService = {
      delete: stub(),
      exists: stub(),
      initialize: stub<[directory?: string], Promise<string>>().resolves('/test/.brv/context-tree'),
    }

    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      getSnapshotState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
      saveSnapshotFromState: stub(),
    }

    curateLogStore = {
      batchUpdateOperationReviewStatus: stub().resolves(true),
      getById: stub().resolves(null),
      getNextId: stub().resolves('cur-1'),
      list: stub().resolves([]),
      save: stub().resolves(),
    } as unknown as SinonStubbedInstance<ICurateLogStore>

    reviewBackupStore = {
      clear: stub().resolves(),
      delete: stub().resolves(),
      has: stub().resolves(false),
      list: stub().resolves([]),
      read: stub().resolves(null),
      save: stub().resolves(),
    } as unknown as SinonStubbedInstance<IReviewBackupStore>

    resolveProjectPath = stub().returns('/test/project')
    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): ResetHandler {
    const handler = new ResetHandler({
      contextTreeService,
      contextTreeSnapshotService,
      curateLogStoreFactory: () => curateLogStore,
      resolveProjectPath,
      reviewBackupStoreFactory: () => reviewBackupStore,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callExecuteHandler(clientId = 'client-1'): Promise<{error?: string; success: boolean}> {
    const handler = transport._handlers.get(ResetEvents.EXECUTE)
    expect(handler, 'reset:execute handler should be registered').to.exist
    return handler!(undefined, clientId) as Promise<{error?: string; success: boolean}>
  }

  describe('setup', () => {
    it('should register reset:execute handler', () => {
      createHandler()
      expect(transport.onRequest.calledOnce).to.be.true
      expect(transport.onRequest.firstCall.args[0]).to.equal(ResetEvents.EXECUTE)
    })
  })

  describe('handleExecute', () => {
    it('should reset context tree successfully', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      const result = await callExecuteHandler()

      expect(result.success).to.be.true
      expect(contextTreeService.delete.calledOnce).to.be.true
      expect(contextTreeService.delete.calledWith('/test/project')).to.be.true
      expect(contextTreeService.initialize.calledOnce).to.be.true
      expect(contextTreeService.initialize.calledWith('/test/project')).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.calledWith('/test/project')).to.be.true
    })

    it('should throw when context tree does not exist', async () => {
      createHandler()
      contextTreeService.exists.resolves(false)

      try {
        await callExecuteHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Context tree not initialized')
      }

      expect(contextTreeService.delete.called).to.be.false
      expect(contextTreeService.initialize.called).to.be.false
    })

    it('should call delete before initialize', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      await callExecuteHandler()

      expect(contextTreeService.delete.calledBefore(contextTreeService.initialize)).to.be.true
    })

    it('should call initialize before initEmptySnapshot', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      await callExecuteHandler()

      expect(contextTreeService.initialize.calledBefore(contextTreeSnapshotService.initEmptySnapshot)).to.be.true
    })

    it('should clear review backups after resetting context tree', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      await callExecuteHandler()

      expect(reviewBackupStore.clear.calledOnce).to.be.true
    })

    it('should succeed even if backup clear throws', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)
      reviewBackupStore.clear.rejects(new Error('disk error'))

      const result = await callExecuteHandler()

      expect(result.success).to.be.true
    })

    it('should resolve project path from clientId', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      await callExecuteHandler('client-42')

      expect(resolveProjectPath.calledWith('client-42')).to.be.true
    })

    it('should throw when project path is undefined', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      resolveProjectPath.returns(undefined)
      createHandler()

      try {
        await callExecuteHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('No project path found for client')
      }

      expect(contextTreeService.exists.called).to.be.false
      expect(contextTreeService.delete.called).to.be.false
    })

    it('should clear pending review statuses in curate log', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      const entry: CurateLogEntry = {
        completedAt: Date.now(),
        id: 'cur-100',
        input: {},
        operations: [
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
          {
            filePath: '/test/project/.brv/context-tree/api/rest.md',
            needsReview: true,
            path: 'api/rest',
            reviewStatus: 'approved',
            status: 'success',
            type: 'UPDATE',
          },
        ],
        startedAt: Date.now() - 1000,
        status: 'completed',
        summary: {added: 0, deleted: 1, failed: 0, merged: 0, updated: 1},
        taskId: 'task-1',
      }
      curateLogStore.list.resolves([entry])

      const result = await callExecuteHandler()

      expect(result.success).to.be.true
      expect(curateLogStore.batchUpdateOperationReviewStatus.calledOnce).to.be.true
      expect(curateLogStore.batchUpdateOperationReviewStatus.firstCall.args[0]).to.equal('cur-100')
      expect(curateLogStore.batchUpdateOperationReviewStatus.firstCall.args[1]).to.deep.equal([
        {operationIndex: 0, reviewStatus: 'rejected'},
      ])
    })

    it('should clear pending reviews across multiple entries', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)

      const entry1: CurateLogEntry = {
        completedAt: Date.now(),
        id: 'cur-100',
        input: {},
        operations: [
          {filePath: '/test/project/.brv/context-tree/a.md', path: 'a', reviewStatus: 'pending', status: 'success', type: 'ADD'},
        ],
        startedAt: Date.now() - 1000,
        status: 'completed',
        summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0},
        taskId: 'task-1',
      }
      const entry2: CurateLogEntry = {
        completedAt: Date.now(),
        id: 'cur-200',
        input: {},
        operations: [
          {filePath: '/test/project/.brv/context-tree/b.md', path: 'b', reviewStatus: 'pending', status: 'success', type: 'UPDATE'},
        ],
        startedAt: Date.now() - 500,
        status: 'completed',
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 1},
        taskId: 'task-2',
      }
      curateLogStore.list.resolves([entry1, entry2])

      const result = await callExecuteHandler()

      expect(result.success).to.be.true
      expect(curateLogStore.batchUpdateOperationReviewStatus.callCount).to.equal(2)
    })

    it('should succeed even if clearing pending reviews throws', async () => {
      createHandler()
      contextTreeService.exists.resolves(true)
      curateLogStore.list.rejects(new Error('disk error'))

      const result = await callExecuteHandler()

      expect(result.success).to.be.true
    })
  })
})
