import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {GitVcInitializedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../../src/shared/transport/events/status-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

type TestDeps = {
  contextTreeService: {delete: SinonStub; exists: SinonStub; hasGitRepo: SinonStub; initialize: SinonStub; resolvePath: SinonStub}
  contextTreeSnapshotService: {
    getChanges: SinonStub
    getCurrentState: SinonStub
    getSnapshotState: SinonStub
    hasSnapshot: SinonStub
    initEmptySnapshot: SinonStub
    saveSnapshot: SinonStub
    saveSnapshotFromState: SinonStub
  }
  projectConfigStore: {exists: SinonStub; getModifiedTime: SinonStub; read: SinonStub; write: SinonStub}
  tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
}

function makeStubs(): TestDeps {
  return {
    contextTreeService: {
      delete: stub(),
      exists: stub().resolves(false),
      hasGitRepo: stub().resolves(false),
      initialize: stub(),
      resolvePath: stub().callsFake((p: string) => p),
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

  describe('git vc guard', () => {
    it('should throw GitVcInitializedError when .git exists in context tree', async () => {
      deps.contextTreeService.hasGitRepo.resolves(true)
      createHandler()

      try {
        await callGetHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(GitVcInitializedError)
      }
    })

    it('should proceed normally when .git does not exist', async () => {
      deps.contextTreeService.hasGitRepo.resolves(false)
      createHandler()

      const result = await callGetHandler()
      expect(result.status).to.exist
    })
  })
})
