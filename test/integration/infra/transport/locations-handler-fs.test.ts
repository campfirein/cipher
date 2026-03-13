import {expect} from 'chai'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stub} from 'sinon'

import {LocationsHandler} from '../../../../src/server/infra/transport/handlers/locations-handler.js'
import {LocationsEvents} from '../../../../src/shared/transport/events/locations-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../helpers/mock-factories.js'

// ==================== LocationsHandler (real FS) ====================
// These tests exercise the handler with real filesystem to verify isInitialized detection.

describe('LocationsHandler — real FS', () => {
  let projectPath: string

  afterEach(async () => {
    if (projectPath) {
      await rm(projectPath, {force: true, recursive: true})
    }
  })

  function makeRealHandler(transport: MockTransportServer): LocationsHandler {
    const registry = new Map([[projectPath, {projectPath, registeredAt: 1000, sanitizedPath: 's', storagePath: '/s'}]])
    const contextTreeService = {delete: stub(), exists: stub().resolves(true), initialize: stub()}
    const projectRegistry = {get: stub(), getAll: stub().returns(registry), register: stub(), unregister: stub()}
    const resolveProjectPath = stub().returns(projectPath)

    const handler = new LocationsHandler({
      contextTreeService,
      getActiveProjectPaths: () => [],
      projectRegistry,
      resolveProjectPath,
      transport,
    })
    handler.setup()
    return handler
  }

  it('should return isInitialized=true when context tree exists', async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'brv-ct-test-'))
    await mkdir(join(projectPath, '.brv', 'context-tree', 'domain1'), {recursive: true})

    const transport = createMockTransportServer()
    makeRealHandler(transport)

    const getHandler = transport._handlers.get(LocationsEvents.GET)
    const result = await getHandler!(undefined, 'client-1')

    expect(result.locations[0].isInitialized).to.be.true
    expect(result.locations[0].projectPath).to.equal(projectPath)
  })

  it('should return isInitialized=true for an empty context-tree directory', async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'brv-ct-empty-'))
    await mkdir(join(projectPath, '.brv', 'context-tree'), {recursive: true})

    const transport = createMockTransportServer()
    makeRealHandler(transport)

    const getHandler = transport._handlers.get(LocationsEvents.GET)
    const result = await getHandler!(undefined, 'client-1')

    expect(result.locations[0].isInitialized).to.be.true
  })
})
