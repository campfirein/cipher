import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ProjectLocationDTO} from '../../../../../src/shared/transport/types/dto.js'

import {LocationsHandler} from '../../../../../src/server/infra/transport/handlers/locations-handler.js'
import {LocationsEvents} from '../../../../../src/shared/transport/events/locations-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

type ProjectInfoLike = {projectPath: string; registeredAt: number; sanitizedPath: string; storagePath: string}

type TestDeps = {
  contextTreeService: {delete: SinonStub; exists: SinonStub; initialize: SinonStub}
  listContextTreeEntries: SinonStub
  projectRegistry: {get: SinonStub; getAll: SinonStub; register: SinonStub; unregister: SinonStub}
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
    listContextTreeEntries: stub().resolves({domainCount: 0, fileCount: 0}),
    projectRegistry: {
      get: stub(),
      getAll: stub().returns(new Map()),
      register: stub(),
      unregister: stub(),
    },
  }
}

// ==================== Tests ====================

describe('LocationsHandler', () => {
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

  function createHandler(getActiveProjectPaths: () => string[] = () => []): LocationsHandler {
    const handler = new LocationsHandler({
      contextTreeService: deps.contextTreeService,
      getActiveProjectPaths,
      listContextTreeEntries: deps.listContextTreeEntries,
      projectRegistry: deps.projectRegistry,
      resolveProjectPath,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callGetHandler(clientId = 'client-1'): Promise<{locations: ProjectLocationDTO[]}> {
    const handler = transport._handlers.get(LocationsEvents.GET)
    expect(handler, 'locations:get handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  describe('setup', () => {
    it('should register locations:get handler', () => {
      createHandler()
      expect(transport.onRequest.calledOnce).to.be.true
      expect(transport.onRequest.firstCall.args[0]).to.equal(LocationsEvents.GET)
    })
  })

  describe('empty registry', () => {
    it('should return empty locations when registry has no projects', async () => {
      deps.projectRegistry.getAll.returns(new Map())
      createHandler()
      const result = await callGetHandler()
      expect(result.locations).to.deep.equal([])
    })
  })

  describe('registry failure', () => {
    it('should return empty locations when projectRegistry.getAll throws', async () => {
      deps.projectRegistry.getAll.throws(new Error('registry failure'))
      createHandler()
      const result = await callGetHandler()
      expect(result.locations).to.deep.equal([])
    })
  })

  describe('sort order', () => {
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
      const {locations} = result

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
      const {locations} = result

      expect(locations[0].projectPath).to.equal(pathB)
      expect(locations[1].projectPath).to.equal(pathA)
    })
  })

  describe('isActive flag', () => {
    it('should set isActive=true for projects with connected clients (excluding current)', async () => {
      const activePath = '/project/active'
      const registry = new Map([[activePath, makeProjectInfo(activePath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler(() => [activePath])
      const result = await callGetHandler()
      const {locations} = result

      expect(locations[0].isActive).to.be.true
      expect(locations[0].isCurrent).to.be.false
    })

    it('should NOT set isActive for the current project even if it appears in getActiveProjectPaths', async () => {
      const currentPath = '/project/current'
      const registry = new Map([[currentPath, makeProjectInfo(currentPath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler(() => [currentPath])
      const result = await callGetHandler()
      const {locations} = result

      expect(locations[0].isCurrent).to.be.true
      expect(locations[0].isActive).to.be.false
    })

    it('should set isActive=false when getActiveProjectPaths returns empty array', async () => {
      const registry = new Map([['/project/a', makeProjectInfo('/project/a', 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result

      expect(locations[0].isActive).to.be.false
    })
  })

  describe('other flags', () => {
    it('should mark project matching current projectPath as isCurrent', async () => {
      const registry = new Map([['/project/current', makeProjectInfo('/project/current', 1000)]])
      deps.projectRegistry.getAll.returns(registry)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result

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
      const {locations} = result

      const initialized = locations.find((l) => l.projectPath === '/project/initialized')
      const notInit = locations.find((l) => l.projectPath === '/project/not-init')

      expect(initialized?.isInitialized).to.be.true
      expect(notInit?.isInitialized).to.be.false
    })
  })

  describe('counts when not initialized', () => {
    it('should return domainCount=0 and fileCount=0 when not initialized', async () => {
      const registry = new Map([['/project/a', makeProjectInfo('/project/a', 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.resolves(false)

      createHandler()
      const result = await callGetHandler()
      const {locations} = result

      expect(locations[0].domainCount).to.equal(0)
      expect(locations[0].fileCount).to.equal(0)
      expect(deps.listContextTreeEntries.called).to.be.false
    })
  })

  describe('counts when initialized', () => {
    it('should return counts from listContextTreeEntries when initialized', async () => {
      const projectPath = '/project/initialized'
      const registry = new Map([[projectPath, makeProjectInfo(projectPath, 1000)]])
      deps.projectRegistry.getAll.returns(registry)
      deps.contextTreeService.exists.resolves(true)
      deps.listContextTreeEntries.resolves({domainCount: 2, fileCount: 3})
      resolveProjectPath.returns('/some/other/path')

      createHandler()
      const result = await callGetHandler()
      const {locations} = result

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
      const {locations} = result

      expect(locations[0].domainCount).to.equal(0)
      expect(locations[0].fileCount).to.equal(0)
    })
  })
})
