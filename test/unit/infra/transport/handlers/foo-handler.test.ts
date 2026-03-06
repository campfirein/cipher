/**
 * FooHandler Unit Tests
 *
 * Tests git init demo flow (ENG-684):
 * - git init → add → commit → addRemote sequence
 * - Auth token validation
 * - Idempotent: skip re-init if repo already exists, skip addRemote if 'origin' present
 * - Response shape
 */

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../../src/server/constants.js'
import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {NotAuthenticatedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {FooHandler} from '../../../../../src/server/infra/transport/handlers/foo-handler.js'
import {FooEvents} from '../../../../../src/shared/transport/events/foo-events.js'

const CLIENT_ID = 'client-abc'
const TEAM_ID = 'team1'
const SPACE_ID = 'space1'
const COGIT_BASE = 'https://fake-cgit.example.com'
const REMOTE_URL = `${COGIT_BASE}/git/${TEAM_ID}/${SPACE_ID}.git`

function buildRemoteUrl(teamId: string, spaceId: string): string {
  return `${COGIT_BASE}/git/${teamId}/${spaceId}.git`
}

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

  const contextTreeService = {
    initialize: sandbox.stub().resolves(contextTreeDirPath),
  } as unknown as IContextTreeService

  const gitService = {
    add: sandbox.stub().resolves(),
    addRemote: sandbox.stub().resolves(),
    commit: sandbox.stub().resolves({
      author: {email: 'test@example.com', name: 'test@example.com'},
      message: 'Initialize context tree',
      sha: 'abc123',
      timestamp: new Date(),
    }),
    init: sandbox.stub().resolves(),
    isInitialized: sandbox.stub().resolves(false),
    listRemotes: sandbox.stub().resolves([]),
  } as unknown as IGitService

  const tokenStore = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(makeValidToken()),
    save: sandbox.stub().resolves(),
  } as unknown as ITokenStore

  const resolveProjectPath = sandbox.stub().returns(projectPath)

  // Capture registered handlers keyed by event name
  const requestHandlers: Record<string, (data: unknown, clientId: string) => Promise<unknown>> = {}
  const transport = {
    onRequest: sandbox
      .stub()
      .callsFake((event: string, handler: (data: unknown, clientId: string) => Promise<unknown>) => {
        requestHandlers[event] = handler
      }),
  } as unknown as ITransportServer

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

describe('FooHandler', () => {
  let sandbox: SinonSandbox
  let projectPath: string

  beforeEach(async () => {
    sandbox = createSandbox()
    projectPath = await mkdtemp(join(tmpdir(), 'foo-handler-test-'))
  })

  afterEach(async () => {
    sandbox.restore()
    await rm(projectPath, {force: true, recursive: true})
  })

  describe('setup()', () => {
    it('should register handler for foo:init event', () => {
      const {contextTreeService, gitService, resolveProjectPath, tokenStore, transport} = makeDeps(sandbox, projectPath)
      const handler = new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      })

      handler.setup()

      expect((transport.onRequest as SinonStub).calledOnce).to.be.true
      expect((transport.onRequest as SinonStub).firstCall.args[0]).to.equal(FooEvents.INIT)
    })
  })

  describe('handleInit — fresh repo (isInitialized=false)', () => {
    it('should call contextTreeService.initialize with projectPath', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

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
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect((gitService.init as SinonStub).calledOnce).to.be.true
      expect((gitService.init as SinonStub).firstCall.args[0]).to.deep.equal({
        defaultBranch: 'main',
        directory: contextTreeDirPath,
      })
    })

    it('should call gitService.add with filePaths ["."]', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect((gitService.add as SinonStub).calledOnce).to.be.true
      expect((gitService.add as SinonStub).firstCall.args[0]).to.deep.equal({
        directory: contextTreeDirPath,
        filePaths: ['.'],
      })
    })

    it('should call gitService.commit with correct message', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect((gitService.commit as SinonStub).calledOnce).to.be.true
      expect((gitService.commit as SinonStub).firstCall.args[0]).to.deep.equal({
        directory: contextTreeDirPath,
        message: 'Initialize context tree',
      })
    })

    it('should call gitService.addRemote with remote origin and correct URL', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect((gitService.addRemote as SinonStub).calledOnce).to.be.true
      expect((gitService.addRemote as SinonStub).firstCall.args[0]).to.deep.equal({
        directory: contextTreeDirPath,
        remote: 'origin',
        url: REMOTE_URL,
      })
    })

    it('should return response with gitDir and remoteUrl', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      const result = await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect(result).to.deep.equal({
        gitDir: join(join(projectPath, BRV_DIR, CONTEXT_TREE_DIR), '.git'),
        remoteUrl: REMOTE_URL,
      })
    })

    it('should call git operations in correct order: init → add → commit → addRemote', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      const callOrder: string[] = []
      ;(gitService.init as SinonStub).callsFake(async () => {
        callOrder.push('init')
      })
      ;(gitService.add as SinonStub).callsFake(async () => {
        callOrder.push('add')
      })
      ;(gitService.commit as SinonStub).callsFake(async () => {
        callOrder.push('commit')
      })
      ;(gitService.addRemote as SinonStub).callsFake(async () => {
        callOrder.push('addRemote')
      })
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect(callOrder).to.deep.equal(['init', 'add', 'commit', 'addRemote'])
    })
  })

  describe('handleInit — repo already exists (isInitialized=true)', () => {
    it('should skip init/add/commit when repo already initialized', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.isInitialized as SinonStub).resolves(true)
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect((gitService.init as SinonStub).called).to.be.false
      expect((gitService.add as SinonStub).called).to.be.false
      expect((gitService.commit as SinonStub).called).to.be.false
    })

    it('should skip addRemote when origin already configured', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(gitService.listRemotes as SinonStub).resolves([{remote: 'origin', url: REMOTE_URL}])
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

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
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      try {
        await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)
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
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      try {
        await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)
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
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)

      expect((resolveProjectPath as SinonStub).calledWith(CLIENT_ID)).to.be.true
    })

    it('should throw when project path cannot be resolved', async () => {
      const {contextTreeService, gitService, requestHandlers, resolveProjectPath, tokenStore, transport} = makeDeps(
        sandbox,
        projectPath,
      )
      ;(resolveProjectPath as SinonStub).callsFake(() => {})
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      try {
        await requestHandlers[FooEvents.INIT]({spaceId: SPACE_ID, teamId: TEAM_ID}, CLIENT_ID)
        expect.fail('Expected error for missing project path')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('No project path found')
      }
    })
  })

  describe('URL building', () => {
    it('should pass teamId and spaceId to buildRemoteUrl and use result as remote URL', async () => {
      const {
        contextTreeDirPath,
        contextTreeService,
        gitService,
        requestHandlers,
        resolveProjectPath,
        tokenStore,
        transport,
      } = makeDeps(sandbox, projectPath)
      new FooHandler({
        buildRemoteUrl,
        contextTreeService,
        gitService,
        resolveProjectPath,
        tokenStore,
        transport,
      }).setup()

      await requestHandlers[FooEvents.INIT]({spaceId: 'my-space', teamId: 'my-team'}, CLIENT_ID)

      expect((gitService.addRemote as SinonStub).firstCall.args[0]).to.deep.equal({
        directory: contextTreeDirPath,
        remote: 'origin',
        url: `${COGIT_BASE}/git/my-team/my-space.git`,
      })
    })
  })
})
