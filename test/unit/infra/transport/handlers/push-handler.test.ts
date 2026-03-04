import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {FileState} from '../../../../../src/server/core/domain/entities/context-tree-snapshot.js'
import type {CurateLogEntry} from '../../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextFileReader} from '../../../../../src/server/core/interfaces/context-tree/i-context-file-reader.js'
import type {IContextTreeSnapshotService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICogitPushService} from '../../../../../src/server/core/interfaces/services/i-cogit-push-service.js'
import type {ICurateLogStore} from '../../../../../src/server/core/interfaces/storage/i-curate-log-store.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {IReviewBackupStore} from '../../../../../src/server/core/interfaces/storage/i-review-backup-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {ProjectBroadcaster} from '../../../../../src/server/infra/transport/handlers/handler-types.js'
import type {PushExecuteResponse, PushPrepareResponse} from '../../../../../src/shared/transport/events/push-events.js'

import {BrvConfig} from '../../../../../src/server/core/domain/entities/brv-config.js'
import {CogitPushResponse} from '../../../../../src/server/core/domain/entities/cogit-push-response.js'
import {PushHandler} from '../../../../../src/server/infra/transport/handlers/push-handler.js'

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

function makeToken(): {accessToken: string; isValid: () => boolean; sessionKey: string} {
  return {accessToken: 'test-token', isValid: () => true, sessionKey: 'test-session'}
}

function makeConfig(): BrvConfig {
  return BrvConfig.fromJson({
    createdAt: new Date().toISOString(),
    spaceId: 'space-1',
    spaceName: 'test-space',
    teamId: 'team-1',
    teamName: 'test-team',
    version: '1',
  })
}

// ==================== Tests ====================

describe('PushHandler – review filtering', () => {
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let contextFileReader: SinonStubbedInstance<IContextFileReader>
  let contextTreeSnapshotService: SinonStubbedInstance<IContextTreeSnapshotService>
  let cogitPushService: SinonStubbedInstance<ICogitPushService>
  let projectConfigStore: SinonStubbedInstance<IProjectConfigStore>
  let curateLogStore: ICurateLogStore & {list: ReturnType<typeof stub>}
  let reviewBackupStore: IReviewBackupStore & {delete: ReturnType<typeof stub>}
  let transport: ReturnType<typeof createMockTransport>
  let broadcastToProject: ReturnType<typeof stub>

  beforeEach(() => {
    tokenStore = {
      clear: stub(),
      load: stub().resolves(makeToken()),
      save: stub(),
    } as unknown as SinonStubbedInstance<ITokenStore>

    contextFileReader = {
      read: stub().resolves(),
      readMany: stub().resolves([]),
    } as unknown as SinonStubbedInstance<IContextFileReader>

    contextTreeSnapshotService = {
      getChanges: stub().resolves({added: [], deleted: [], modified: []}),
      getCurrentState: stub().resolves(new Map()),
      getSnapshotState: stub().resolves(new Map()),
      hasSnapshot: stub().resolves(true),
      initEmptySnapshot: stub().resolves(),
      saveSnapshot: stub().resolves(),
      saveSnapshotFromState: stub().resolves(),
    } as unknown as SinonStubbedInstance<IContextTreeSnapshotService>

    cogitPushService = {
      push: stub().resolves(new CogitPushResponse({message: 'ok', success: true})),
    } as unknown as SinonStubbedInstance<ICogitPushService>

    projectConfigStore = {
      exists: stub().resolves(true),
      getModifiedTime: stub(),
      read: stub().resolves(makeConfig()),
      write: stub(),
    } as unknown as SinonStubbedInstance<IProjectConfigStore>

    curateLogStore = {
      getById: stub().resolves(null),
      getNextId: stub().resolves('cur-1'),
      list: stub().resolves([]),
      save: stub().resolves(),
      updateOperationReviewStatus: stub().resolves(true),
    }

    reviewBackupStore = {
      clear: stub().resolves(),
      delete: stub().resolves(),
      has: stub().resolves(false),
      read: stub().resolves(null),
      save: stub().resolves(),
    }

    transport = createMockTransport()
    broadcastToProject = stub()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): void {
    const handler = new PushHandler({
      broadcastToProject: broadcastToProject as ProjectBroadcaster,
      cogitPushService,
      contextFileReader,
      contextTreeSnapshotService,
      curateLogStoreFactory: () => curateLogStore,
      projectConfigStore,
      resolveProjectPath: () => '/test/project',
      reviewBackupStoreFactory: () => reviewBackupStore,
      tokenStore,
      transport,
      webAppUrl: 'https://app.byterover.com',
    })
    handler.setup()
  }

  async function preparePush(): Promise<PushPrepareResponse> {
    const handler = transport._handlers.get('push:prepare')
    if (!handler) throw new Error('push:prepare handler not registered')
    return handler({branch: 'main'}, 'client-1')
  }

  async function executePush(): Promise<PushExecuteResponse> {
    const handler = transport._handlers.get('push:execute')
    if (!handler) throw new Error('push:execute handler not registered')
    return handler({branch: 'main'}, 'client-1')
  }

  // ==================== handlePrepare tests ====================

  describe('handlePrepare – filtering', () => {
    it('should exclude files with pending review from fileCount', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['auth/jwt.md', 'auth/oauth.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      const result = await preparePush()
      expect(result.fileCount).to.equal(1)
      expect(result.hasChanges).to.be.true
      expect(result.excludedReviewCount).to.equal(1)
      expect(result.summary).to.equal('1 added')
    })

    it('should exclude files with rejected review from fileCount', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['auth/jwt.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'rejected',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      const result = await preparePush()
      expect(result.fileCount).to.equal(0)
      expect(result.hasChanges).to.be.false
      expect(result.excludedReviewCount).to.equal(1)
    })

    it('should include files with approved review in fileCount', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['auth/jwt.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'approved',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      const result = await preparePush()
      expect(result.fileCount).to.equal(1)
      expect(result.hasChanges).to.be.true
      expect(result.excludedReviewCount).to.equal(0)
    })

    it('should include files with no review status', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['auth/jwt.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([])

      const result = await preparePush()
      expect(result.fileCount).to.equal(1)
      expect(result.hasChanges).to.be.true
      expect(result.excludedReviewCount).to.equal(0)
    })

    it('should report hasChanges=false when all files are excluded', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['auth/jwt.md'],
        deleted: ['old/file.md'],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'ADD',
          },
          {
            filePath: '/test/project/.brv/context-tree/old/file.md',
            path: 'old/file',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      const result = await preparePush()
      expect(result.fileCount).to.equal(0)
      expect(result.hasChanges).to.be.false
      expect(result.excludedReviewCount).to.equal(2)
      expect(result.pendingReviewCount).to.equal(2)
    })

    it('should filter across added, modified, and deleted changes', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['new/file.md'],
        deleted: ['old/file.md'],
        modified: ['existing/file.md'],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/new/file.md',
            path: 'new/file',
            reviewStatus: 'approved',
            status: 'success',
            type: 'ADD',
          },
          {
            filePath: '/test/project/.brv/context-tree/old/file.md',
            path: 'old/file',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
          {
            filePath: '/test/project/.brv/context-tree/existing/file.md',
            path: 'existing/file',
            reviewStatus: 'rejected',
            status: 'success',
            type: 'UPDATE',
          },
        ]),
      ])

      const result = await preparePush()
      expect(result.fileCount).to.equal(1)
      expect(result.excludedReviewCount).to.equal(2)
      expect(result.summary).to.equal('1 added')
    })

    it('should use newest review status when same file has multiple entries', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['auth/jwt.md'],
        deleted: [],
        modified: [],
      })

      // Entries are returned newest-first; handler reverses to process oldest-first
      curateLogStore.list.resolves([
        // Newer entry: approved
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'approved',
            status: 'success',
            type: 'ADD',
          },
        ]),
        // Older entry: pending
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      const result = await preparePush()
      // Newest status is 'approved', so file should be included
      expect(result.fileCount).to.equal(1)
      expect(result.excludedReviewCount).to.equal(0)
    })

    it('should set excludedReviewCount to 0 when no reviews exist', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['a.md', 'b.md'],
        deleted: [],
        modified: [],
      })
      curateLogStore.list.resolves([])

      const result = await preparePush()
      expect(result.excludedReviewCount).to.equal(0)
      expect(result.fileCount).to.equal(2)
    })
  })

  // ==================== handleExecute tests ====================

  describe('handleExecute – filtering', () => {
    it('should only push files without pending/rejected review', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['approved.md', 'pending.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/pending.md',
            path: 'pending',
            reviewStatus: 'pending',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      contextFileReader.readMany.resolves([
        {content: 'Approved content', keywords: [], path: 'approved.md', tags: [], title: 'Approved'},
      ])

      const result = await executePush()
      expect(result.added).to.equal(1)

      // Verify readMany was called with only the approved file
      const readManyCalls = contextFileReader.readMany.getCalls()
      // First call is for added files
      expect(readManyCalls[0].args[0]).to.deep.equal(['approved.md'])
    })

    it('should not push deleted files with pending review', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: ['approved-del.md', 'pending-del.md'],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/approved-del.md',
            path: 'approved-del',
            reviewStatus: 'approved',
            status: 'success',
            type: 'DELETE',
          },
          {
            filePath: '/test/project/.brv/context-tree/pending-del.md',
            path: 'pending-del',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      const result = await executePush()
      expect(result.deleted).to.equal(1)

      // Verify push was called with only 1 context (the approved delete)
      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(1)
      expect(pushCall.args[0].contexts[0].path).to.equal('approved-del.md')
      expect(pushCall.args[0].contexts[0].operation).to.equal('delete')
    })

    it('should save snapshot selectively after push', async () => {
      createHandler()

      const oldSnapshot = new Map<string, FileState>([
        ['existing.md', {hash: 'old-hash', size: 100}],
      ])
      const currentState = new Map<string, FileState>([
        ['approved.md', {hash: 'approved-hash', size: 200}],
        ['existing.md', {hash: 'old-hash', size: 100}],
        ['pending.md', {hash: 'pending-hash', size: 300}],
      ])

      contextTreeSnapshotService.getSnapshotState.resolves(oldSnapshot)
      contextTreeSnapshotService.getCurrentState.resolves(currentState)

      contextTreeSnapshotService.getChanges.resolves({
        added: ['approved.md', 'pending.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/pending.md',
            path: 'pending',
            reviewStatus: 'pending',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      contextFileReader.readMany.callsFake((paths: string[]) =>
        Promise.resolve(
          paths.map((p) => ({content: 'Content', keywords: [], path: p, tags: [], title: 'Title'})),
        ),
      )

      await executePush()

      // Verify saveSnapshotFromState was called with selective state
      const saveCall = contextTreeSnapshotService.saveSnapshotFromState.getCall(0)
      const savedState = saveCall.args[0] as Map<string, FileState>

      // Should include existing + approved, but NOT pending
      expect(savedState.has('existing.md')).to.be.true
      expect(savedState.has('approved.md')).to.be.true
      expect(savedState.has('pending.md')).to.be.false
    })

    it('should remove deleted files from snapshot', async () => {
      createHandler()

      const oldSnapshot = new Map<string, FileState>([
        ['delete-approved.md', {hash: 'del-hash', size: 200}],
        ['delete-pending.md', {hash: 'del-pending-hash', size: 300}],
        ['keep.md', {hash: 'keep-hash', size: 100}],
      ])

      contextTreeSnapshotService.getSnapshotState.resolves(oldSnapshot)
      contextTreeSnapshotService.getCurrentState.resolves(
        new Map([['keep.md', {hash: 'keep-hash', size: 100}]]),
      )

      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: ['delete-approved.md', 'delete-pending.md'],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/delete-approved.md',
            path: 'delete-approved',
            reviewStatus: 'approved',
            status: 'success',
            type: 'DELETE',
          },
          {
            filePath: '/test/project/.brv/context-tree/delete-pending.md',
            path: 'delete-pending',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      await executePush()

      const saveCall = contextTreeSnapshotService.saveSnapshotFromState.getCall(0)
      const savedState = saveCall.args[0] as Map<string, FileState>

      // Approved delete should be removed from snapshot
      expect(savedState.has('delete-approved.md')).to.be.false
      // Pending delete should remain in snapshot (not pushed)
      expect(savedState.has('delete-pending.md')).to.be.true
      // Keep should remain
      expect(savedState.has('keep.md')).to.be.true
    })

    it('should clear backups for all pushed files after a successful push', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['new-file.md'],
        deleted: ['deleted-file.md'],
        modified: ['modified-file.md'],
      })

      contextFileReader.readMany.callsFake((paths: string[]) =>
        Promise.resolve(
          paths.map((p) => ({content: 'Content', keywords: [], path: p, tags: [], title: 'Title'})),
        ),
      )

      await executePush()

      expect(reviewBackupStore.delete.calledWith('new-file.md')).to.be.true
      expect(reviewBackupStore.delete.calledWith('deleted-file.md')).to.be.true
      expect(reviewBackupStore.delete.calledWith('modified-file.md')).to.be.true
    })

    it('should not clear backups for files excluded from push due to pending review', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['approved.md', 'pending.md'],
        deleted: [],
        modified: [],
      })

      curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/test/project/.brv/context-tree/pending.md',
            path: 'pending',
            reviewStatus: 'pending',
            status: 'success',
            type: 'ADD',
          },
        ]),
      ])

      contextFileReader.readMany.callsFake((paths: string[]) =>
        Promise.resolve(
          paths.map((p) => ({content: 'Content', keywords: [], path: p, tags: [], title: 'Title'})),
        ),
      )

      await executePush()

      expect(reviewBackupStore.delete.calledWith('approved.md')).to.be.true
      expect(reviewBackupStore.delete.calledWith('pending.md')).to.be.false
    })

    it('should gracefully handle curate log errors during execute', async () => {
      createHandler()

      contextTreeSnapshotService.getChanges.resolves({
        added: ['file.md'],
        deleted: [],
        modified: [],
      })

      // Both getFileReviewStatuses and buildReviewMetadata query the log
      curateLogStore.list.rejects(new Error('disk error'))

      contextFileReader.readMany.callsFake((paths: string[]) =>
        Promise.resolve(
          paths.map((p) => ({content: 'Content', keywords: [], path: p, tags: [], title: 'Title'})),
        ),
      )

      // Should still push all files when log is unavailable
      const result = await executePush()
      expect(result.added).to.equal(1)
    })
  })
})
