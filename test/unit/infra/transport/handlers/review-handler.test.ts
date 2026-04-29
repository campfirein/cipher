import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ICurateLogStore} from '../../../../../src/server/core/interfaces/storage/i-curate-log-store.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {IReviewBackupStore} from '../../../../../src/server/core/interfaces/storage/i-review-backup-store.js'

import {BRV_CONFIG_VERSION} from '../../../../../src/server/constants.js'
import {BrvConfig} from '../../../../../src/server/core/domain/entities/brv-config.js'
import {ReviewHandler} from '../../../../../src/server/infra/transport/handlers/review-handler.js'
import {ReviewEvents} from '../../../../../src/shared/transport/events/review-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

describe('ReviewHandler — config toggle (GET_DISABLED / SET_DISABLED)', () => {
  let resolveProjectPath: SinonStub
  let transport: MockTransportServer
  let projectConfigStore: Partial<IProjectConfigStore> & {read: SinonStub; write: SinonStub}
  let curateLogStoreFactory: SinonStub
  let reviewBackupStoreFactory: SinonStub

  beforeEach(() => {
    resolveProjectPath = stub().returns('/test/project')
    transport = createMockTransportServer()
    projectConfigStore = {
      read: stub(),
      write: stub().resolves(),
    }
    curateLogStoreFactory = stub().returns({} as ICurateLogStore)
    reviewBackupStoreFactory = stub().returns({} as IReviewBackupStore)
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): ReviewHandler {
    const handler = new ReviewHandler({
      curateLogStoreFactory,
      projectConfigStore: projectConfigStore as IProjectConfigStore,
      resolveProjectPath,
      reviewBackupStoreFactory,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callGetDisabled(clientId = 'client-1'): Promise<{reviewDisabled: boolean}> {
    const handler = transport._handlers.get(ReviewEvents.GET_DISABLED)
    expect(handler, 'review:getDisabled handler should be registered').to.exist
    return handler!({}, clientId) as Promise<{reviewDisabled: boolean}>
  }

  async function callSetDisabled(
    reviewDisabled: boolean,
    clientId = 'client-1',
  ): Promise<{reviewDisabled: boolean}> {
    const handler = transport._handlers.get(ReviewEvents.SET_DISABLED)
    expect(handler, 'review:setDisabled handler should be registered').to.exist
    return handler!({reviewDisabled}, clientId) as Promise<{reviewDisabled: boolean}>
  }

  describe('setup', () => {
    it('registers review:getDisabled and review:setDisabled handlers', () => {
      createHandler()
      expect(transport._handlers.has(ReviewEvents.GET_DISABLED)).to.be.true
      expect(transport._handlers.has(ReviewEvents.SET_DISABLED)).to.be.true
    })
  })

  describe('handleGetDisabled', () => {
    it('returns reviewDisabled=false when config has no flag', async () => {
      projectConfigStore.read.resolves(BrvConfig.createLocal({cwd: '/test/project'}))
      createHandler()

      const response = await callGetDisabled()
      expect(response.reviewDisabled).to.equal(false)
    })

    it('returns reviewDisabled=true when config has the flag set', async () => {
      projectConfigStore.read.resolves(
        new BrvConfig({createdAt: '2025-01-01T00:00:00.000Z', cwd: '/test/project', reviewDisabled: true, version: BRV_CONFIG_VERSION}),
      )
      createHandler()

      const response = await callGetDisabled()
      expect(response.reviewDisabled).to.equal(true)
    })

    it('throws when project is not initialized', async () => {
      projectConfigStore.read.resolves()
      createHandler()

      let threw = false
      try {
        await callGetDisabled()
      } catch (error) {
        threw = true
        expect(String(error)).to.match(/not initialized/i)
      }

      expect(threw, 'should throw when config is missing').to.be.true
    })
  })

  describe('handleSetDisabled', () => {
    it('writes reviewDisabled=true while preserving other config fields', async () => {
      const original = new BrvConfig({
        chatLogPath: '/path/chat.log',
        createdAt: '2025-01-01T00:00:00.000Z',
        cwd: '/test/project',
        ide: 'Claude Code',
        spaceId: 'space-1',
        spaceName: 'space',
        teamId: 'team-1',
        teamName: 'team',
        version: BRV_CONFIG_VERSION,
      })
      projectConfigStore.read.resolves(original)
      createHandler()

      const response = await callSetDisabled(true)

      expect(response.reviewDisabled).to.equal(true)
      expect(projectConfigStore.write.calledOnce).to.be.true
      const written: BrvConfig = projectConfigStore.write.firstCall.args[0]
      expect(written.reviewDisabled).to.equal(true)
      expect(written.spaceId).to.equal('space-1')
      expect(written.teamId).to.equal('team-1')
      expect(written.chatLogPath).to.equal('/path/chat.log')
      expect(projectConfigStore.write.firstCall.args[1]).to.equal('/test/project')
    })

    it('writes reviewDisabled=false when re-enabling', async () => {
      projectConfigStore.read.resolves(
        new BrvConfig({createdAt: '2025-01-01T00:00:00.000Z', cwd: '/test/project', reviewDisabled: true, version: BRV_CONFIG_VERSION}),
      )
      createHandler()

      const response = await callSetDisabled(false)

      expect(response.reviewDisabled).to.equal(false)
      const written: BrvConfig = projectConfigStore.write.firstCall.args[0]
      expect(written.reviewDisabled).to.equal(false)
    })

    it('throws when project is not initialized', async () => {
      projectConfigStore.read.resolves()
      createHandler()

      let threw = false
      try {
        await callSetDisabled(true)
      } catch (error) {
        threw = true
        expect(String(error)).to.match(/not initialized/i)
      }

      expect(threw, 'should throw when config is missing').to.be.true
      expect(projectConfigStore.write.called).to.be.false
    })
  })
})
