import {expect} from 'chai'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {
  GitStatus,
  GitStatusFile,
  IGitService,
} from '../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../../src/server/constants.js'
import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../../src/shared/transport/events/status-events.js'

const PROJECT_PATH = '/fake/project'
const CONTEXT_TREE_DIR_PATH = join(PROJECT_PATH, BRV_DIR, CONTEXT_TREE_DIR)
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

function makeExpiredToken(): AuthToken {
  return new AuthToken({
    accessToken: 'expired-token',
    expiresAt: new Date(Date.now() - 1000),
    refreshToken: 'refresh-token',
    sessionKey: 'session-key',
    userEmail: 'test@example.com',
    userId: 'user-123',
  })
}

function makeGitStatus(files: GitStatusFile[]): GitStatus {
  return {files, isClean: files.length === 0}
}

describe('StatusHandler', () => {
  let sandbox: SinonSandbox
  let contextTreeService: IContextTreeService
  let gitService: IGitService
  let projectConfigStore: IProjectConfigStore
  let tokenStore: ITokenStore
  let resolveProjectPath: SinonStub
  let requestHandlers: Record<string, RequestHandler>
  let transport: ITransportServer

  beforeEach(() => {
    sandbox = createSandbox()
    requestHandlers = {}

    contextTreeService = {
      delete: sandbox.stub().resolves(),
      exists: sandbox.stub().resolves(false),
      initialize: sandbox.stub().resolves(CONTEXT_TREE_DIR_PATH),
    }

    gitService = {
      add: sandbox.stub().resolves(),
      addRemote: sandbox.stub().resolves(),
      checkout: sandbox.stub().resolves(),
      commit: sandbox.stub().resolves({
        author: {email: 'test@example.com', name: 'test@example.com'},
        message: 'init',
        sha: 'abc123',
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
      listRemotes: sandbox.stub().resolves([]),
      log: sandbox.stub().resolves([]),
      merge: sandbox.stub().resolves({success: true}),
      pull: sandbox.stub().resolves({success: true}),
      push: sandbox.stub().resolves({success: true}),
      removeRemote: sandbox.stub().resolves(),
      status: sandbox.stub().resolves(makeGitStatus([])),
    }

    projectConfigStore = {
      exists: sandbox.stub().resolves(false),
      getModifiedTime: sandbox.stub().resolves(),
      read: sandbox.stub().resolves(),
      write: sandbox.stub().resolves(),
    }

    tokenStore = {
      clear: sandbox.stub().resolves(),
      load: sandbox.stub().resolves(makeValidToken()),
      save: sandbox.stub().resolves(),
    }

    resolveProjectPath = sandbox.stub().returns(PROJECT_PATH)

    transport = {
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
  })

  afterEach(() => {
    sandbox.restore()
  })

  function createHandler(): StatusHandler {
    const handler = new StatusHandler({
      contextTreeService,
      gitService,
      projectConfigStore,
      resolveProjectPath,
      tokenStore,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callStatusHandler(): Promise<{
    status: import('../../../../../src/shared/transport/types/dto.js').StatusDTO
  }> {
    createHandler()
    const handler = requestHandlers[StatusEvents.GET]
    expect(handler, 'status:get handler should be registered').to.exist
    return handler(undefined, CLIENT_ID) as Promise<{
      status: import('../../../../../src/shared/transport/types/dto.js').StatusDTO
    }>
  }

  // ==================== setup() ====================

  describe('setup()', () => {
    it('should register status:get handler', () => {
      createHandler()
      expect((transport.onRequest as SinonStub).calledOnce).to.be.true
      expect((transport.onRequest as SinonStub).firstCall.args[0]).to.equal(StatusEvents.GET)
    })
  })

  // ==================== auth status ====================

  describe('auth status', () => {
    it('returns logged_in and userEmail when token is valid', async () => {
      ;(tokenStore.load as SinonStub).resolves(makeValidToken())
      const {status} = await callStatusHandler()

      expect(status.authStatus).to.equal('logged_in')
      expect(status.userEmail).to.equal('test@example.com')
    })

    it('returns not_logged_in when tokenStore.load() resolves undefined', async () => {
      ;(tokenStore.load as SinonStub).resolves()
      const {status} = await callStatusHandler()

      expect(status.authStatus).to.equal('not_logged_in')
      expect(status.userEmail).to.be.undefined
    })

    it('returns expired when token exists but isValid() = false', async () => {
      ;(tokenStore.load as SinonStub).resolves(makeExpiredToken())
      const {status} = await callStatusHandler()

      expect(status.authStatus).to.equal('expired')
    })

    it('returns unknown when tokenStore.load() throws', async () => {
      ;(tokenStore.load as SinonStub).rejects(new Error('storage error'))
      const {status} = await callStatusHandler()

      expect(status.authStatus).to.equal('unknown')
    })
  })

  // ==================== project status ====================

  describe('project status', () => {
    it('populates teamName and spaceName from config when initialized', async () => {
      ;(projectConfigStore.exists as SinonStub).resolves(true)
      ;(projectConfigStore.read as SinonStub).resolves({
        spaceName: 'backend-api',
        teamName: 'acme-corp',
      })
      const {status} = await callStatusHandler()

      expect(status.teamName).to.equal('acme-corp')
      expect(status.spaceName).to.equal('backend-api')
    })

    it('silently skips when projectConfigStore.exists() throws', async () => {
      ;(projectConfigStore.exists as SinonStub).rejects(new Error('fs error'))
      const {status} = await callStatusHandler()

      expect(status.teamName).to.be.undefined
      expect(status.spaceName).to.be.undefined
    })
  })

  // ==================== context tree status (git-based) ====================

  describe('context tree status', () => {
    describe('when context tree does not exist', () => {
      beforeEach(() => {
        ;(contextTreeService.exists as SinonStub).resolves(false)
      })

      it('returns not_initialized', async () => {
        const {status} = await callStatusHandler()
        expect(status.contextTreeStatus).to.equal('not_initialized')
      })

      it('does not call gitService', async () => {
        await callStatusHandler()
        expect((gitService.isInitialized as SinonStub).called).to.be.false
        expect((gitService.status as SinonStub).called).to.be.false
      })
    })

    describe('when context tree exists but git is not initialized', () => {
      beforeEach(() => {
        ;(contextTreeService.exists as SinonStub).resolves(true)
        ;(gitService.isInitialized as SinonStub).resolves(false)
      })

      it('returns not_initialized', async () => {
        const {status} = await callStatusHandler()
        expect(status.contextTreeStatus).to.equal('not_initialized')
      })

      it('calls isInitialized with contextTreeDir', async () => {
        await callStatusHandler()
        expect((gitService.isInitialized as SinonStub).calledOnceWith({directory: CONTEXT_TREE_DIR_PATH})).to.be.true
      })

      it('does not call gitService.status()', async () => {
        await callStatusHandler()
        expect((gitService.status as SinonStub).called).to.be.false
      })
    })

    describe('when git is initialized and working tree is clean', () => {
      beforeEach(() => {
        ;(contextTreeService.exists as SinonStub).resolves(true)
        ;(gitService.isInitialized as SinonStub).resolves(true)
        ;(gitService.status as SinonStub).resolves(makeGitStatus([]))
        ;(gitService.getCurrentBranch as SinonStub).resolves('main')
      })

      it('returns no_changes', async () => {
        const {status} = await callStatusHandler()
        expect(status.contextTreeStatus).to.equal('no_changes')
      })

      it('populates gitBranch from getCurrentBranch()', async () => {
        ;(gitService.getCurrentBranch as SinonStub).resolves('feat/my-branch')
        const {status} = await callStatusHandler()
        expect(status.gitBranch).to.equal('feat/my-branch')
      })

      it('gitBranch is undefined when getCurrentBranch() returns undefined (detached HEAD)', async () => {
        ;(gitService.getCurrentBranch as SinonStub).resolves()
        const {status} = await callStatusHandler()
        expect(status.gitBranch).to.be.undefined
      })

      it('gitChanges is not set when clean', async () => {
        const {status} = await callStatusHandler()
        expect(status.gitChanges).to.be.undefined
      })
    })

    describe('when git is initialized and has changes', () => {
      beforeEach(() => {
        ;(contextTreeService.exists as SinonStub).resolves(true)
        ;(gitService.isInitialized as SinonStub).resolves(true)
        ;(gitService.getCurrentBranch as SinonStub).resolves('main')
      })

      it('returns has_changes with staged added files', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([{path: 'design/context.md', staged: true, status: 'added'}]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.staged.added).to.deep.equal(['design/context.md'])
        expect(status.gitChanges?.staged.modified).to.deep.equal([])
        expect(status.gitChanges?.staged.deleted).to.deep.equal([])
      })

      it('returns has_changes with staged modified files', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([{path: 'structure/context.md', staged: true, status: 'modified'}]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.staged.modified).to.deep.equal(['structure/context.md'])
      })

      it('returns has_changes with staged deleted files', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([{path: 'old/context.md', staged: true, status: 'deleted'}]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.staged.deleted).to.deep.equal(['old/context.md'])
      })

      it('returns has_changes with unstaged modified files', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([{path: 'edited/context.md', staged: false, status: 'modified'}]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.unstaged.modified).to.deep.equal(['edited/context.md'])
      })

      it('returns has_changes with unstaged deleted files', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([{path: 'removed/context.md', staged: false, status: 'deleted'}]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.unstaged.deleted).to.deep.equal(['removed/context.md'])
      })

      it('returns has_changes with untracked files', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([{path: 'new-file.md', staged: false, status: 'untracked'}]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.untracked).to.deep.equal(['new-file.md'])
        expect(status.gitChanges?.unstaged.modified).to.deep.equal([])
      })

      it('returns has_changes with mixed staged and unstaged changes', async () => {
        ;(gitService.status as SinonStub).resolves(
          makeGitStatus([
            {path: 'staged-new.md', staged: true, status: 'added'},
            {path: 'staged-mod.md', staged: true, status: 'modified'},
            {path: 'unstaged-mod.md', staged: false, status: 'modified'},
            {path: 'untracked.md', staged: false, status: 'untracked'},
          ]),
        )
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('has_changes')
        expect(status.gitChanges?.staged.added).to.deep.equal(['staged-new.md'])
        expect(status.gitChanges?.staged.modified).to.deep.equal(['staged-mod.md'])
        expect(status.gitChanges?.unstaged.modified).to.deep.equal(['unstaged-mod.md'])
        expect(status.gitChanges?.untracked).to.deep.equal(['untracked.md'])
      })
    })

    describe('error handling', () => {
      it('returns unknown when gitService.status() throws', async () => {
        ;(contextTreeService.exists as SinonStub).resolves(true)
        ;(gitService.isInitialized as SinonStub).resolves(true)
        ;(gitService.status as SinonStub).rejects(new Error('git error'))
        const {status} = await callStatusHandler()

        expect(status.contextTreeStatus).to.equal('unknown')
      })
    })
  })
})
