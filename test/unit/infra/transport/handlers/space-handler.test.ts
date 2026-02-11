import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {ISpaceService} from '../../../../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../../../src/server/core/interfaces/services/i-team-service.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {BRV_CONFIG_VERSION} from '../../../../../src/server/constants.js'
import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../../../src/server/core/domain/entities/brv-config.js'
import {Space} from '../../../../../src/server/core/domain/entities/space.js'
import {SpaceHandler} from '../../../../../src/server/infra/transport/handlers/space-handler.js'
import {SpaceEvents} from '../../../../../src/shared/transport/events/space-events.js'

// ==================== Test Helpers ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any, clientId: string) => any

function createMockTransport(): SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>} {
  const handlers = new Map<string, AnyHandler>()
  return {
    _handlers: handlers,
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub(),
    isRunning: stub(),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub().callsFake((event: string, handler: AnyHandler) => {
      handlers.set(event, handler)
    }),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub(),
    stop: stub(),
  } as unknown as SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>}
}

const createMockToken = (): AuthToken =>
  new AuthToken({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: 'refresh-token',
    sessionKey: 'session-key',
    tokenType: 'Bearer',
    userEmail: 'user@example.com',
    userId: 'user-123',
  })

const createExpiredToken = (): AuthToken =>
  new AuthToken({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() - 1000),
    refreshToken: 'refresh-token',
    sessionKey: 'session-key',
    tokenType: 'Bearer',
    userEmail: 'user@example.com',
    userId: 'user-expired',
  })

const createMockConfig = (): BrvConfig =>
  new BrvConfig({
    chatLogPath: 'chat.log',
    createdAt: '2024-01-01T00:00:00.000Z',
    cwd: '/test/cwd',
    ide: 'Claude Code',
    spaceId: 'space-1',
    spaceName: 'frontend-app',
    teamId: 'team-1',
    teamName: 'acme-corp',
    version: BRV_CONFIG_VERSION,
  })

const createMockSpaces = (): Space[] => [
  new Space({id: 'space-1', isDefault: true, name: 'frontend-app', teamId: 'team-1', teamName: 'acme-corp'}),
  new Space({id: 'space-2', isDefault: false, name: 'backend-api', teamId: 'team-1', teamName: 'acme-corp'}),
]

// ==================== Tests ====================

describe('SpaceHandler', () => {
  let projectConfigStore: SinonStubbedInstance<IProjectConfigStore>
  let resolveProjectPath: ReturnType<typeof stub>
  let spaceService: SinonStubbedInstance<ISpaceService>
  let teamService: SinonStubbedInstance<ITeamService>
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    projectConfigStore = {
      exists: stub(),
      getModifiedTime: stub(),
      read: stub(),
      write: stub(),
    }

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    spaceService = {
      getSpaces: stub(),
    }

    teamService = {
      getTeams: stub(),
    }

    resolveProjectPath = stub().returns('/test/project')
    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): SpaceHandler {
    const handler = new SpaceHandler({
      projectConfigStore,
      resolveProjectPath,
      spaceService,
      teamService,
      tokenStore,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callListHandler(clientId = 'client-1'): Promise<{error?: string; spaces: unknown[]}> {
    const handler = transport._handlers.get(SpaceEvents.LIST)
    expect(handler, 'space:list handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  async function callSwitchHandler(
    data: {spaceId: string},
    clientId = 'client-1',
  ): Promise<{config?: unknown; error?: string; success: boolean}> {
    const handler = transport._handlers.get(SpaceEvents.SWITCH)
    expect(handler, 'space:switch handler should be registered').to.exist
    return handler!(data, clientId)
  }

  describe('setup', () => {
    it('should register space:list and space:switch handlers', () => {
      createHandler()
      expect(transport.onRequest.calledTwice).to.be.true
      expect(transport._handlers.has(SpaceEvents.LIST)).to.be.true
      expect(transport._handlers.has(SpaceEvents.SWITCH)).to.be.true
    })
  })

  describe('handleList', () => {
    it('should return spaces when authenticated and initialized', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      const result = await callListHandler()

      expect(result.spaces).to.have.lengthOf(2)
      expect(result.spaces[0]).to.deep.include({id: 'space-1', isDefault: true, name: 'frontend-app'})
      expect(result.spaces[1]).to.deep.include({id: 'space-2', isDefault: false, name: 'backend-api'})
    })

    it('should throw when not authenticated', async () => {
      createHandler()
      tokenStore.load.resolves()

      try {
        await callListHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Not authenticated')
      }
    })

    it('should throw when token is expired', async () => {
      createHandler()
      tokenStore.load.resolves(createExpiredToken())

      try {
        await callListHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Not authenticated')
      }
    })

    it('should throw when project not initialized', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves()

      try {
        await callListHandler()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Project not initialized')
      }
    })

    it('should call spaceService with correct parameters', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      await callListHandler()

      expect(spaceService.getSpaces.calledWith('session-key', 'team-1', {fetchAll: true})).to.be.true
    })

    it('should return empty array when no spaces found', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const result = await callListHandler()

      expect(result.spaces).to.have.lengthOf(0)
    })

    it('should resolve project path from clientId', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      await callListHandler('client-42')

      expect(resolveProjectPath.calledWith('client-42')).to.be.true
      expect(projectConfigStore.read.calledWith('/test/project')).to.be.true
    })
  })

  describe('handleSwitch', () => {
    it('should switch space successfully', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})
      projectConfigStore.write.resolves()

      const result = await callSwitchHandler({spaceId: 'space-2'})

      expect(result.success).to.be.true
      expect(result.config).to.deep.include({
        spaceId: 'space-2',
        spaceName: 'backend-api',
        teamId: 'team-1',
        teamName: 'acme-corp',
      })
    })

    it('should throw when not authenticated', async () => {
      createHandler()
      tokenStore.load.resolves()

      try {
        await callSwitchHandler({spaceId: 'space-2'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Not authenticated')
      }
    })

    it('should throw when token is expired', async () => {
      createHandler()
      tokenStore.load.resolves(createExpiredToken())

      try {
        await callSwitchHandler({spaceId: 'space-2'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Not authenticated')
      }
    })

    it('should throw when project not initialized', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves()

      try {
        await callSwitchHandler({spaceId: 'space-2'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Project not initialized')
      }
    })

    it('should throw when target space not found', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})

      try {
        await callSwitchHandler({spaceId: 'nonexistent-space'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Space not found')
      }
    })

    it('should write new config with updated space fields', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})
      projectConfigStore.write.resolves()

      await callSwitchHandler({spaceId: 'space-2'})

      expect(projectConfigStore.write.calledOnce).to.be.true
      const writtenConfig = projectConfigStore.write.firstCall.args[0] as BrvConfig
      expect(writtenConfig.spaceId).to.equal('space-2')
      expect(writtenConfig.spaceName).to.equal('backend-api')
      expect(writtenConfig.teamId).to.equal('team-1')
      expect(writtenConfig.teamName).to.equal('acme-corp')
    })

    it('should preserve existing config fields when switching space', async () => {
      const existingConfig = new BrvConfig({
        chatLogPath: 'chat.log',
        cipherAgentContext: 'existing context',
        cipherAgentModes: ['mode1', 'mode2'],
        cipherAgentSystemPrompt: 'existing prompt',
        createdAt: '2024-01-01T00:00:00.000Z',
        cwd: '/test/cwd',
        ide: 'Claude Code',
        spaceId: 'space-1',
        spaceName: 'frontend-app',
        teamId: 'team-1',
        teamName: 'acme-corp',
        version: BRV_CONFIG_VERSION,
      })

      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(existingConfig)
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})
      projectConfigStore.write.resolves()

      await callSwitchHandler({spaceId: 'space-2'})

      const writtenConfig = projectConfigStore.write.firstCall.args[0] as BrvConfig
      expect(writtenConfig.chatLogPath).to.equal('chat.log')
      expect(writtenConfig.cwd).to.equal('/test/cwd')
      expect(writtenConfig.ide).to.equal('Claude Code')
      expect(writtenConfig.cipherAgentContext).to.equal('existing context')
      expect(writtenConfig.cipherAgentModes).to.deep.equal(['mode1', 'mode2'])
      expect(writtenConfig.cipherAgentSystemPrompt).to.equal('existing prompt')
    })

    it('should resolve project path from clientId', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})
      projectConfigStore.write.resolves()

      await callSwitchHandler({spaceId: 'space-2'}, 'client-42')

      expect(resolveProjectPath.calledWith('client-42')).to.be.true
    })

    it('should fall back to process.cwd() when project path is undefined', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      resolveProjectPath.returns(undefined)
      createHandler()
      tokenStore.load.resolves(createMockToken())
      projectConfigStore.read.resolves(createMockConfig())
      spaceService.getSpaces.resolves({spaces: createMockSpaces(), total: 2})
      projectConfigStore.write.resolves()

      await callSwitchHandler({spaceId: 'space-2'})

      expect(projectConfigStore.read.calledWith(process.cwd())).to.be.true
    })
  })
})
