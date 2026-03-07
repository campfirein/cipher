/**
 * VcHandler Unit Tests
 *
 * Tests vc init and status flows (ENG-685):
 * - git init only (no add, commit, or addRemote)
 * - Auth token validation
 * - Idempotent: always calls gitService.init(); reinitialized flag reflects prior state
 * - Response shape
 */

import {expect} from 'chai'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../../src/server/constants.js'
import {VcHandler} from '../../../../../src/server/infra/transport/handlers/vc-handler.js'
import {VcEvents} from '../../../../../src/shared/transport/events/vc-events.js'

/** Makes all methods of T typed as SinonStub while still satisfying the original interface. */
type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const CLIENT_ID = 'client-abc'

interface TestDeps {
  contextTreeDirPath: string
  contextTreeService: Stubbed<IContextTreeService>
  gitService: Stubbed<IGitService>
  requestHandlers: Record<string, RequestHandler>
  resolveProjectPath: SinonStub
  transport: Stubbed<ITransportServer>
}

function makeDeps(sandbox: SinonSandbox, projectPath: string): TestDeps {
  const contextTreeDirPath = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)

  const contextTreeService: Stubbed<IContextTreeService> = {
    delete: sandbox.stub().resolves(),
    exists: sandbox.stub().resolves(false),
    initialize: sandbox.stub().resolves(contextTreeDirPath),
    resolvePath: sandbox.stub().returns(contextTreeDirPath),
  }

  const gitService: Stubbed<IGitService> = {
    add: sandbox.stub().resolves(),
    addRemote: sandbox.stub().resolves(),
    checkout: sandbox.stub().resolves(),
    commit: sandbox.stub().resolves({
      author: {email: 'test@example.com', name: 'test@example.com'},
      message: 'Initialize context tree',
      sha: 'abc123',
      timestamp: new Date(),
    }),
    createBranch: sandbox.stub().resolves(),
    fetch: sandbox.stub().resolves(),
    getConflicts: sandbox.stub().resolves([]),
    getCurrentBranch: sandbox.stub().resolves(),
    getRemoteUrl: sandbox.stub().resolves(),
    init: sandbox.stub().resolves(),
    isInitialized: sandbox.stub().resolves(false),
    listBranches: sandbox.stub().resolves([]),
    listRemotes: sandbox.stub().resolves([]),
    log: sandbox.stub().resolves([]),
    merge: sandbox.stub().resolves({success: true}),
    pull: sandbox.stub().resolves({success: true}),
    push: sandbox.stub().resolves({success: true}),
    removeRemote: sandbox.stub().resolves(),
    status: sandbox.stub().resolves({files: [], isClean: true}),
  }

  const resolveProjectPath = sandbox.stub().returns(projectPath)

  // Capture registered handlers keyed by event name
  const requestHandlers: Record<string, RequestHandler> = {}
  const transport: Stubbed<ITransportServer> = {
    addToRoom: sandbox.stub(),
    broadcast: sandbox.stub(),
    broadcastTo: sandbox.stub(),
    getPort: sandbox.stub(),
    isRunning: sandbox.stub(),
    onConnection: sandbox.stub(),
    onDisconnection: sandbox.stub(),
    onRequest: sandbox.stub().callsFake((event: string, handler: RequestHandler) => {
      requestHandlers[event] = handler
    }),
    removeFromRoom: sandbox.stub(),
    sendTo: sandbox.stub(),
    start: sandbox.stub().resolves(),
    stop: sandbox.stub().resolves(),
  }

  return {
    contextTreeDirPath,
    contextTreeService,
    gitService,
    requestHandlers,
    resolveProjectPath,
    transport,
  }
}

function makeVcHandler(deps: TestDeps): VcHandler {
  return new VcHandler({
    contextTreeService: deps.contextTreeService,
    gitService: deps.gitService,
    resolveProjectPath: deps.resolveProjectPath,
    transport: deps.transport,
  })
}

const projectPath = '/fake/brv/project'

describe('VcHandler', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('setup()', () => {
    it('should register handler for vc:init event', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      expect(deps.transport.onRequest.called).to.be.true
      expect(deps.transport.onRequest.firstCall.args[0]).to.equal(VcEvents.INIT)
    })

    it('should register handler for vc:status event', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      const registeredEvents = deps.transport.onRequest.args.map((args: unknown[]) => args[0])
      expect(registeredEvents).to.include(VcEvents.STATUS)
    })
  })

  describe('handleInit — fresh repo (isInitialized=false)', () => {
    it('should call contextTreeService.initialize with projectPath', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.contextTreeService.initialize.calledOnceWith(projectPath)).to.be.true
    })

    it('should call gitService.init with contextTreeDir and defaultBranch main', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.gitService.init.calledOnce).to.be.true
      expect(deps.gitService.init.firstCall.args[0]).to.deep.equal({
        defaultBranch: 'main',
        directory: deps.contextTreeDirPath,
      })
    })

    it('should return reinitialized=false when repo was not previously initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        gitDir: join(deps.contextTreeDirPath, '.git'),
        reinitialized: false,
      })
    })

    it('should not call add, commit, or addRemote on fresh init', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.gitService.add.called).to.be.false
      expect(deps.gitService.commit.called).to.be.false
      expect(deps.gitService.addRemote.called).to.be.false
    })
  })

  describe('handleInit — repo already exists (isInitialized=true)', () => {
    it('should still call gitService.init when repo already exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.gitService.init.calledOnce).to.be.true
    })

    it('should return reinitialized=true when repo already existed', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        gitDir: join(deps.contextTreeDirPath, '.git'),
        reinitialized: true,
      })
    })

    it('should not call add, commit, or addRemote on reinit', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.gitService.add.called).to.be.false
      expect(deps.gitService.commit.called).to.be.false
      expect(deps.gitService.addRemote.called).to.be.false
    })
  })

  describe('project path resolution', () => {
    it('should resolve project path using clientId', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.resolveProjectPath.calledWith(CLIENT_ID)).to.be.true
    })

    it('should throw when project path cannot be resolved', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.resolveProjectPath.callsFake(() => {})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)
        expect.fail('Expected error for missing project path')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).to.include('No project path found')
        }
      }
    })
  })

  describe('handleStatus — git not initialized', () => {
    it('should return empty response with no branch when git is not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        initialized: false,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })

    it('should resolve project path using clientId', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(deps.resolveProjectPath.calledWith(CLIENT_ID)).to.be.true
    })
  })

  describe('handleStatus — git initialized, clean repo', () => {
    it('should return branch and empty arrays when working tree is clean', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        initialized: true,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })
  })

  describe('handleStatus — staged files', () => {
    it('should map staged added file to staged.added', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({
        files: [{path: 'a.md', staged: true, status: 'added'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        initialized: true,
        staged: {added: ['a.md'], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })
  })

  describe('handleStatus — unstaged files', () => {
    it('should map unstaged modified file to unstaged.modified', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({
        files: [{path: 'b.md', staged: false, status: 'modified'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        initialized: true,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: ['b.md']},
        untracked: [],
      })
    })
  })

  describe('handleStatus — untracked files', () => {
    it('should map untracked file to untracked array', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({
        files: [{path: 'c.md', staged: false, status: 'untracked'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        initialized: true,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: ['c.md'],
      })
    })
  })

  describe('handleStatus — mixed changes', () => {
    it('should correctly populate all three sections simultaneously', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('feat')
      deps.gitService.status.resolves({
        files: [
          {path: 'deleted.md', staged: true, status: 'deleted'},
          {path: 'modified.md', staged: false, status: 'modified'},
          {path: 'new.md', staged: false, status: 'untracked'},
        ],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'feat',
        initialized: true,
        staged: {added: [], deleted: ['deleted.md'], modified: []},
        unstaged: {deleted: [], modified: ['modified.md']},
        untracked: ['new.md'],
      })
    })
  })

  describe('handleStatus — detached HEAD', () => {
    it('should return response with undefined branch when in detached HEAD state', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves()
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: undefined,
        initialized: true,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })
  })

  describe('handleStatus — error propagation', () => {
    it('should propagate error when gitService.status() throws', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.rejects(new Error('git read error'))
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).to.equal('git read error')
        }
      }
    })
  })
})
