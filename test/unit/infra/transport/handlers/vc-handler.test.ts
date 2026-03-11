/**
 * VcHandler Unit Tests
 *
 * Tests vc init, status, add, commit, config, push flows.
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
import type {IVcGitConfigStore} from '../../../../../src/server/core/interfaces/vc/i-vc-git-config-store.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../../src/server/constants.js'
import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {GitAuthError} from '../../../../../src/server/core/domain/errors/git-error.js'
import {VcError} from '../../../../../src/server/core/domain/errors/vc-error.js'
import {VcHandler} from '../../../../../src/server/infra/transport/handlers/vc-handler.js'
import {VcErrorCode, VcEvents} from '../../../../../src/shared/transport/events/vc-events.js'

/** Makes all methods of T typed as SinonStub while still satisfying the original interface. */
type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const CLIENT_ID = 'client-abc'

interface TestDeps {
  contextTreeDirPath: string
  contextTreeService: Stubbed<IContextTreeService>
  gitService: Stubbed<IGitService>
  requestHandlers: Record<string, RequestHandler>
  resolveProjectPath: SinonStub
  tokenStore: Stubbed<ITokenStore>
  transport: Stubbed<ITransportServer>
  vcGitConfigStore: Stubbed<IVcGitConfigStore>
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
      author: {email: 'test@example.com', name: 'Test User'},
      message: 'test commit',
      sha: 'abc123def456',
      timestamp: new Date(),
    }),
    createBranch: sandbox.stub().resolves(),
    fetch: sandbox.stub().resolves(),
    getConflicts: sandbox.stub().resolves([]),
    getCurrentBranch: sandbox.stub().resolves('main'),
    getRemoteUrl: sandbox.stub().resolves(),
    init: sandbox.stub().resolves(),
    isInitialized: sandbox.stub().resolves(true),
    listBranches: sandbox.stub().resolves([]),
    listRemotes: sandbox.stub().resolves([{remote: 'origin', url: 'https://example.com/repo.git'}]),
    log: sandbox.stub().resolves([]),
    merge: sandbox.stub().resolves({success: true}),
    pull: sandbox.stub().resolves({success: true}),
    push: sandbox.stub().resolves({success: true}),
    removeRemote: sandbox.stub().resolves(),
    status: sandbox.stub().resolves({files: [], isClean: true}),
  }

  const vcGitConfigStore: Stubbed<IVcGitConfigStore> = {
    get: sandbox.stub().resolves({email: 'test@example.com', name: 'Test User'}),
    set: sandbox.stub().resolves(),
  }

  const resolveProjectPath = sandbox.stub().returns(projectPath)

  const tokenStore: Stubbed<ITokenStore> = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(),
    save: sandbox.stub().resolves(),
  }

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
    tokenStore,
    transport,
    vcGitConfigStore,
  }
}

function makeVcHandler(deps: TestDeps): VcHandler {
  return new VcHandler({
    contextTreeService: deps.contextTreeService,
    gitService: deps.gitService,
    resolveProjectPath: deps.resolveProjectPath,
    tokenStore: deps.tokenStore,
    transport: deps.transport,
    vcGitConfigStore: deps.vcGitConfigStore,
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
    it('should register vc:add as the first handler', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      expect(deps.transport.onRequest.called).to.be.true
      expect(deps.transport.onRequest.firstCall.args[0]).to.equal(VcEvents.ADD)
    })

    it('should register handlers for all vc events', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      const registeredEvents = deps.transport.onRequest.args.map((args: unknown[]) => args[0])
      expect(registeredEvents).to.include(VcEvents.ADD)
      expect(registeredEvents).to.include(VcEvents.COMMIT)
      expect(registeredEvents).to.include(VcEvents.CONFIG)
      expect(registeredEvents).to.include(VcEvents.INIT)
      expect(registeredEvents).to.include(VcEvents.LOG)
      expect(registeredEvents).to.include(VcEvents.PUSH)
      expect(registeredEvents).to.include(VcEvents.REMOTE)
      expect(registeredEvents).to.include(VcEvents.STATUS)
    })
  })

  describe('handleInit — fresh repo (isInitialized=false)', () => {
    it('should call contextTreeService.initialize with projectPath', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.INIT]({}, CLIENT_ID)

      expect(deps.contextTreeService.initialize.calledOnceWith(projectPath)).to.be.true
    })

    it('should call gitService.init with contextTreeDir and defaultBranch main', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
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
      deps.gitService.isInitialized.resolves(false)
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
  })

  describe('project path resolution', () => {
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
    it('should return empty response with initialized=false', async () => {
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
  })

  describe('handleStatus — git initialized', () => {
    it('should return branch and file lists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({
        files: [
          {path: 'a.md', staged: true, status: 'added'},
          {path: 'b.md', staged: false, status: 'modified'},
          {path: 'c.md', staged: false, status: 'untracked'},
        ],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.equal({
        branch: 'main',
        initialized: true,
        staged: {added: ['a.md'], deleted: [], modified: []},
        unstaged: {deleted: [], modified: ['b.md']},
        untracked: ['c.md'],
      })
    })
  })

  describe('handleAdd', () => {
    it('should call gitService.add with ["."] by default', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      // after add: 1 file staged
      deps.gitService.status.resolves({files: [{path: 'a.md', staged: true, status: 'added'}], isClean: false})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.ADD]({}, CLIENT_ID)

      expect(deps.gitService.add.calledOnce).to.be.true
      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['.']})
      expect(result).to.deep.equal({count: 1})
    })

    it('should call gitService.add with specific file paths when provided', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({
        files: [{path: 'src/a.ts', staged: true, status: 'added'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['src/a.ts']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['src/a.ts']})
    })

    it('should return count=0 when nothing is staged after add', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.ADD]({}, CLIENT_ID)

      expect(result).to.deep.equal({count: 0})
    })

    it('should throw VcError GIT_NOT_INITIALIZED when git not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.ADD]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      }
    })

    it('should call gitService.add with directory pattern ["docs/"]', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['docs/']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['docs/']})
    })

    it('should call gitService.add with nested .md file path', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['docs/architecture.md']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['docs/architecture.md']})
    })

    it('should call gitService.add with mixed file and directory patterns', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['notes.md', 'docs/']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['notes.md', 'docs/']})
    })

    it('should call gitService.add with filename containing spaces', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['Design Patterns.md']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['Design Patterns.md']})
    })

    it('should call gitService.add with filename containing special characters', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['file (1).md', 'résumé.md', 'file-name.md']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({
        filePaths: ['file (1).md', 'résumé.md', 'file-name.md'],
      })
    })

    it('should call gitService.add with uppercase path', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.ADD]({filePaths: ['SRC/Notes.md', 'README.md']}, CLIENT_ID)

      expect(deps.gitService.add.firstCall.args[0]).to.deep.include({filePaths: ['SRC/Notes.md', 'README.md']})
    })

    it('should propagate error from gitService.add when staging fails', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.add.rejects(new Error('Failed to stage: missing.md'))
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.ADD]({filePaths: ['missing.md']}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('missing.md')
      }
    })
  })

  describe('handleCommit', () => {
    it('should commit with author from vcGitConfigStore', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({
        files: [{path: 'a.md', staged: true, status: 'added'}],
        isClean: false,
      })
      deps.vcGitConfigStore.get.resolves({email: 'bao@b.dev', name: 'Bao'})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.COMMIT]({message: 'feat: test'}, CLIENT_ID)

      expect(deps.gitService.commit.calledOnce).to.be.true
      expect(deps.gitService.commit.firstCall.args[0]).to.deep.include({
        author: {email: 'bao@b.dev', name: 'Bao'},
        message: 'feat: test',
      })
      expect(result).to.deep.include({message: 'test commit', sha: 'abc123def456'})
    })

    it('should throw VcError NOTHING_STAGED when nothing is staged', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.COMMIT]({message: 'test'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NOTHING_STAGED)
        }
      }
    })

    it('should throw VcError USER_NOT_CONFIGURED with generic hint when not logged in', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({
        files: [{path: 'a.md', staged: true, status: 'added'}],
        isClean: false,
      })
      deps.vcGitConfigStore.get.resolves()
      deps.tokenStore.load.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.COMMIT]({message: 'test'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.USER_NOT_CONFIGURED)
          expect(error.message).to.include('brv vc config user.name <value>')
        }
      }
    })

    it('should throw VcError USER_NOT_CONFIGURED with pre-filled hint when logged in', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.status.resolves({
        files: [{path: 'a.md', staged: true, status: 'added'}],
        isClean: false,
      })
      deps.vcGitConfigStore.get.resolves()

      const mockToken = new AuthToken({
        accessToken: 'test-acc',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'test-ref',
        sessionKey: 'sess-123',
        userEmail: 'login@example.com',
        userId: 'u1',
      })
      deps.tokenStore.load.resolves(mockToken)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.COMMIT]({message: 'test'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.USER_NOT_CONFIGURED)
          expect(error.message).to.include('login@example.com')
        }
      }
    })

    it('should throw VcError GIT_NOT_INITIALIZED when git not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.COMMIT]({message: 'test'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      }
    })
  })

  describe('handleConfig', () => {
    it('should set user.name and return key+value', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.vcGitConfigStore.get.resolves({})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.CONFIG]({key: 'user.name', value: 'Bao'}, CLIENT_ID)

      expect(deps.vcGitConfigStore.set.calledOnce).to.be.true
      expect(deps.vcGitConfigStore.set.firstCall.args[1]).to.deep.include({name: 'Bao'})
      expect(result).to.deep.equal({key: 'user.name', value: 'Bao'})
    })

    it('should set user.email and preserve existing user.name', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.vcGitConfigStore.get.resolves({name: 'Bao'})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.CONFIG]({key: 'user.email', value: 'bao@b.dev'}, CLIENT_ID)

      expect(deps.vcGitConfigStore.set.firstCall.args[1]).to.deep.equal({email: 'bao@b.dev', name: 'Bao'})
    })

    it('should get existing user.name', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.vcGitConfigStore.get.resolves({email: 'bao@b.dev', name: 'Bao'})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.CONFIG]({key: 'user.name'}, CLIENT_ID)

      expect(result).to.deep.equal({key: 'user.name', value: 'Bao'})
      expect(deps.vcGitConfigStore.set.called).to.be.false
    })

    it('should throw VcError CONFIG_KEY_NOT_SET when getting unset key', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.vcGitConfigStore.get.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CONFIG]({key: 'user.name'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.CONFIG_KEY_NOT_SET)
          expect(error.message).to.include('not set')
        }
      }
    })

    it('should throw VcError INVALID_CONFIG_KEY for unknown key', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CONFIG]({key: 'user.unknown' as never}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.INVALID_CONFIG_KEY)
        }
      }
    })
  })

  describe('handlePush', () => {
    it('should push to origin/main by default', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.push.calledOnce).to.be.true
      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'main', remote: 'origin'})
      expect(result).to.deep.equal({branch: 'main'})
    })

    it('should push to custom branch when specified', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({branch: 'feat/x'}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'feat/x'})
      expect(result).to.deep.equal({branch: 'feat/x'})
    })

    it('should throw VcError NO_REMOTE when no remote configured', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([])
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NO_REMOTE)
        }
      }
    })

    it('should throw VcError NOTHING_TO_PUSH when repo has no commits', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([])
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NOTHING_TO_PUSH)
        }
      }
    })

    it('should throw VcError NON_FAST_FORWARD on non-fast-forward rejection', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({reason: 'non_fast_forward', success: false})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NON_FAST_FORWARD)
        }
      }
    })

    it('should throw VcError GIT_NOT_INITIALIZED when git not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      }
    })

    it('should throw VcError AUTH_FAILED when gitService.push throws GitAuthError', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.rejects(new GitAuthError())
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.AUTH_FAILED)
        }
      }
    })

    it('should throw VcError PUSH_FAILED for unknown errors from gitService.push', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.rejects(new Error('Network timeout'))
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.PUSH_FAILED)
        }
      }
    })

    it('should push to active branch from getCurrentBranch when no branch specified', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getCurrentBranch.resolves('feat/my-feature')
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'feat/my-feature'})
      expect(result).to.deep.equal({branch: 'feat/my-feature'})
    })

    it('should fallback to main when getCurrentBranch returns undefined', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getCurrentBranch.resolves()
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'main'})
      expect(result).to.deep.equal({branch: 'main'})
    })

    it('should ignore empty/whitespace branch and use current branch instead', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getCurrentBranch.resolves('develop')
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({branch: '   '}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'develop'})
      expect(result).to.deep.equal({branch: 'develop'})
    })

    it('should throw VcError INVALID_BRANCH_NAME for invalid branch names', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      makeVcHandler(deps).setup()

      const invalidNames = ['-bad', 'feat..branch', 'has~tilde', 'has^caret', 'has:colon']
      await Promise.all(
        invalidNames.map(async (invalid) => {
          try {
            await deps.requestHandlers[VcEvents.PUSH]({branch: invalid}, CLIENT_ID)
            expect.fail(`Expected error for branch '${invalid}'`)
          } catch (error) {
            expect(error).to.be.instanceOf(VcError)
            if (error instanceof VcError) {
              expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
              expect(error.message).to.include(invalid)
            }
          }
        }),
      )
    })
  })

  describe('handleLog', () => {
    it('should return commits for current branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.log.resolves([
        {
          author: {email: 'test@example.com', name: 'Test User'},
          message: 'feat: something',
          sha: 'abc123',
          timestamp: new Date('2024-01-01'),
        },
      ])
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.LOG]({all: false, limit: 10}, CLIENT_ID)

      expect(result).to.deep.equal({
        commits: [
          {
            author: {email: 'test@example.com', name: 'Test User'},
            message: 'feat: something',
            sha: 'abc123',
            timestamp: new Date('2024-01-01').toISOString(),
          },
        ],
        currentBranch: 'main',
      })
    })

    it('should throw VcError GIT_NOT_INITIALIZED when git not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.LOG]({all: false, limit: 10}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      }
    })

    it('should throw VcError BRANCH_NOT_FOUND when ref branch does not exist', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([{name: 'main'}])
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.LOG]({all: false, limit: 10, ref: 'nonexistent'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.BRANCH_NOT_FOUND)
        }
      }
    })

    it('should return deduplicated commits from all branches when all=true', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([
        {isCurrent: true, name: 'main'},
        {isCurrent: false, name: 'feature'},
      ])

      const commit1 = {
        author: {email: 'a@example.com', name: 'A'},
        message: 'first',
        sha: 'sha1',
        timestamp: new Date('2024-01-02'),
      }
      const commit2 = {
        author: {email: 'b@example.com', name: 'B'},
        message: 'second',
        sha: 'sha2',
        timestamp: new Date('2024-01-01'),
      }
      // main returns both commits; feature returns commit1 (duplicate) + commit2
      deps.gitService.log.withArgs({directory: deps.contextTreeDirPath, ref: 'main'}).resolves([commit1, commit2])
      deps.gitService.log.withArgs({directory: deps.contextTreeDirPath, ref: 'feature'}).resolves([commit1])
      makeVcHandler(deps).setup()

      const result = (await deps.requestHandlers[VcEvents.LOG]({all: true, limit: 10}, CLIENT_ID)) as {
        commits: Array<{sha: string}>
        currentBranch: string
      }

      // Should deduplicate: sha1 appears in both branches, should appear only once
      expect(result.commits).to.have.length(2)
      expect(result.commits[0].sha).to.equal('sha1') // newer timestamp first
      expect(result.commits[1].sha).to.equal('sha2')
      expect(result.currentBranch).to.equal('main')
    })

    it('should respect limit when all=true', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([{isCurrent: true, name: 'main'}])

      const commits = Array.from({length: 5}, (_, i) => ({
        author: {email: 'a@example.com', name: 'A'},
        message: `commit ${i}`,
        sha: `sha${i}`,
        timestamp: new Date(2024, 0, 5 - i),
      }))
      deps.gitService.log.resolves(commits)
      makeVcHandler(deps).setup()

      const result = (await deps.requestHandlers[VcEvents.LOG]({all: true, limit: 3}, CLIENT_ID)) as {
        commits: unknown[]
      }

      expect(result.commits).to.have.length(3)
    })
  })

  describe('vc:remote', () => {
    it('should register the vc:remote handler', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()
      expect(deps.requestHandlers[VcEvents.REMOTE]).to.be.a('function')
    })

    it('should return undefined url when no remote configured (show)', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getRemoteUrl.resolves()
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'show'}, CLIENT_ID)
      expect(result).to.deep.equal({action: 'show', url: undefined})
    })

    it('should return masked url when remote is configured (show)', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getRemoteUrl.resolves('https://user:secret@example.com/repo.git')
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'show'}, CLIENT_ID)
      expect(result).to.deep.equal({action: 'show', url: 'https://user:***@example.com/repo.git'})
    })

    it('should call addRemote and return url on add', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getRemoteUrl.resolves()
      makeVcHandler(deps).setup()

      const url = 'https://user:token@example.com/repo.git'
      const result = await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'add', url}, CLIENT_ID)
      expect(result).to.deep.equal({action: 'add', url})
      expect(deps.gitService.addRemote.calledOnce).to.be.true
      expect(deps.gitService.addRemote.firstCall.args[0]).to.include({remote: 'origin', url})
    })

    it('should throw REMOTE_ALREADY_EXISTS when adding duplicate remote', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getRemoteUrl.resolves('https://existing.com/repo.git')
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'add', url: 'https://new.com/repo.git'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.REMOTE_ALREADY_EXISTS)
        }
      }
    })

    it('should call removeRemote + addRemote on set-url', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      makeVcHandler(deps).setup()

      const url = 'https://new:token@example.com/repo.git'
      const result = await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'set-url', url}, CLIENT_ID)
      expect(result).to.deep.equal({action: 'set-url', url})
      expect(deps.gitService.removeRemote.calledOnce).to.be.true
      expect(deps.gitService.addRemote.calledOnce).to.be.true
      expect(deps.gitService.addRemote.firstCall.args[0]).to.include({remote: 'origin', url})
    })

    it('should throw GIT_NOT_INITIALIZED when git not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'show'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      }
    })

    it('should throw INVALID_REMOTE_URL when url is missing for add', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.REMOTE]({subcommand: 'add'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.INVALID_REMOTE_URL)
        }
      }
    })
  })
})
