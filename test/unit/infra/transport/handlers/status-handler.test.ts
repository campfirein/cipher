import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../../src/shared/transport/events/status-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

type ProjectInfoLike = {projectPath: string; registeredAt: number; sanitizedPath: string; storagePath: string}

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
  listContextTreeEntries: SinonStub
  projectConfigStore: {exists: SinonStub; getModifiedTime: SinonStub; read: SinonStub; write: SinonStub}
  projectRegistry: {get: SinonStub; getAll: SinonStub; register: SinonStub; unregister: SinonStub}
  tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
}

function makeProjectInfo(projectPath: string, registeredAt: number): ProjectInfoLike {
  return {projectPath, registeredAt, sanitizedPath: 'sanitized', storagePath: '/storage'}
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
    listContextTreeEntries: stub().resolves({domainCount: 0, fileCount: 0}),
    projectConfigStore: {
      exists: stub().resolves(false),
      getModifiedTime: stub().resolves(),
      read: stub(),
      write: stub(),
    },
    projectRegistry: {
      get: stub(),
      getAll: stub().returns(new Map()),
      register: stub(),
      unregister: stub(),
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
  })

  afterEach(() => {
    restore()
  })

  function createHandler(getActiveProjectPaths: () => string[] = () => []): StatusHandler {
    const handler = new StatusHandler({
      contextTreeService: deps.contextTreeService,
      contextTreeSnapshotService: deps.contextTreeSnapshotService,
      getActiveProjectPaths,
      listContextTreeEntries: deps.listContextTreeEntries,
      projectConfigStore: deps.projectConfigStore,
      projectRegistry: deps.projectRegistry,
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

  describe('locations — empty registry', () => {
    it('should return empty locations when registry has no projects', async () => {
      deps.projectRegistry.getAll.returns(new Map())
      createHandler()
      const result = await callGetHandler()
      expect(result.status.locations).to.deep.equal([])
    })
  })

  describe('locations — registry failure', () => {
    it('should return empty locations when projectRegistry.getAll throws', async () => {
      deps.projectRegistry.getAll.throws(new Error('registry failure'))
      createHandler()
      const result = await callGetHandler()
      expect(result.status.locations).to.deep.equal([])
    })
  })

  describe('locations — sort order', () => {
    it('should put current first, then active (has clients), then initialized, then rest', async () => {
      const currentPath = '/project/current'
      const activePath = '/project/active'
      const initializedPath = '/project/initialized'
      const inactivePath = '/project/inactive'

      const registry = new Map([
        [activePath, makeProjectInfo(activePath, 3000)],
        [currentPath, makeProjectInfo(currentPath, 4000)],
        [inactivePath, makeProjectInfo(inactivePath, 1000)],
        [initializedPath, makeProjectInfo(initializedPath, 2000)],
      ])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.callsFake(async (p?: string) => p === activePath || p === initializedPath)

      createHandler(() => [currentPath, activePath])
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations).to.have.lengthOf(4)
      expect(locations[0].projectPath).to.equal(currentPath)
      expect(locations[0].isCurrent).to.be.true
      expect(locations[1].projectPath).to.equal(activePath)
      expect(locations[1].isActive).to.be.true
      expect(locations[2].projectPath).to.equal(initializedPath)
      expect(locations[2].isInitialized).to.be.true
      expect(locations[2].isActive).to.be.false
      expect(locations[3].projectPath).to.equal(inactivePath)
    })

    it('should sort projects at same tier by registeredAt descending', async () => {
      const pathA = '/project/a'
      const pathB = '/project/b'

      const registry = new Map([
        [pathA, makeProjectInfo(pathA, 1000)],
        [pathB, makeProjectInfo(pathB, 2000)],
      ])
      deps.projectRegistry.getAll.returns(registry)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].projectPath).to.equal(pathB)
      expect(locations[1].projectPath).to.equal(pathA)
    })
  })

  describe('locations — isActive flag', () => {
    it('should set isActive=true for projects with connected clients (excluding current)', async () => {
      const activePath = '/project/active'
      const registry = new Map([[activePath, makeProjectInfo(activePath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler(() => [activePath])
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].isActive).to.be.true
      expect(locations[0].isCurrent).to.be.false
    })

    it('should NOT set isActive for the current project even if it appears in getActiveProjectPaths', async () => {
      const currentPath = '/project/current'
      const registry = new Map([[currentPath, makeProjectInfo(currentPath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      // current project is in active list — should still be isCurrent=true, isActive=false
      createHandler(() => [currentPath])
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].isCurrent).to.be.true
      expect(locations[0].isActive).to.be.false
    })

    it('should set isActive=false when getActiveProjectPaths returns empty array', async () => {
      const registry = new Map([['/project/a', makeProjectInfo('/project/a', 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].isActive).to.be.false
    })
  })

  describe('locations — other flags', () => {
    it('should mark project matching current projectPath as isCurrent', async () => {
      const registry = new Map([['/project/current', makeProjectInfo('/project/current', 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].isCurrent).to.be.true
      expect(locations[0].projectPath).to.equal('/project/current')
    })

    it('should set isInitialized based on contextTreeService.exists()', async () => {
      const registry = new Map([
        ['/project/initialized', makeProjectInfo('/project/initialized', 2000)],
        ['/project/not-init', makeProjectInfo('/project/not-init', 1000)],
      ])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.callsFake(async (p?: string) => p === '/project/initialized')

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      const initialized = locations.find((l) => l.projectPath === '/project/initialized')
      const notInit = locations.find((l) => l.projectPath === '/project/not-init')

      expect(initialized?.isInitialized).to.be.true
      expect(notInit?.isInitialized).to.be.false
    })

    it('should call contextTreeService.exists() a second time in buildLocations when collectStatus threw', async () => {
      const registry = new Map([['/project/current', makeProjectInfo('/project/current', 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      // First call (in collectStatus) throws → contextTreeExists stays undefined
      deps.contextTreeService.exists.onFirstCall().rejects(new Error('FS error'))
      // Second call (in buildLocations) resolves → isInitialized should be true
      deps.contextTreeService.exists.onSecondCall().resolves(true)
      deps.listContextTreeEntries.resolves({domainCount: 2, fileCount: 5})

      createHandler()
      const result = await callGetHandler()

      expect(deps.contextTreeService.exists.callCount).to.equal(2)
      expect(result.status.locations[0].isInitialized).to.be.true
    })

    it('should not call contextTreeService.exists() a second time for the current project in buildLocations', async () => {
      const registry = new Map([['/project/current', makeProjectInfo('/project/current', 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.resolves(true)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      // exists() is called once from collectStatus(); buildLocations() must reuse that value
      expect(deps.contextTreeService.exists.callCount).to.equal(1)
      expect(locations[0].isInitialized).to.be.true
    })
  })

  describe('locations — counts when not initialized', () => {
    it('should return domainCount=0 and fileCount=0 when not initialized', async () => {
      const registry = new Map([['/project/a', makeProjectInfo('/project/a', 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.resolves(false)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].domainCount).to.equal(0)
      expect(locations[0].fileCount).to.equal(0)
      expect(deps.listContextTreeEntries.called).to.be.false
    })
  })

  describe('locations — counts when initialized', () => {
    it('should return counts from listContextTreeEntries when initialized', async () => {
      const projectPath = '/project/initialized'
      const registry = new Map([[projectPath, makeProjectInfo(projectPath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.resolves(true)
      deps.listContextTreeEntries.resolves({domainCount: 2, fileCount: 3})
      resolveProjectPath.returns('/some/other/path')

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].domainCount).to.equal(2)
      expect(locations[0].fileCount).to.equal(3)
    })

    it('should return domainCount=0 and fileCount=0 when listContextTreeEntries throws (ENOENT)', async () => {
      const projectPath = '/project/initialized'
      const registry = new Map([[projectPath, makeProjectInfo(projectPath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.resolves(true)
      deps.listContextTreeEntries.rejects(new Error('ENOENT'))
      resolveProjectPath.returns('/some/other/path')

      createHandler()
      const result = await callGetHandler()
      const {locations} = result.status

      expect(locations[0].domainCount).to.equal(0)
      expect(locations[0].fileCount).to.equal(0)
    })
  })
})
