/**
 * StatusHandler tests
 *
 * Verifies that `currentDirectory` in the StatusDTO preserves the actual
 * client working directory (backward compatibility) rather than the resolved
 * project root.
 */

import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../../src/shared/transport/events/status-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

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
  projectConfigStore: {exists: SinonStub; getModifiedTime: SinonStub; read: SinonStub; write: SinonStub}
  tokenStore: {clear: SinonStub; load: SinonStub; save: SinonStub}
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
  let testDir: string
  let transport: MockTransportServer

  beforeEach(() => {
    deps = makeStubs()
    resolveProjectPath = stub().returns('/project/current')
    transport = createMockTransportServer()
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-status-handler-')))
    stub(console, 'error')
  })

  afterEach(() => {
    restore()
    rmSync(testDir, {force: true, recursive: true})
  })

  function createHandler(projectPath?: string): StatusHandler {
    if (projectPath) {
      resolveProjectPath = stub().returns(projectPath)
    }

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function callGetHandler(data?: any, clientId = 'client-1'): Promise<{status: StatusDTO}> {
    const handler = transport._handlers.get(StatusEvents.GET)
    expect(handler, 'status:get handler should be registered').to.exist
    return handler!(data, clientId)
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

  describe('currentDirectory', () => {
    it('should equal projectPath when no cwd is provided', async () => {
      createHandler('/test/project')

      const {status} = await callGetHandler()

      expect(status.currentDirectory).to.equal('/test/project')
    })

    it('should equal clientCwd when cwd is provided', async () => {
      // Create a real project so resolveProject() succeeds
      const projectRoot = join(testDir, 'project')
      const subDir = join(projectRoot, 'packages', 'api', 'src')
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
      mkdirSync(subDir, {recursive: true})

      createHandler(projectRoot)

      const {status} = await callGetHandler({cwd: subDir})

      expect(status.currentDirectory).to.equal(subDir)
      expect(status.projectRoot).to.equal(projectRoot)
    })

    it('should preserve clientCwd even when resolver returns null', async () => {
      // Pass a cwd that has no .brv/ — resolveProject returns null
      const noProjectDir = join(testDir, 'no-project')
      mkdirSync(noProjectDir, {recursive: true})

      createHandler('/fallback/project')

      const {status} = await callGetHandler({cwd: noProjectDir})

      expect(status.currentDirectory).to.equal(noProjectDir)
    })
  })

  describe('projectRootFlag', () => {
    it('should resolve to the explicit project root when projectRootFlag is provided', async () => {
      // Create a real project at an explicit path
      const explicitRoot = join(testDir, 'explicit-project')
      mkdirSync(join(explicitRoot, '.brv'), {recursive: true})
      writeFileSync(join(explicitRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))

      // Create a different project at a cwd location
      const cwdProject = join(testDir, 'cwd-project')
      mkdirSync(join(cwdProject, '.brv'), {recursive: true})
      writeFileSync(join(cwdProject, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))

      createHandler(cwdProject)

      const {status} = await callGetHandler({cwd: cwdProject, projectRootFlag: explicitRoot})

      // The explicit flag should override the cwd-based resolution
      expect(status.projectRoot).to.equal(explicitRoot)
      expect(status.resolutionSource).to.equal('flag')
    })

    it('should use projectRootFlag even without cwd', async () => {
      const explicitRoot = join(testDir, 'explicit-project')
      mkdirSync(join(explicitRoot, '.brv'), {recursive: true})
      writeFileSync(join(explicitRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))

      createHandler('/some/other/project')

      const {status} = await callGetHandler({projectRootFlag: explicitRoot})

      expect(status.projectRoot).to.equal(explicitRoot)
      expect(status.resolutionSource).to.equal('flag')
    })
  })
})
