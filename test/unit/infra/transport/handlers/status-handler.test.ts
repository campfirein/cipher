import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {CurateLogEntry} from '../../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../../src/shared/transport/events/status-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

type TestDeps = {
  contextTreeService: {delete: SinonStub; exists: SinonStub; initialize: SinonStub}
  contextTreeSnapshotService: {
    getChanges: SinonStub
    getCurrentState: SinonStub
    getSnapshotState: SinonStub
    hasSnapshot: SinonStub
    initEmptySnapshot: SinonStub
    saveSnapshot: SinonStub
    saveSnapshotFromState: SinonStub
  }
  curateLogStore: {
    batchUpdateOperationReviewStatus: SinonStub
    getById: SinonStub
    getNextId: SinonStub
    list: SinonStub
    save: SinonStub
  }
  projectConfigStore: {exists: SinonStub; getModifiedTime: SinonStub; read: SinonStub; write: SinonStub}
  tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
}

function makeStubs(): TestDeps {
  return {
    contextTreeService: {
      delete: stub(),
      exists: stub().resolves(false),
      initialize: stub(),
    },
    contextTreeSnapshotService: {
      getChanges: stub().resolves({added: [], deleted: [], modified: []}),
      getCurrentState: stub(),
      getSnapshotState: stub(),
      hasSnapshot: stub().resolves(true),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
      saveSnapshotFromState: stub(),
    },
    curateLogStore: {
      batchUpdateOperationReviewStatus: stub().resolves(true),
      getById: stub().resolves(null),
      getNextId: stub().resolves('cur-1'),
      list: stub().resolves([]),
      save: stub().resolves(),
    },
    projectConfigStore: {
      exists: stub().resolves(false),
      getModifiedTime: stub().resolves(),
      read: stub(),
      write: stub(),
    },
    tokenStore: {
      clear: stub(),
      load: stub().resolves(),
      save: stub(),
    },
  }
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

describe('StatusHandler', () => {
  let deps: TestDeps
  let resolveProjectPath: SinonStub
  let transport: MockTransportServer

  beforeEach(() => {
    deps = makeStubs()
    resolveProjectPath = stub().returns('/project/current')
    transport = createMockTransportServer()
    stub(console, 'error')
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): StatusHandler {
    const handler = new StatusHandler({
      contextTreeService: deps.contextTreeService,
      contextTreeSnapshotService: deps.contextTreeSnapshotService,
      curateLogStoreFactory: () => deps.curateLogStore,
      projectConfigStore: deps.projectConfigStore,
      resolveProjectPath,
      tokenStore: deps.tokenStore,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callGetHandler(clientId = 'client-1'): Promise<{status: StatusDTO}> {
    const handler = transport._handlers.get(StatusEvents.GET)
    expect(handler, 'status:get handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  describe('setup', () => {
    it('should register status:get handler', () => {
      createHandler()
      expect(transport.onRequest.calledOnce).to.be.true
      expect(transport.onRequest.firstCall.args[0]).to.equal(StatusEvents.GET)
    })
  })

  describe('auth status', () => {
    it('should return not_logged_in when no token', async () => {
      deps.tokenStore.load.resolves()
      createHandler()
      const result = await callGetHandler()
      expect(result.status.authStatus).to.equal('not_logged_in')
    })

    it('should return logged_in with email when token is valid', async () => {
      deps.tokenStore.load.resolves({isValid: () => true, userEmail: 'user@test.com'})
      createHandler()
      const result = await callGetHandler()
      expect(result.status.authStatus).to.equal('logged_in')
      expect(result.status.userEmail).to.equal('user@test.com')
    })

    it('should return expired when token is invalid', async () => {
      deps.tokenStore.load.resolves({isValid: () => false, userEmail: 'user@test.com'})
      createHandler()
      const result = await callGetHandler()
      expect(result.status.authStatus).to.equal('expired')
    })

    it('should return unknown when tokenStore.load throws', async () => {
      deps.tokenStore.load.rejects(new Error('keychain error'))
      createHandler()
      const result = await callGetHandler()
      expect(result.status.authStatus).to.equal('unknown')
    })
  })

  describe('context tree status', () => {
    it('should return not_initialized when context tree does not exist', async () => {
      deps.contextTreeService.exists.resolves(false)
      createHandler()
      const result = await callGetHandler()
      expect(result.status.contextTreeStatus).to.equal('not_initialized')
    })

    it('should return no_changes when context tree exists with no changes', async () => {
      deps.contextTreeService.exists.resolves(true)
      deps.contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      createHandler()
      const result = await callGetHandler()
      expect(result.status.contextTreeStatus).to.equal('no_changes')
    })

    it('should return has_changes when there are changes', async () => {
      deps.contextTreeService.exists.resolves(true)
      deps.contextTreeSnapshotService.getChanges.resolves({added: ['new.md'], deleted: [], modified: []})
      createHandler()
      const result = await callGetHandler()
      expect(result.status.contextTreeStatus).to.equal('has_changes')
    })

    it('should return unknown when contextTreeService.exists throws', async () => {
      deps.contextTreeService.exists.rejects(new Error('FS error'))
      createHandler()
      const result = await callGetHandler()
      expect(result.status.contextTreeStatus).to.equal('unknown')
    })
  })

  describe('pending review', () => {
    it('should include pendingReviewCount when curate log has pending ops', async () => {
      transport.getPort.returns(54_321)
      createHandler()

      deps.curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/project/current/.brv/context-tree/auth/jwt.md',
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
          {
            filePath: '/project/current/.brv/context-tree/auth/oauth.md',
            needsReview: true,
            path: 'auth/oauth',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      const result = await callGetHandler()
      expect(result.status.pendingReviewCount).to.equal(2)
    })

    it('should include reviewUrl when pending reviews exist', async () => {
      transport.getPort.returns(54_321)
      createHandler()

      deps.curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/project/current/.brv/context-tree/auth/jwt.md',
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      const result = await callGetHandler()
      expect(result.status.reviewUrl).to.be.a('string')
      expect(result.status.reviewUrl).to.include('http://127.0.0.1:54321/review?project=')
    })

    it('should NOT include pendingReviewCount when no pending ops exist', async () => {
      createHandler()

      deps.curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/project/current/.brv/context-tree/auth/jwt.md',
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'approved',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      const result = await callGetHandler()
      expect(result.status.pendingReviewCount).to.be.undefined
      expect(result.status.reviewUrl).to.be.undefined
    })

    it('should NOT include pendingReviewCount when curate log is empty', async () => {
      createHandler()
      deps.curateLogStore.list.resolves([])

      const result = await callGetHandler()
      expect(result.status.pendingReviewCount).to.be.undefined
    })

    it('should count unique files, not operations', async () => {
      transport.getPort.returns(54_321)
      createHandler()

      // Same file appears in two entries
      deps.curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/project/current/.brv/context-tree/auth/jwt.md',
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
        makeCompletedEntry([
          {
            filePath: '/project/current/.brv/context-tree/auth/jwt.md',
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'UPDATE',
          },
        ]),
      ])

      const result = await callGetHandler()
      expect(result.status.pendingReviewCount).to.equal(1)
    })

    it('should detect pending ops even when needsReview is undefined', async () => {
      transport.getPort.returns(54_321)
      createHandler()

      deps.curateLogStore.list.resolves([
        makeCompletedEntry([
          {
            filePath: '/project/current/.brv/context-tree/auth/jwt.md',
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ]),
      ])

      const result = await callGetHandler()
      expect(result.status.pendingReviewCount).to.equal(1)
      expect(result.status.reviewUrl).to.be.a('string')
    })

    it('should gracefully handle curate log errors', async () => {
      createHandler()
      deps.curateLogStore.list.rejects(new Error('disk error'))

      const result = await callGetHandler()
      // Should still return valid status without review fields
      expect(result.status.pendingReviewCount).to.be.undefined
      expect(result.status.reviewUrl).to.be.undefined
      expect(result.status.currentDirectory).to.equal('/project/current')
    })
  })
})
