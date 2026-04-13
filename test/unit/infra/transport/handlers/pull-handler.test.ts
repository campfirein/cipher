import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {GitVcInitializedError, LegacySyncUnavailableError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {PullHandler} from '../../../../../src/server/infra/transport/handlers/pull-handler.js'
import {PullEvents} from '../../../../../src/shared/transport/events/pull-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

function assertLegacySyncError(error: unknown): void {
  expect(error).to.be.instanceOf(LegacySyncUnavailableError)
  const msg = (error as Error).message
  expect(msg).to.match(/brv vc init/)
  expect(msg).to.not.match(/space\s+(switch|list)/)
}

// ==================== Tests ====================

describe('PullHandler', () => {
  let contextTreeService: {hasGitRepo: SinonStub}
  let projectConfigStore: {exists: SinonStub; getModifiedTime: SinonStub; read: SinonStub; write: SinonStub}
  let resolveProjectPath: SinonStub
  let tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
  let transport: MockTransportServer

  beforeEach(() => {
    contextTreeService = {hasGitRepo: stub().resolves(false)}
    projectConfigStore = {exists: stub(), getModifiedTime: stub(), read: stub(), write: stub()}
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
      projectConfigStore: projectConfigStore as never,
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
        expect((error as Error).message).to.include('ByteRover version control')
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
        expect((error as Error).message).to.include('ByteRover version control')
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

  describe('legacy sync unavailable (ENG-2012)', () => {
    beforeEach(() => {
      contextTreeService.hasGitRepo.resolves(false)
      tokenStore.load.resolves({isValid: () => true, sessionKey: 'sess'})
    })

    it('PREPARE, no team+space, no .git → throws LegacySyncUnavailableError', async () => {
      projectConfigStore.read.resolves({})
      createHandler()

      try {
        await callPrepareHandler()
        expect.fail('should have thrown')
      } catch (error) {
        assertLegacySyncError(error)
      }
    })

    it('EXECUTE, no team+space, no .git → throws LegacySyncUnavailableError', async () => {
      projectConfigStore.read.resolves({})
      createHandler()

      try {
        await callExecuteHandler()
        expect.fail('should have thrown')
      } catch (error) {
        assertLegacySyncError(error)
      }
    })

    it('PREPARE, partial config (teamId only) → throws LegacySyncUnavailableError', async () => {
      projectConfigStore.read.resolves({teamId: 't1'})
      createHandler()

      try {
        await callPrepareHandler()
        expect.fail('should have thrown')
      } catch (error) {
        assertLegacySyncError(error)
      }
    })

    it('PREPARE, partial config (spaceId only) → throws LegacySyncUnavailableError', async () => {
      projectConfigStore.read.resolves({spaceId: 's1'})
      createHandler()

      try {
        await callPrepareHandler()
        expect.fail('should have thrown')
      } catch (error) {
        assertLegacySyncError(error)
      }
    })
  })
})
