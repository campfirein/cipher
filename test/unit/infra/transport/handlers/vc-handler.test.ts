/**
 * VcHandler Unit Tests
 *
 * Tests git init flow (ENG-685):
 * - git init only (no add, commit, or addRemote)
 * - Auth token validation
 * - Idempotent: always calls gitService.init(); reinitialized flag reflects prior state
 * - Response shape
 */

import {expect} from 'chai'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../../src/server/constants.js'
import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {NotAuthenticatedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {VcHandler} from '../../../../../src/server/infra/transport/handlers/vc-handler.js'
import {VcEvents} from '../../../../../src/shared/transport/events/vc-events.js'

const CLIENT_ID = 'client-abc'

function makeValidToken(): AuthToken {
  return new AuthToken({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() + 3_600_000),
    refreshToken: 'refresh-token',
    sessionKey: 'session-key',
    userEmail: 'test@example.com',
    userId: 'user-123',
  })
}

function makeDeps(sandbox: SinonSandbox, projectPath: string) {
  const contextTreeDirPath = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)

  const contextTreeService: IContextTreeService = {
    delete: sandbox.stub().resolves(),
    exists: sandbox.stub().resolves(false),
    initialize: sandbox.stub().resolves(contextTreeDirPath),
  }

  const gitService: IGitService = {
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

  const tokenStore: ITokenStore = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(makeValidToken()),
    save: sandbox.stub().resolves(),
  }

  const resolveProjectPath = sandbox.stub().returns(projectPath)

  // Capture registered handlers keyed by event name
  const requestHandlers: Record<string, RequestHandler> = {}
  const transport: ITransportServer = {
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
    tokenStore,
    transport,
  }
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
      const {contextTreeService, gitService, resolveProjectPath, tokenStore, transport} = makeDeps(sandbox, projectPath)
      const handler = new VcHandler({
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      })

      handler.setup()

      expect((transport.onRequest as SinonStub).called).to.be.true
      expect((transport.onRequest as SinonStub).firstCall.args[0]).to.equal(VcEvents.INIT)
    })
  })

  describe('handleInit — fresh repo (isInitialized=false)', () => {
    it('should call contextTreeService.initialize with projectPath', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect((contextTreeService.initialize as SinonStub).calledOnceWith(projectPath)).to.be.true
    })

    it('should call gitService.init with contextTreeDir and defaultBranch main', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect((gitService.init as SinonStub).calledOnce).to.be.true
      expect((gitService.init as SinonStub).firstCall.args[0]).to.deep.equal({
        defaultBranch: 'main',
        directory: contextTreeDirPath,
      })
    })

    it('should return reinitialized=false when repo was not previously initialized', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      ;(gitService.isInitialized as SinonStub).resolves(false)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        gitDir: join(contextTreeDirPath, '.git'),
        reinitialized: false,
      })
    })

    it('should not call add, commit, or addRemote on fresh init', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect((gitService.add as SinonStub).called).to.be.false
      expect((gitService.commit as SinonStub).called).to.be.false
      expect((gitService.addRemote as SinonStub).called).to.be.false
    })
  })

  describe('handleInit — repo already exists (isInitialized=true)', () => {
    it('should still call gitService.init when repo already exists', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect((gitService.init as SinonStub).calledOnce).to.be.true
    })

    it('should return reinitialized=true when repo already existed', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      ;(gitService.isInitialized as SinonStub).resolves(true)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        gitDir: join(contextTreeDirPath, '.git'),
        reinitialized: true,
      })
    })

    it('should not call add, commit, or addRemote on reinit', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect((gitService.add as SinonStub).called).to.be.false
      expect((gitService.commit as SinonStub).called).to.be.false
      expect((gitService.addRemote as SinonStub).called).to.be.false
    })
  })

  describe('auth validation', () => {
    it('should throw NotAuthenticatedError when token is missing', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(tokenStore.load as SinonStub).resolves()
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      try {
        await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)
        expect.fail('Expected NotAuthenticatedError')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })

    it('should throw NotAuthenticatedError when token is expired', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      const expiredToken = new AuthToken({
        accessToken: 'expired-token',
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        userEmail: 'test@example.com',
        userId: 'user-123',
      })
      ;(tokenStore.load as SinonStub).resolves(expiredToken)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      try {
        await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)
        expect.fail('Expected NotAuthenticatedError')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })
  })

  describe('project path resolution', () => {
    it('should resolve project path using clientId', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect((resolveProjectPath as SinonStub).calledWith(CLIENT_ID)).to.be.true
    })

    it('should throw when project path cannot be resolved', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(resolveProjectPath as SinonStub).callsFake(() => {})
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      try {
        await requestHandlers[VcEvents.INIT]({}, CLIENT_ID)
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
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(false)
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })
  })

  describe('handleStatus — git initialized, clean repo', () => {
    it('should return branch and empty arrays when working tree is clean', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      ;(gitService.getCurrentBranch as SinonStub).resolves('main')
      ;(gitService.status as SinonStub).resolves({files: [], isClean: true})
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })
  })

  describe('handleStatus — staged files', () => {
    it('should map staged added file to staged.added', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      ;(gitService.getCurrentBranch as SinonStub).resolves('main')
      ;(gitService.status as SinonStub).resolves({
        files: [{path: 'a.md', staged: true, status: 'added'}],
        isClean: false,
      })
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        staged: {added: ['a.md'], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      })
    })
  })

  describe('handleStatus — unstaged files', () => {
    it('should map unstaged modified file to unstaged.modified', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      ;(gitService.getCurrentBranch as SinonStub).resolves('main')
      ;(gitService.status as SinonStub).resolves({
        files: [{path: 'b.md', staged: false, status: 'modified'}],
        isClean: false,
      })
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: ['b.md']},
        untracked: [],
      })
    })
  })

  describe('handleStatus — untracked files', () => {
    it('should map untracked file to untracked array', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      ;(gitService.getCurrentBranch as SinonStub).resolves('main')
      ;(gitService.status as SinonStub).resolves({
        files: [{path: 'c.md', staged: false, status: 'untracked'}],
        isClean: false,
      })
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: ['c.md'],
      })
    })
  })

  describe('handleStatus — mixed changes', () => {
    it('should correctly populate all three sections simultaneously', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      ;(gitService.getCurrentBranch as SinonStub).resolves('feat')
      ;(gitService.status as SinonStub).resolves({
        files: [
          {path: 'deleted.md', staged: true, status: 'deleted'},
          {path: 'modified.md', staged: false, status: 'modified'},
          {path: 'new.md', staged: false, status: 'untracked'},
        ],
        isClean: false,
      })
      new VcHandler({contextTreeService, gitService, resolveProjectPath, tokenStore, transport}).setup()

      const result = await requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'feat',
        staged: {added: [], deleted: ['deleted.md'], modified: []},
        unstaged: {deleted: [], modified: ['modified.md']},
        untracked: ['new.md'],
      })
    })
  })
})
