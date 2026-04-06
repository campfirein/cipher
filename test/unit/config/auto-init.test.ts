import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {stub} from 'sinon'

import type {IContextTreeService} from '../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {ensureProjectInitialized} from '../../../src/server/infra/config/auto-init.js'

describe('ensureProjectInitialized', () => {
  let existsStub: SinonStub
  let writeStub: SinonStub
  let initializeStub: SinonStub
  let mockConfigStore: IProjectConfigStore
  let mockContextTreeService: IContextTreeService

  beforeEach(() => {
    existsStub = stub()
    writeStub = stub().resolves()
    initializeStub = stub().resolves()

    mockConfigStore = {
      exists: existsStub,
      getModifiedTime: stub(),
      read: stub(),
      write: writeStub,
    }

    mockContextTreeService = {
      delete: stub().resolves(),
      exists: stub().resolves(false),
      hasGitRepo: stub().resolves(false),
      initialize: initializeStub,
      resolvePath: stub().returns(''),
    }
  })

  it('should do nothing if project already exists', async () => {
    existsStub.resolves(true)

    await ensureProjectInitialized({
      contextTreeService: mockContextTreeService,
      projectConfigStore: mockConfigStore,
    })

    expect(writeStub.called).to.be.false
    expect(initializeStub.called).to.be.false
  })

  it('should create config and context tree when project does not exist', async () => {
    existsStub.resolves(false)

    await ensureProjectInitialized({
      contextTreeService: mockContextTreeService,
      projectConfigStore: mockConfigStore,
    })

    expect(writeStub.calledOnce).to.be.true
    expect(initializeStub.calledOnce).to.be.true

    // Verify the config written is a local-only BrvConfig
    const writtenConfig = writeStub.firstCall.args[0]
    expect(writtenConfig.cwd).to.be.a('string')
    expect(writtenConfig.version).to.be.a('string')
    expect(writtenConfig.createdAt).to.be.a('string')
    expect(writtenConfig.spaceId).to.be.undefined
    expect(writtenConfig.teamId).to.be.undefined
  })

  it('should pass directory parameter to all services', async () => {
    existsStub.resolves(false)

    await ensureProjectInitialized(
      {
        contextTreeService: mockContextTreeService,
        projectConfigStore: mockConfigStore,
      },
      '/custom/dir',
    )

    expect(existsStub.firstCall.args[0]).to.equal('/custom/dir')
    expect(writeStub.firstCall.args[1]).to.equal('/custom/dir')
    expect(initializeStub.firstCall.args[0]).to.equal('/custom/dir')
  })
})
