import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {GitVcInitializedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {PullHandler} from '../../../../../src/server/infra/transport/handlers/pull-handler.js'
import {PullEvents} from '../../../../../src/shared/transport/events/pull-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Tests ====================

describe('PullHandler', () => {
  let contextTreeService: {hasGitRepo: SinonStub}
  let resolveProjectPath: SinonStub
  let tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
  let transport: MockTransportServer

  beforeEach(() => {
    contextTreeService = {hasGitRepo: stub().resolves(false)}
    resolveProjectPath = stub().returns('/test/project')
    tokenStore = {clear: stub(), load: stub(), save: stub()}
    transport = createMockTransportServer()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): void {
    const handler = new PullHandler({
      broadcastToProject: stub() as never,
      cogitPullService: {pull: stub()} as never,
      contextTreeService: contextTreeService as never,
      contextTreeSnapshotService: {
        getChanges: stub().resolves({added: [], deleted: [], modified: []}),
        getCurrentState: stub(),
        getSnapshotState: stub(),
        hasSnapshot: stub(),
        initEmptySnapshot: stub(),
        saveSnapshot: stub(),
        saveSnapshotFromState: stub(),
      } as never,
      contextTreeWriterService: {sync: stub()} as never,
      projectConfigStore: {exists: stub(), getModifiedTime: stub(), read: stub(), write: stub()} as never,
      resolveProjectPath,
      tokenStore: tokenStore as never,
      transport,
    })
    handler.setup()
  }

  async function callPrepareHandler(clientId = 'client-1'): Promise<unknown> {
    const handler = transport._handlers.get(PullEvents.PREPARE)
    expect(handler, 'pull:prepare handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  async function callExecuteHandler(clientId = 'client-1'): Promise<unknown> {
    const handler = transport._handlers.get(PullEvents.EXECUTE)
    expect(handler, 'pull:execute handler should be registered').to.exist
    return handler!({branch: 'main'}, clientId)
  }

  describe('git vc guard', () => {
    it('should throw GitVcInitializedError on prepare when .git exists', async () => {
      contextTreeService.hasGitRepo.resolves(true)
      createHandler()

      try {
        await callPrepareHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(GitVcInitializedError)
        expect((error as Error).message).to.include('Git-based version control')
      }
    })

    it('should throw GitVcInitializedError on execute when .git exists', async () => {
      contextTreeService.hasGitRepo.resolves(true)
      createHandler()

      try {
        await callExecuteHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(GitVcInitializedError)
        expect((error as Error).message).to.include('Git-based version control')
      }
    })

    it('should not throw GitVcInitializedError on prepare when .git does not exist', async () => {
      contextTreeService.hasGitRepo.resolves(false)
      tokenStore.load.resolves()
      createHandler()

      try {
        await callPrepareHandler()
        expect.fail('should have thrown (auth error expected)')
      } catch (error) {
        expect(error).to.not.be.instanceOf(GitVcInitializedError)
      }

      expect(contextTreeService.hasGitRepo.calledOnce).to.be.true
    })
  })
})
