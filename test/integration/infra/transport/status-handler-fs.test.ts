import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stub} from 'sinon'

import {StatusHandler} from '../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../src/shared/transport/events/status-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../helpers/mock-factories.js'

// ==================== defaultListContextTreeEntries (real FS) ====================
// These tests exercise the real readdir-based implementation by not injecting listContextTreeEntries.
// The handler computes ctDir = join(projectPath, '.brv', 'context-tree'), so we create the
// full directory structure under a tmpdir.

describe('StatusHandler — default listContextTreeEntries', () => {
  let projectPath: string

  afterEach(async () => {
    await rm(projectPath, {force: true, recursive: true})
  })

  function makeRealHandler(transport: MockTransportServer): StatusHandler {
    const registry = new Map([[projectPath, {projectPath, registeredAt: 1000, sanitizedPath: 's', storagePath: '/s'}]])
    const contextTreeService = {delete: stub(), exists: stub().resolves(true), initialize: stub()}
    const contextTreeSnapshotService = {
      getChanges: stub().resolves({added: [], deleted: [], modified: []}),
      getCurrentState: stub(),
      getSnapshotState: stub(),
      hasSnapshot: stub().resolves(true),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
      saveSnapshotFromState: stub(),
    }
    const projectConfigStore = {
      exists: stub().resolves(false),
      getModifiedTime: stub().resolves(),
      read: stub(),
      write: stub(),
    }
    const projectRegistry = {get: stub(), getAll: stub().returns(registry), register: stub(), unregister: stub()}
    const tokenStore = {clear: stub(), load: stub().resolves(), save: stub()}
    const resolveProjectPath = stub().returns(projectPath)

    // No listContextTreeEntries injected — uses the real default readdir implementation
    const handler = new StatusHandler({
      contextTreeService,
      contextTreeSnapshotService,
      getActiveProjectPaths: () => [],
      projectConfigStore,
      projectRegistry,
      resolveProjectPath,
      tokenStore,
      transport,
    })
    handler.setup()
    return handler
  }

  it('should count top-level directories as domains and .md files recursively', async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'brv-ct-test-'))
    // Create .brv/context-tree/domain1/{file1.md,file2.md} and domain2/file3.md
    await mkdir(join(projectPath, '.brv', 'context-tree', 'domain1'), {recursive: true})
    await writeFile(join(projectPath, '.brv', 'context-tree', 'domain1', 'file1.md'), '')
    await writeFile(join(projectPath, '.brv', 'context-tree', 'domain1', 'file2.md'), '')
    await mkdir(join(projectPath, '.brv', 'context-tree', 'domain2'), {recursive: true})
    await writeFile(join(projectPath, '.brv', 'context-tree', 'domain2', 'file3.md'), '')

    const transport = createMockTransportServer()
    makeRealHandler(transport)

    const getHandler = transport._handlers.get(StatusEvents.GET)
    const result = await getHandler!(undefined, 'client-1')

    expect(result.status.locations[0].domainCount).to.equal(2)
    expect(result.status.locations[0].fileCount).to.equal(3)
  })

  it('should return domainCount=0 and fileCount=0 for an empty context-tree directory', async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'brv-ct-empty-'))
    await mkdir(join(projectPath, '.brv', 'context-tree'), {recursive: true})

    const transport = createMockTransportServer()
    makeRealHandler(transport)

    const getHandler = transport._handlers.get(StatusEvents.GET)
    const result = await getHandler!(undefined, 'client-1')

    expect(result.status.locations[0].domainCount).to.equal(0)
    expect(result.status.locations[0].fileCount).to.equal(0)
  })
})
