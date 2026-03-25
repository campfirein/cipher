/**
 * VcHandler Unit Tests
 *
 * Tests vc init, status, add, commit, config, push flows.
 */

import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {IVcGitConfigStore} from '../../../../../src/server/core/interfaces/vc/i-vc-git-config-store.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../../src/server/constants.js'
import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {GitAuthError, GitError} from '../../../../../src/server/core/domain/errors/git-error.js'
// vc-remote-url start
import {NotAuthenticatedError} from '../../../../../src/server/core/domain/errors/task-error.js'
// vc-remote-url end
import {VcError} from '../../../../../src/server/core/domain/errors/vc-error.js'
import {VcHandler} from '../../../../../src/server/infra/transport/handlers/vc-handler.js'
import {
  type IVcBranchRequest,
  type IVcBranchResponse,
  type IVcCheckoutResponse,
  type IVcFetchResponse,
  type IVcMergeRequest,
  type IVcMergeResponse,
  type IVcPullResponse,
  // vc-remote-url start
  type IVcRemoteUrlResponse,
  // vc-remote-url end
  VcErrorCode,
  VcEvents,
} from '../../../../../src/shared/transport/events/vc-events.js'

/** Makes all methods of T typed as SinonStub while still satisfying the original interface. */
type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const CLIENT_ID = 'client-abc'

interface TestDeps {
  broadcastToProject: SinonStub
  contextTreeDirPath: string
  contextTreeService: Stubbed<IContextTreeService>
  gitService: Stubbed<IGitService>
  projectConfigStore: Stubbed<IProjectConfigStore>
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
    abortMerge: sandbox.stub().resolves(),
    add: sandbox.stub().resolves(),
    addRemote: sandbox.stub().resolves(),
    checkout: sandbox.stub().resolves(),
    clone: sandbox.stub().resolves(),
    commit: sandbox.stub().resolves({
      author: {email: 'test@example.com', name: 'Test User'},
      message: 'test commit',
      sha: 'abc123def456',
      timestamp: new Date(),
    }),
    createBranch: sandbox.stub().resolves(),
    deleteBranch: sandbox.stub().resolves(),
    fetch: sandbox.stub().resolves(),
    getAheadBehind: sandbox.stub().resolves({ahead: 0, behind: 0}),
    getConflicts: sandbox.stub().resolves([]),
    getCurrentBranch: sandbox.stub().resolves('main'),
    getRemoteUrl: sandbox.stub().resolves(),
    getTrackingBranch: sandbox.stub().resolves(),
    init: sandbox.stub().resolves(),
    isInitialized: sandbox.stub().resolves(true),
    listBranches: sandbox.stub().resolves([]),
    listRemotes: sandbox.stub().resolves([{remote: 'origin', url: 'https://example.com/repo.git'}]),
    log: sandbox.stub().resolves([]),
    merge: sandbox.stub().resolves({success: true}),
    pull: sandbox.stub().resolves({success: true}),
    push: sandbox.stub().resolves({success: true}),
    removeRemote: sandbox.stub().resolves(),
    setTrackingBranch: sandbox.stub().resolves(),
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

  const broadcastToProject = sandbox.stub()

  const projectConfigStore: Stubbed<IProjectConfigStore> = {
    exists: sandbox.stub().resolves(false),
    getModifiedTime: sandbox.stub().resolves(),
    read: sandbox.stub().resolves(),
    write: sandbox.stub().resolves(),
  }

  return {
    broadcastToProject,
    contextTreeDirPath,
    contextTreeService,
    gitService,
    projectConfigStore,
    requestHandlers,
    resolveProjectPath,
    tokenStore,
    transport,
    vcGitConfigStore,
  }
}

function makeVcHandler(deps: TestDeps): VcHandler {
  return new VcHandler({
    broadcastToProject: deps.broadcastToProject,
    cogitGitBaseUrl: 'https://test-cogit.byterover.dev',
    contextTreeService: deps.contextTreeService,
    gitService: deps.gitService,
    projectConfigStore: deps.projectConfigStore,
    resolveProjectPath: deps.resolveProjectPath,
    tokenStore: deps.tokenStore,
    transport: deps.transport,
    vcGitConfigStore: deps.vcGitConfigStore,
  })
}

const projectPath = '/fake/brv/project'

/**
 * Creates a real temp dir with .git/ so fs.promises.access(MERGE_HEAD) works.
 * Returns a deps object whose contextTreeService.resolvePath points to that dir.
 */
function makeMergeDeps(
  sb: SinonSandbox,
  opts: {mergeHead?: boolean; mergeMsg?: string} = {},
): TestDeps & {tmpDir: string} {
  const tmpDir = join(tmpdir(), `brv-vc-merge-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(join(tmpDir, '.git'), {recursive: true})

  if (opts.mergeHead) {
    writeFileSync(join(tmpDir, '.git', 'MERGE_HEAD'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n')
  }

  if (opts.mergeMsg) {
    writeFileSync(join(tmpDir, '.git', 'MERGE_MSG'), `${opts.mergeMsg}\n`)
  }

  const deps = makeDeps(sb, projectPath)
  deps.contextTreeService.resolvePath.returns(tmpDir)
  return {...deps, tmpDir}
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, {force: true, recursive: true})
}

/** Typed invoke helper — consolidates the single unavoidable cast from RequestHandler's `Promise<unknown>`. */
function invoke<T>(deps: TestDeps, event: string, data: unknown, clientId = CLIENT_ID): Promise<T> {
  return deps.requestHandlers[event](data, clientId) as Promise<T>
}

describe('VcHandler', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('setup()', () => {
    it('should register vc:branch handler', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      const registeredEvents = deps.transport.onRequest.args.map((args: unknown[]) => args[0])
      expect(registeredEvents).to.include(VcEvents.BRANCH)
    })

    it('should register handlers for all vc events', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      const registeredEvents = deps.transport.onRequest.args.map((args: unknown[]) => args[0])
      expect(registeredEvents).to.include(VcEvents.BRANCH)
      expect(registeredEvents).to.include(VcEvents.CLONE)
      expect(registeredEvents).to.include(VcEvents.ADD)
      expect(registeredEvents).to.include(VcEvents.COMMIT)
      expect(registeredEvents).to.include(VcEvents.CONFIG)
      expect(registeredEvents).to.include(VcEvents.FETCH)
      expect(registeredEvents).to.include(VcEvents.INIT)
      expect(registeredEvents).to.include(VcEvents.LOG)
      expect(registeredEvents).to.include(VcEvents.PULL)
      expect(registeredEvents).to.include(VcEvents.PUSH)
      expect(registeredEvents).to.include(VcEvents.REMOTE)
      // vc-remote-url start
      expect(registeredEvents).to.include(VcEvents.REMOTE_URL)
      // vc-remote-url end
      expect(registeredEvents).to.include(VcEvents.STATUS)
      expect(registeredEvents).to.include(VcEvents.CHECKOUT)
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

      expect(result).to.deep.include({
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
      // before add: nothing staged; after add: a.md staged → delta = 1
      deps.gitService.status.onFirstCall().resolves({files: [], isClean: true})
      deps.gitService.status
        .onSecondCall()
        .resolves({files: [{path: 'a.md', staged: true, status: 'added'}], isClean: false})
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
        if (error instanceof Error) expect(error.message).to.include('missing.md')
      }
    })

    it('should return count=1 when staging an unstaged file deletion', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      // before: file deleted but not yet staged [1,0,1] → {staged: false, status: 'deleted'}
      deps.gitService.status.onFirstCall().resolves({
        files: [{path: 'a.md', staged: false, status: 'deleted'}],
        isClean: false,
      })
      // after: deletion staged [1,0,0] → {staged: true, status: 'deleted'}
      deps.gitService.status.onSecondCall().resolves({
        files: [{path: 'a.md', staged: true, status: 'deleted'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.ADD]({filePaths: ['a.md']}, CLIENT_ID)

      expect(result).to.deep.equal({count: 1})
    })

    it('should return count=0 when re-adding an already staged deletion (no-op)', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      // already staged deletion [1,0,0] before and after — no change
      deps.gitService.status.resolves({files: [{path: 'a.md', staged: true, status: 'deleted'}], isClean: false})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.ADD]({filePaths: ['a.md']}, CLIENT_ID)

      expect(result).to.deep.equal({count: 0})
    })

    it('should return count=1 for partially staged deletion with same untracked path [1,1,0]', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      // [1,1,0] = git rm --cached: staged deletion + file still in workdir (untracked)
      deps.gitService.status.onFirstCall().resolves({
        files: [
          {path: 'a.md', staged: true, status: 'deleted'},
          {path: 'a.md', staged: false, status: 'untracked'},
        ],
        isClean: false,
      })
      // after add: file is back in index as staged new file
      deps.gitService.status.onSecondCall().resolves({
        files: [{path: 'a.md', staged: true, status: 'added'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.ADD]({filePaths: ['a.md']}, CLIENT_ID)

      // a.md was in stagedBefore AND in hadUnstagedBefore → counts as 1 (re-staged)
      expect(result).to.deep.equal({count: 1})
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
          expect(error.message).to.include('/vc config user.name <value>')
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
    it('should push to origin/main when tracking is configured', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.push.calledOnce).to.be.true
      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'main', remote: 'origin'})
      expect(result).to.deep.include({alreadyUpToDate: false, branch: 'main'})
    })

    it('should throw VcError NO_UPSTREAM when no tracking configured and no -u flag', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NO_UPSTREAM)
          expect(error.message).to.include('/vc push -u origin main')
        }
      }

      expect(deps.gitService.push.called).to.be.false
    })

    it('should allow push with explicit branch even without tracking', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({branch: 'feat/x'}, CLIENT_ID)

      expect(deps.gitService.push.calledOnce).to.be.true
      expect(result).to.deep.include({branch: 'feat/x'})
    })

    it('should push to custom branch when specified and tracking exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'feat/x'})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({branch: 'feat/x'}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'feat/x'})
      expect(result).to.deep.include({alreadyUpToDate: false, branch: 'feat/x'})
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
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
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
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
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
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
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

    it('should push to active branch from getCurrentBranch when tracking exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getCurrentBranch.resolves('feat/my-feature')
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'feat/my-feature'})
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'feat/my-feature'})
      expect(result).to.deep.include({alreadyUpToDate: false, branch: 'feat/my-feature'})
    })

    it('should throw VcError NO_UPSTREAM when getCurrentBranch returns undefined and no tracking', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getCurrentBranch.resolves()
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NO_UPSTREAM)
          expect(error.message).to.include('/vc push -u origin main')
        }
      }

      expect(deps.gitService.push.called).to.be.false
    })

    it('should ignore empty/whitespace branch and use current branch instead', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.getCurrentBranch.resolves('develop')
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'develop'})
      deps.gitService.push.resolves({success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({branch: '   '}, CLIENT_ID)

      expect(deps.gitService.push.firstCall.args[0]).to.deep.include({branch: 'develop'})
      expect(result).to.deep.include({alreadyUpToDate: false, branch: 'develop'})
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

    it('should allow push -u without tracking (sets upstream after push)', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({setUpstream: true}, CLIENT_ID)

      expect(deps.gitService.push.calledOnce).to.be.true
      expect(deps.gitService.setTrackingBranch.calledOnce).to.be.true
      expect(result).to.deep.include({upstreamSet: true})
    })

    it('should not set upstream when tracking already exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.setTrackingBranch.called).to.be.false
      expect(result).to.deep.include({upstreamSet: false})
    })

    it('should not call setTrackingBranch when setUpstream is not passed', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({success: true})
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      makeVcHandler(deps).setup()

      await deps.requestHandlers[VcEvents.PUSH]({}, CLIENT_ID)

      expect(deps.gitService.setTrackingBranch.called).to.be.false
    })
  })

  describe('handlePull', () => {
    it('should pull from tracking branch when configured', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      deps.gitService.pull.resolves({alreadyUpToDate: false, success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)

      expect(deps.gitService.pull.calledOnce).to.be.true
      expect(deps.gitService.pull.firstCall.args[0]).to.deep.include({branch: 'main', remote: 'origin'})
      expect(result).to.deep.include({alreadyUpToDate: false, branch: 'main'})
    })

    it('should throw NO_UPSTREAM when no tracking and no explicit branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NO_UPSTREAM)
        }
      }
    })

    it('should return alreadyUpToDate when no changes', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      deps.gitService.pull.resolves({alreadyUpToDate: true, success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)

      expect(result).to.deep.include({alreadyUpToDate: true, branch: 'main'})
    })

    it('should throw VcError MERGE_CONFLICT when pull has conflicts', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      deps.gitService.pull.resolves({conflicts: [{path: 'file.txt'}], success: false})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.MERGE_CONFLICT)
          expect(error.message).to.include('file.txt')
        }
      }
    })

    it('should throw VcError GIT_NOT_INITIALIZED when git not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      }
    })

    it('should throw VcError NO_REMOTE when no remote configured', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([])
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NO_REMOTE)
        }
      }
    })

    it('should throw VcError AUTH_FAILED when gitService.pull throws GitAuthError', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.pull.rejects(new GitAuthError())
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.AUTH_FAILED)
        }
      }
    })

    it('should throw VcError PULL_FAILED with original message for GitError', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.pull.rejects(new GitError('You have unresolved merge conflicts.'))
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.PULL_FAILED)
          expect(error.message).to.equal('You have unresolved merge conflicts.')
        }
      }
    })

    it('should throw VcError PULL_FAILED with original message for unknown errors', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.pull.rejects(new Error('HTTP Error: 500 Internal Server Error'))
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.PULL_FAILED)
          expect(error.message).to.equal('HTTP Error: 500 Internal Server Error')
        }
      }
    })

    it('should pull from tracking branch when config exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.getCurrentBranch.resolves('feat/x')
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'develop'})
      deps.gitService.pull.resolves({alreadyUpToDate: false, success: true})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)

      expect(deps.gitService.pull.firstCall.args[0]).to.deep.include({branch: 'develop', remote: 'origin'})
      expect(result).to.deep.include({branch: 'develop'})
    })

    it('should throw NO_UPSTREAM when no tracking config and no explicit branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.getCurrentBranch.resolves('feat/x')
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PULL]({}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.NO_UPSTREAM)
        }
      }
    })
  })

  describe('handleStatus — tracking branch', () => {
    it('should include ahead/behind when tracking branch exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({files: [], isClean: true})
      deps.gitService.getTrackingBranch.resolves({remote: 'origin', remoteBranch: 'main'})
      deps.gitService.getAheadBehind.resolves({ahead: 3, behind: 1})
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.deep.include({
        ahead: 3,
        behind: 1,
        branch: 'main',
        trackingBranch: 'origin/main',
      })
    })

    it('should omit tracking info when no tracking config', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({files: [], isClean: true})
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      const result = await deps.requestHandlers[VcEvents.STATUS]({}, CLIENT_ID)

      expect(result).to.have.property('branch', 'main')
      expect(result).to.have.property('trackingBranch', undefined)
      expect(result).to.have.property('ahead', undefined)
      expect(result).to.have.property('behind', undefined)
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

  // ---- handleBranch ----

  describe('handleBranch', () => {
    // ---- list ----

    it('list should return branches from gitService', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([
        {isCurrent: true, isRemote: false, name: 'main'},
        {isCurrent: false, isRemote: false, name: 'feature'},
      ])
      makeVcHandler(deps).setup()
      const result = await invoke<Extract<IVcBranchResponse, {action: 'list'}>>(deps, VcEvents.BRANCH, {action: 'list'})
      expect(result.action).to.equal('list')
      expect(result.branches).to.have.length(2)
      expect(result.branches[0]).to.deep.equal({isCurrent: true, isRemote: false, name: 'main'})
      expect(result.branches[1]).to.deep.equal({isCurrent: false, isRemote: false, name: 'feature'})
    })

    it('list should pass remote=origin when all flag is true', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([])
      makeVcHandler(deps).setup()
      await deps.requestHandlers[VcEvents.BRANCH]({action: 'list', all: true}, CLIENT_ID)
      expect(deps.gitService.listBranches.firstCall.args[0]).to.deep.include({remote: 'origin'})
    })

    it('list should not pass remote when all flag is false', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([])
      makeVcHandler(deps).setup()
      await deps.requestHandlers[VcEvents.BRANCH]({action: 'list'}, CLIENT_ID)
      expect(deps.gitService.listBranches.firstCall.args[0].remote).to.be.undefined
    })

    it('list should return empty branches array when none exist', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([])
      makeVcHandler(deps).setup()
      const result = await invoke<Extract<IVcBranchResponse, {action: 'list'}>>(deps, VcEvents.BRANCH, {action: 'list'})
      expect(result.branches).to.deep.equal([])
    })

    it('should throw GIT_NOT_INITIALIZED when not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()
      try {
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'list'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
      }
    })

    // ---- create ----

    it('create should create a branch and return created name', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([{isCurrent: true, isRemote: false, name: 'main'}])
      makeVcHandler(deps).setup()
      const result = await invoke<IVcBranchResponse>(deps, VcEvents.BRANCH, {action: 'create', name: 'feature'})
      expect(result).to.deep.equal({action: 'create', created: 'feature'})
      expect(deps.gitService.createBranch.firstCall.args[0]).to.deep.include({branch: 'feature'})
    })

    it('create with slash name (feature/test) should succeed', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([{isCurrent: true, isRemote: false, name: 'main'}])
      makeVcHandler(deps).setup()
      const result = await invoke<Extract<IVcBranchResponse, {action: 'create'}>>(deps, VcEvents.BRANCH, {
        action: 'create',
        name: 'feature/test',
      })
      expect(result.created).to.equal('feature/test')
    })

    it('create should throw BRANCH_ALREADY_EXISTS when branch exists', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.listBranches.resolves([
        {isCurrent: true, isRemote: false, name: 'main'},
        {isCurrent: false, isRemote: false, name: 'feature'},
      ])
      makeVcHandler(deps).setup()
      try {
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'create', name: 'feature'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.BRANCH_ALREADY_EXISTS)
      }
    })

    it('create should throw INVALID_BRANCH_NAME for invalid names', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()
      const names = ['', '-bad', '/bad', 'bad name', 'bad~name', 'bad^name', 'bad:name', 'bad?name', 'bad*name']
      const results = await Promise.allSettled(
        names.map((name) => deps.requestHandlers[VcEvents.BRANCH]({action: 'create', name}, CLIENT_ID)),
      )
      for (const result of results) {
        expect(result.status).to.equal('rejected')
        if (result.status === 'rejected') {
          const error = result.reason
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
        }
      }
    })

    // ---- delete ----

    it('delete should delete a branch and return deleted name', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([
        {isCurrent: true, isRemote: false, name: 'main'},
        {isCurrent: false, isRemote: false, name: 'feature'},
      ])
      makeVcHandler(deps).setup()
      const result = await invoke<IVcBranchResponse>(deps, VcEvents.BRANCH, {action: 'delete', name: 'feature'})
      expect(result).to.deep.equal({action: 'delete', deleted: 'feature'})
      expect(deps.gitService.deleteBranch.firstCall.args[0]).to.deep.include({branch: 'feature'})
    })

    it('delete should work for local branch with slash in name', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([
        {isCurrent: true, isRemote: false, name: 'main'},
        {isCurrent: false, isRemote: false, name: 'feature/test'},
      ])
      makeVcHandler(deps).setup()
      const result = await invoke<Extract<IVcBranchResponse, {action: 'delete'}>>(deps, VcEvents.BRANCH, {
        action: 'delete',
        name: 'feature/test',
      })
      expect(result.deleted).to.equal('feature/test')
      expect(deps.gitService.deleteBranch.calledOnce).to.be.true
    })

    it('delete should throw CANNOT_DELETE_CURRENT_BRANCH', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      makeVcHandler(deps).setup()
      try {
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'delete', name: 'main'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.CANNOT_DELETE_CURRENT_BRANCH)
      }
    })

    it('delete should throw BRANCH_NOT_FOUND when branch does not exist', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([{isCurrent: true, isRemote: false, name: 'main'}])
      makeVcHandler(deps).setup()
      try {
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'delete', name: 'nonexistent'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.BRANCH_NOT_FOUND)
      }
    })

    it('delete should throw BRANCH_NOT_FOUND for remote-tracking name not in local list', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.listBranches.resolves([{isCurrent: true, isRemote: false, name: 'main'}])
      makeVcHandler(deps).setup()
      try {
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'delete', name: 'origin/main'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.BRANCH_NOT_FOUND)
      }
    })

    it('delete should throw INVALID_BRANCH_NAME when name is missing at runtime', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()
      try {
        // Simulate malformed transport payload (no name despite type requiring it)
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'delete'} as unknown as IVcBranchRequest, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
      }
    })

    it('create should throw INVALID_BRANCH_NAME when name is missing at runtime', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()
      try {
        await deps.requestHandlers[VcEvents.BRANCH]({action: 'create'} as unknown as IVcBranchRequest, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
      }
    })
  })

  describe('handleCheckout', () => {
    it('should switch to an existing branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      const result = await invoke<IVcCheckoutResponse>(deps, VcEvents.CHECKOUT, {branch: 'feature'})

      expect(result).to.deep.equal({branch: 'feature', created: false, previousBranch: 'main'})
      expect(deps.gitService.checkout.firstCall.args[0]).to.deep.include({ref: 'feature'})
      expect(deps.gitService.listBranches.called).to.be.false
    })

    it('should throw GIT_NOT_INITIALIZED when not initialized', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CHECKOUT]({branch: 'feature'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
      }
    })

    it('should throw BRANCH_NOT_FOUND when branch does not exist', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({files: [], isClean: true})
      const notFoundError = Object.assign(new Error('Could not find origin/nonexistent.'), {code: 'NotFoundError'})
      deps.gitService.checkout.rejects(notFoundError)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CHECKOUT]({branch: 'nonexistent'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.BRANCH_NOT_FOUND)
          expect(error.message).to.include('/vc checkout -b')
        }
      }
    })

    it('should throw UNCOMMITTED_CHANGES when working tree is dirty without force', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.status.resolves({
        files: [{path: 'file.md', staged: false, status: 'modified'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CHECKOUT]({branch: 'feature'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.UNCOMMITTED_CHANGES)
      }
    })

    it('should allow checkout when only untracked files exist', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({
        files: [{path: 'new-file.md', staged: false, status: 'untracked'}],
        isClean: false,
      })
      makeVcHandler(deps).setup()

      const result = await invoke<IVcCheckoutResponse>(deps, VcEvents.CHECKOUT, {branch: 'feature'})

      expect(result).to.deep.equal({branch: 'feature', created: false, previousBranch: 'main'})
      expect(deps.gitService.checkout.firstCall.args[0]).to.deep.include({ref: 'feature'})
    })

    it('should switch with force when working tree is dirty', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      makeVcHandler(deps).setup()

      const result = await invoke<IVcCheckoutResponse>(deps, VcEvents.CHECKOUT, {branch: 'feature', force: true})

      expect(result).to.deep.equal({branch: 'feature', created: false, previousBranch: 'main'})
      expect(deps.gitService.checkout.firstCall.args[0]).to.deep.include({force: true, ref: 'feature'})
      expect(deps.gitService.status.called).to.be.false
    })

    it('should create and switch with create flag', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.status.resolves({files: [], isClean: true})
      deps.gitService.listBranches.resolves([{isCurrent: true, isRemote: false, name: 'main'}])
      makeVcHandler(deps).setup()

      const result = await invoke<IVcCheckoutResponse>(deps, VcEvents.CHECKOUT, {branch: 'new-branch', create: true})

      expect(result).to.deep.equal({branch: 'new-branch', created: true, previousBranch: 'main'})
      expect(deps.gitService.createBranch.firstCall.args[0]).to.deep.include({branch: 'new-branch', checkout: true})
      expect(deps.gitService.checkout.called).to.be.false
    })

    it('should throw BRANCH_ALREADY_EXISTS when create flag used on existing branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.status.resolves({files: [], isClean: true})
      deps.gitService.listBranches.resolves([
        {isCurrent: true, isRemote: false, name: 'main'},
        {isCurrent: false, isRemote: false, name: 'existing'},
      ])
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CHECKOUT]({branch: 'existing', create: true}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.BRANCH_ALREADY_EXISTS)
      }
    })

    it('should throw INVALID_BRANCH_NAME for invalid names', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.status.resolves({files: [], isClean: true})
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CHECKOUT]({branch: '-bad'}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
      }
    })

    it('should throw INVALID_BRANCH_NAME for empty branch name', async () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.CHECKOUT]({branch: ''}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
      }
    })
  })

  // ── handleMerge ──

  describe('handleMerge', () => {
    it('should register vc:merge handler', () => {
      const deps = makeDeps(sandbox, projectPath)
      makeVcHandler(deps).setup()
      expect(deps.requestHandlers[VcEvents.MERGE]).to.be.a('function')
    })

    // ── action: 'merge' ──

    it('should merge successfully and checkout working tree', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        deps.gitService.merge.resolves({success: true})

        makeVcHandler(deps).setup()
        const result = await invoke<IVcMergeResponse>(deps, VcEvents.MERGE, {
          action: 'merge',
          branch: 'feature',
        } satisfies IVcMergeRequest)

        expect(result.action).to.equal('merge')
        expect(result.branch).to.equal('feature')
        expect(result.conflicts).to.be.undefined
        expect(deps.gitService.merge.calledOnce).to.be.true
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should return conflicts when merge has conflicts', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        deps.gitService.merge.resolves({
          conflicts: [{path: 'file.md', type: 'both_modified'}],
          success: false,
        })

        makeVcHandler(deps).setup()
        const result = await invoke<IVcMergeResponse>(deps, VcEvents.MERGE, {
          action: 'merge',
          branch: 'feature',
        } satisfies IVcMergeRequest)

        expect(result.conflicts).to.have.length(1)
        expect(result.conflicts![0].path).to.equal('file.md')
        expect(deps.gitService.checkout.called).to.be.false
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should pass custom message to merge', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        deps.gitService.merge.resolves({success: true})
        deps.gitService.getCurrentBranch.resolves('main')

        makeVcHandler(deps).setup()
        await deps.requestHandlers[VcEvents.MERGE](
          {action: 'merge', branch: 'feature', message: 'custom msg'} satisfies IVcMergeRequest,
          CLIENT_ID,
        )

        expect(deps.gitService.merge.firstCall.args[0].message).to.equal('custom msg')
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw MERGE_IN_PROGRESS when MERGE_HEAD exists', async () => {
      const deps = makeMergeDeps(sandbox, {mergeHead: true})
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        makeVcHandler(deps).setup()

        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'merge', branch: 'feature'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.MERGE_IN_PROGRESS)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw UNCOMMITTED_CHANGES when working tree is dirty', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        deps.gitService.status.resolves({
          files: [{path: 'dirty.md', staged: false, status: 'modified'}],
          isClean: false,
        })

        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'merge', branch: 'feature'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.UNCOMMITTED_CHANGES)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw BRANCH_NOT_FOUND when branch does not exist', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: true, isRemote: false, name: 'main'}])

        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'merge', branch: 'nonexistent'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.BRANCH_NOT_FOUND)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw GIT_NOT_INITIALIZED when git is not initialized', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.isInitialized.resolves(false)

        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'merge', branch: 'feature'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw INVALID_BRANCH_NAME when branch name is invalid', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'merge', branch: '..invalid'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw INVALID_BRANCH_NAME when branch name is missing', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE]({action: 'merge'} satisfies IVcMergeRequest, CLIENT_ID)
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw USER_NOT_CONFIGURED when author config is missing', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        deps.vcGitConfigStore.get.resolves()

        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'merge', branch: 'feature'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.USER_NOT_CONFIGURED)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should pass author from vcGitConfigStore to merge', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        deps.gitService.listBranches.resolves([{isCurrent: false, isRemote: false, name: 'feature'}])
        deps.gitService.merge.resolves({success: true})
        deps.gitService.getCurrentBranch.resolves('main')
        deps.vcGitConfigStore.get.resolves({email: 'alice@example.com', name: 'Alice'})

        makeVcHandler(deps).setup()
        await deps.requestHandlers[VcEvents.MERGE](
          {action: 'merge', branch: 'feature'} satisfies IVcMergeRequest,
          CLIENT_ID,
        )

        expect(deps.gitService.merge.firstCall.args[0].author).to.deep.equal({
          email: 'alice@example.com',
          name: 'Alice',
        })
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    // ── action: 'abort' ──

    it('should abort merge successfully', async () => {
      const deps = makeMergeDeps(sandbox, {mergeHead: true})
      try {
        makeVcHandler(deps).setup()
        const result = await invoke<IVcMergeResponse>(deps, VcEvents.MERGE, {action: 'abort'} satisfies IVcMergeRequest)

        expect(result.action).to.equal('abort')
        expect(deps.gitService.abortMerge.calledOnce).to.be.true
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw NO_MERGE_IN_PROGRESS when aborting without MERGE_HEAD', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE]({action: 'abort'} satisfies IVcMergeRequest, CLIENT_ID)
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.NO_MERGE_IN_PROGRESS)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    // ── action: 'continue' ──

    it('should return defaultMessage when continuing without message', async () => {
      const deps = makeMergeDeps(sandbox, {mergeHead: true, mergeMsg: "Merge branch 'feature'"})
      try {
        makeVcHandler(deps).setup()
        const result = await invoke<IVcMergeResponse>(deps, VcEvents.MERGE, {
          action: 'continue',
        } satisfies IVcMergeRequest)

        expect(result.action).to.equal('continue')
        expect(result.defaultMessage).to.equal("Merge branch 'feature'")
        expect(deps.gitService.commit.called).to.be.false
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should commit when continuing with message', async () => {
      const deps = makeMergeDeps(sandbox, {mergeHead: true})
      try {
        deps.gitService.getConflicts.resolves([])
        makeVcHandler(deps).setup()
        const result = await invoke<IVcMergeResponse>(deps, VcEvents.MERGE, {
          action: 'continue',
          message: 'Resolved merge',
        } satisfies IVcMergeRequest)

        expect(result.action).to.equal('continue')
        expect(deps.gitService.commit.calledOnce).to.be.true
        expect(deps.gitService.commit.firstCall.args[0].message).to.equal('Resolved merge')
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw MERGE_CONFLICT when continuing with unresolved conflicts', async () => {
      const deps = makeMergeDeps(sandbox, {mergeHead: true})
      try {
        deps.gitService.getConflicts.resolves([{path: 'file.md', type: 'both_modified'}])

        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE](
            {action: 'continue', message: 'try commit'} satisfies IVcMergeRequest,
            CLIENT_ID,
          )
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.MERGE_CONFLICT)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })

    it('should throw NO_MERGE_IN_PROGRESS when continuing without MERGE_HEAD', async () => {
      const deps = makeMergeDeps(sandbox)
      try {
        makeVcHandler(deps).setup()
        try {
          await deps.requestHandlers[VcEvents.MERGE]({action: 'continue'} satisfies IVcMergeRequest, CLIENT_ID)
          expect.fail('Expected error')
        } catch (error) {
          expect(error).to.be.instanceOf(VcError)
          if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.NO_MERGE_IN_PROGRESS)
        }
      } finally {
        cleanupDir(deps.tmpDir)
      }
    })
  })

  // vc-remote-url start
  describe('handleRemoteUrl', () => {
    it('should return URL with embedded credentials when authenticated', async () => {
      const deps = makeDeps(sandbox, projectPath)
      const mockToken = new AuthToken({
        accessToken: 'test-acc',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'test-ref',
        sessionKey: 'sess-123',
        userEmail: 'test@example.com',
        userId: 'u1',
      })
      deps.tokenStore.load.resolves(mockToken)
      makeVcHandler(deps).setup()

      const result = await invoke<IVcRemoteUrlResponse>(deps, VcEvents.REMOTE_URL, {
        spaceId: 'space-1',
        teamId: 'team-1',
      })

      expect(result.url).to.equal('https://u1:sess-123@test-cogit.byterover.dev/git/team-1/space-1.git')
    })

    it('should throw NotAuthenticatedError when no token', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.tokenStore.load.resolves()
      makeVcHandler(deps).setup()

      try {
        await invoke<IVcRemoteUrlResponse>(deps, VcEvents.REMOTE_URL, {
          spaceId: 'space-1',
          teamId: 'team-1',
        })
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })

    it('should throw NotAuthenticatedError when token is expired', async () => {
      const deps = makeDeps(sandbox, projectPath)
      const expiredToken = new AuthToken({
        accessToken: 'test-acc',
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'test-ref',
        sessionKey: 'sess-123',
        userEmail: 'test@example.com',
        userId: 'u1',
      })
      deps.tokenStore.load.resolves(expiredToken)
      makeVcHandler(deps).setup()

      try {
        await invoke<IVcRemoteUrlResponse>(deps, VcEvents.REMOTE_URL, {
          spaceId: 'space-1',
          teamId: 'team-1',
        })
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })
  })
  // vc-remote-url end

  describe('handleFetch', () => {
    it('should fetch from origin when authenticated', async () => {
      const deps = makeDeps(sandbox, projectPath)
      const mockToken = new AuthToken({
        accessToken: 'test-acc',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'test-ref',
        sessionKey: 'sess-123',
        userEmail: 'test@example.com',
        userId: 'u1',
      })
      deps.tokenStore.load.resolves(mockToken)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.fetch.resolves()
      makeVcHandler(deps).setup()

      const result = await invoke<IVcFetchResponse>(deps, VcEvents.FETCH, {})

      expect(result.remote).to.equal('origin')
      expect(deps.gitService.fetch.calledOnce).to.be.true
      expect(deps.gitService.fetch.firstCall.args[0]).to.deep.include({remote: 'origin'})
    })

    it('should pass ref when provided', async () => {
      const deps = makeDeps(sandbox, projectPath)
      const mockToken = new AuthToken({
        accessToken: 'test-acc',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'test-ref',
        sessionKey: 'sess-123',
        userEmail: 'test@example.com',
        userId: 'u1',
      })
      deps.tokenStore.load.resolves(mockToken)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.fetch.resolves()
      makeVcHandler(deps).setup()

      await invoke<IVcFetchResponse>(deps, VcEvents.FETCH, {ref: 'main', remote: 'origin'})

      expect(deps.gitService.fetch.firstCall.args[0]).to.deep.include({ref: 'main', remote: 'origin'})
    })

    it('should throw NotAuthenticatedError when no token', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.tokenStore.load.resolves()
      makeVcHandler(deps).setup()

      try {
        await invoke<IVcFetchResponse>(deps, VcEvents.FETCH, {})
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })
  })

  describe('handlePull with explicit args', () => {
    it('should pull with explicit branch and remote', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.pull.resolves({alreadyUpToDate: false, success: true})
      makeVcHandler(deps).setup()

      const result = await invoke<IVcPullResponse>(deps, VcEvents.PULL, {branch: 'main', remote: 'origin'})

      expect(result.branch).to.equal('main')
      expect(deps.gitService.pull.calledOnce).to.be.true
      expect(deps.gitService.pull.firstCall.args[0]).to.deep.include({branch: 'main', remote: 'origin'})
    })

    it('should skip tracking resolution when explicit branch is given', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.pull.resolves({alreadyUpToDate: false, success: true})
      // No tracking configured — would error without explicit branch
      deps.gitService.getTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      const result = await invoke<IVcPullResponse>(deps, VcEvents.PULL, {branch: 'main', remote: 'origin'})

      expect(result.branch).to.equal('main')
      // getTrackingBranch should NOT have been called
      expect(deps.gitService.getTrackingBranch.called).to.be.false
    })

    it('should throw PULL_FAILED when empty repo has no current branch and no explicit branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      // Empty repo: getCurrentBranch returns undefined (no HEAD target)
      deps.gitService.getCurrentBranch.resolves()
      makeVcHandler(deps).setup()

      try {
        await invoke<IVcPullResponse>(deps, VcEvents.PULL, {})
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) {
          expect(error.code).to.equal(VcErrorCode.PULL_FAILED)
        }
      }
    })

    it('should succeed on empty repo when explicit branch is provided', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      // Empty repo: no current branch, no tracking — but explicit branch bypasses resolution
      deps.gitService.getCurrentBranch.resolves()
      deps.gitService.pull.resolves({alreadyUpToDate: false, success: true})
      makeVcHandler(deps).setup()

      const result = await invoke<IVcPullResponse>(deps, VcEvents.PULL, {branch: 'main', remote: 'origin'})

      expect(result.branch).to.equal('main')
      expect(result.alreadyUpToDate).to.be.false
      // Handler should NOT have attempted branch resolution
      expect(deps.gitService.getTrackingBranch.called).to.be.false
    })
  })

  describe('handleBranch set-upstream', () => {
    it('should set upstream tracking for current branch', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.getCurrentBranch.resolves('main')
      deps.gitService.setTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      const result = await invoke<IVcBranchResponse>(deps, VcEvents.BRANCH, {
        action: 'set-upstream',
        upstream: 'origin/main',
      } satisfies IVcBranchRequest)

      expect(result).to.deep.include({action: 'set-upstream', branch: 'main', upstream: 'origin/main'})
      expect(deps.gitService.setTrackingBranch.calledOnce).to.be.true
      expect(deps.gitService.setTrackingBranch.firstCall.args[0]).to.deep.include({
        branch: 'main',
        remote: 'origin',
        remoteBranch: 'main',
      })
    })

    it('should reject invalid upstream format without slash', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      makeVcHandler(deps).setup()

      try {
        await invoke<IVcBranchResponse>(deps, VcEvents.BRANCH, {
          action: 'set-upstream',
          upstream: 'main',
        } satisfies IVcBranchRequest)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.INVALID_BRANCH_NAME)
      }
    })
  })

  describe('handlePush — set upstream before push', () => {
    it('should set tracking even when push fails with non_fast_forward', async () => {
      const deps = makeDeps(sandbox, projectPath)
      deps.gitService.isInitialized.resolves(true)
      deps.gitService.listRemotes.resolves([{remote: 'origin', url: 'https://example.com/repo.git'}])
      deps.gitService.log.resolves([
        {author: {email: 'a@b.com', name: 'A'}, message: 'init', sha: 'abc', timestamp: new Date()},
      ])
      deps.gitService.push.resolves({reason: 'non_fast_forward', success: false})
      deps.gitService.getTrackingBranch.resolves()
      deps.gitService.setTrackingBranch.resolves()
      makeVcHandler(deps).setup()

      try {
        await deps.requestHandlers[VcEvents.PUSH]({branch: 'main', setUpstream: true}, CLIENT_ID)
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        if (error instanceof VcError) expect(error.code).to.equal(VcErrorCode.NON_FAST_FORWARD)
      }

      // Tracking should have been set BEFORE push failed
      expect(deps.gitService.setTrackingBranch.calledOnce).to.be.true
      expect(deps.gitService.setTrackingBranch.firstCall.args[0]).to.deep.include({
        branch: 'main',
        remote: 'origin',
        remoteBranch: 'main',
      })
    })
  })
})
