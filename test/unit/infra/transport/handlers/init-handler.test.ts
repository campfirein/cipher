import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {GitVcInitializedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {InitHandler} from '../../../../../src/server/infra/transport/handlers/init-handler.js'
import {InitEvents} from '../../../../../src/shared/transport/events/init-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Tests ====================

describe('InitHandler', () => {
  let contextTreeService: {
    delete: SinonStub
    exists: SinonStub
    hasGitRepo: SinonStub
    initialize: SinonStub
    resolvePath: SinonStub
  }
  let projectConfigStore: {exists: SinonStub; getModifiedTime: SinonStub; read: SinonStub; write: SinonStub}
  let resolveProjectPath: SinonStub
  let tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
  let transport: MockTransportServer

  beforeEach(() => {
    contextTreeService = {
      delete: stub(),
      exists: stub().resolves(false),
      hasGitRepo: stub().resolves(false),
      initialize: stub().resolves('/test/.brv/context-tree'),
      resolvePath: stub().callsFake((p: string) => p),
    }
    projectConfigStore = {
      exists: stub().resolves(false),
      getModifiedTime: stub(),
      read: stub(),
      write: stub().resolves(),
    }
    resolveProjectPath = stub().returns('/test/project')
    tokenStore = {clear: stub(), load: stub(), save: stub()}
    transport = createMockTransportServer()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): void {
    const handler = new InitHandler({
      broadcastToProject: stub() as never,
      cogitPullService: {pull: stub()} as never,
      connectorManagerFactory: stub() as never,
      contextTreeService: contextTreeService as never,
      contextTreeSnapshotService: {
        getChanges: stub(),
        getCurrentState: stub(),
        getSnapshotState: stub(),
        hasSnapshot: stub(),
        initEmptySnapshot: stub(),
        saveSnapshot: stub(),
        saveSnapshotFromState: stub(),
      } as never,
      contextTreeWriterService: {sync: stub()} as never,
      projectConfigStore: projectConfigStore as never,
      resolveProjectPath,
      spaceService: {getSpaces: stub()} as never,
      teamService: {getTeams: stub()} as never,
      tokenStore: tokenStore as never,
      transport,
    })
    handler.setup()
  }

  const defaultExecuteData = {spaceId: 'space-1', teamId: 'team-1'}

  async function callExecuteHandler(
    data: Record<string, string> = defaultExecuteData,
    clientId = 'client-1',
  ): Promise<unknown> {
    const handler = transport._handlers.get(InitEvents.EXECUTE)
    expect(handler, 'init:execute handler should be registered').to.exist
    return handler!(data, clientId)
  }

  const defaultLocalData = {}

  async function callLocalInitHandler(data: Record<string, unknown> = defaultLocalData, clientId = 'client-1'): Promise<unknown> {
    const handler = transport._handlers.get(InitEvents.LOCAL)
    expect(handler, 'init:local handler should be registered').to.exist
    return handler!(data, clientId)
  }

  describe('git vc guard', () => {
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

    it('should throw GitVcInitializedError on local init when .git exists', async () => {
      contextTreeService.hasGitRepo.resolves(true)
      createHandler()

      try {
        await callLocalInitHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(GitVcInitializedError)
        expect((error as Error).message).to.include('Git-based version control')
      }
    })

    it('should not throw on execute when .git does not exist', async () => {
      contextTreeService.hasGitRepo.resolves(false)
      tokenStore.load.resolves()
      createHandler()

      try {
        await callExecuteHandler()
        expect.fail('should have thrown (auth error expected)')
      } catch (error) {
        expect(error).to.not.be.instanceOf(GitVcInitializedError)
      }

      expect(contextTreeService.hasGitRepo.calledOnce).to.be.true
    })

    it('should not throw on local init when .git does not exist', async () => {
      contextTreeService.hasGitRepo.resolves(false)
      createHandler()

      const result = await callLocalInitHandler()
      expect(result).to.have.property('success', true)
    })
  })
})
