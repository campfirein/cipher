import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {ISpaceService} from '../../../../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../../../src/server/core/interfaces/services/i-team-service.js'
import type {IUserService} from '../../../../../src/server/core/interfaces/services/i-user-service.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {Space} from '../../../../../src/server/core/domain/entities/space.js'
import {Team} from '../../../../../src/server/core/domain/entities/team.js'
import {User} from '../../../../../src/server/core/domain/entities/user.js'
import {OnboardingHandler} from '../../../../../src/server/infra/transport/handlers/onboarding-handler.js'
import {OnboardingEvents} from '../../../../../src/shared/transport/events/onboarding-events.js'

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

const createMockUser = (hasOnboardedCli = false): User =>
  new User({email: 'user@example.com', hasOnboardedCli, id: 'user-123', name: 'Test User'})

const createDefaultTeam = (): Team =>
  new Team({
    avatarUrl: '',
    createdAt: new Date('2024-01-01'),
    description: 'Default team',
    displayName: 'Default Team',
    id: 'team-1',
    isActive: true,
    isDefault: true,
    name: 'default-team',
    updatedAt: new Date('2024-01-01'),
  })

const createDefaultSpace = (): Space =>
  new Space({id: 'space-1', isDefault: true, name: 'default-space', teamId: 'team-1', teamName: 'default-team'})

// ==================== Tests ====================

describe('OnboardingHandler', () => {
  let projectConfigStore: SinonStubbedInstance<IProjectConfigStore>
  let resolveProjectPath: ReturnType<typeof stub>
  let spaceService: SinonStubbedInstance<ISpaceService>
  let teamService: SinonStubbedInstance<ITeamService>
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let transport: ReturnType<typeof createMockTransport>
  let userService: SinonStubbedInstance<IUserService>

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

    spaceService = {getSpaces: stub()}
    teamService = {getTeams: stub()}
    userService = {
      getCurrentUser: stub(),
      updateCurrentUser: stub(),
    }

    resolveProjectPath = stub().returns('/test/project')
    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): OnboardingHandler {
    const handler = new OnboardingHandler({
      projectConfigStore,
      resolveProjectPath,
      spaceService,
      teamService,
      tokenStore,
      transport,
      userService,
    })
    handler.setup()
    return handler
  }

  async function callGetStateHandler(
    clientId = 'client-1',
  ): Promise<{hasDefaultTeamSpace: boolean; hasOnboardedCli: boolean}> {
    const handler = transport._handlers.get(OnboardingEvents.GET_STATE)
    expect(handler, 'onboarding:getState handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  async function callAutoSetupHandler(clientId = 'client-1'): Promise<{error?: string; success: boolean}> {
    const handler = transport._handlers.get(OnboardingEvents.AUTO_SETUP)
    expect(handler, 'onboarding:autoSetup handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  async function callCompleteHandler(data?: {skipped?: boolean}): Promise<{success: boolean}> {
    const handler = transport._handlers.get(OnboardingEvents.COMPLETE)
    expect(handler, 'onboarding:complete handler should be registered').to.exist
    return handler!(data, 'client-1')
  }

  describe('setup', () => {
    it('should register all three onboarding handlers', () => {
      createHandler()
      expect(transport.onRequest.calledThrice).to.be.true
      expect(transport._handlers.has(OnboardingEvents.GET_STATE)).to.be.true
      expect(transport._handlers.has(OnboardingEvents.AUTO_SETUP)).to.be.true
      expect(transport._handlers.has(OnboardingEvents.COMPLETE)).to.be.true
    })
  })

  describe('getState', () => {
    it('should return state for authenticated user with existing config', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      userService.getCurrentUser.resolves(createMockUser(true))
      projectConfigStore.exists.resolves(true)

      const result = await callGetStateHandler()

      expect(result.hasOnboardedCli).to.be.true
      expect(result.hasDefaultTeamSpace).to.be.true
    })

    it('should return hasOnboardedCli=false for new user', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      userService.getCurrentUser.resolves(createMockUser(false))
      projectConfigStore.exists.resolves(false)

      const result = await callGetStateHandler()

      expect(result.hasOnboardedCli).to.be.false
      expect(result.hasDefaultTeamSpace).to.be.false
    })

    it('should return defaults when not authenticated', async () => {
      createHandler()
      tokenStore.load.resolves()

      const result = await callGetStateHandler()

      expect(result.hasOnboardedCli).to.be.false
      expect(result.hasDefaultTeamSpace).to.be.false
    })

    it('should return defaults when token is expired', async () => {
      createHandler()
      tokenStore.load.resolves(createExpiredToken())

      const result = await callGetStateHandler()

      expect(result.hasOnboardedCli).to.be.false
      expect(result.hasDefaultTeamSpace).to.be.false
    })

    it('should return defaults when user service throws', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      userService.getCurrentUser.rejects(new Error('Network error'))

      const result = await callGetStateHandler()

      expect(result.hasOnboardedCli).to.be.false
      expect(result.hasDefaultTeamSpace).to.be.false
    })

    it('should resolve project path from clientId', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      userService.getCurrentUser.resolves(createMockUser())
      projectConfigStore.exists.resolves(false)

      await callGetStateHandler('client-42')

      expect(resolveProjectPath.calledWith('client-42')).to.be.true
      expect(projectConfigStore.exists.calledWith('/test/project')).to.be.true
    })
  })

  describe('autoSetup', () => {
    it('should auto-setup with default team and space', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams: [createDefaultTeam()], total: 1})
      spaceService.getSpaces.resolves({spaces: [createDefaultSpace()], total: 1})
      projectConfigStore.write.resolves()

      const result = await callAutoSetupHandler()

      expect(result.success).to.be.true
      expect(result.error).to.be.undefined
      expect(projectConfigStore.write.calledOnce).to.be.true
    })

    it('should return error when not authenticated', async () => {
      createHandler()
      tokenStore.load.resolves()

      const result = await callAutoSetupHandler()

      expect(result.success).to.be.false
      expect(result.error).to.equal('Not authenticated')
    })

    it('should return error when no default team found', async () => {
      const nonDefaultTeam = new Team({
        avatarUrl: '',
        createdAt: new Date('2024-01-01'),
        description: 'Non-default',
        displayName: 'Non Default',
        id: 'team-1',
        isActive: true,
        isDefault: false,
        name: 'non-default',
        updatedAt: new Date('2024-01-01'),
      })

      createHandler()
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams: [nonDefaultTeam], total: 1})

      const result = await callAutoSetupHandler()

      expect(result.success).to.be.false
      expect(result.error).to.equal('No default team found')
    })

    it('should return error when no default space found', async () => {
      const nonDefaultSpace = new Space({
        id: 'space-1',
        isDefault: false,
        name: 'non-default-space',
        teamId: 'team-1',
        teamName: 'default-team',
      })

      createHandler()
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams: [createDefaultTeam()], total: 1})
      spaceService.getSpaces.resolves({spaces: [nonDefaultSpace], total: 1})

      const result = await callAutoSetupHandler()

      expect(result.success).to.be.false
      expect(result.error).to.equal('No default space found')
    })

    it('should return error message when team service throws', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.rejects(new Error('API unavailable'))

      const result = await callAutoSetupHandler()

      expect(result.success).to.be.false
      expect(result.error).to.include('API unavailable')
    })

    it('should call spaceService with correct team id', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams: [createDefaultTeam()], total: 1})
      spaceService.getSpaces.resolves({spaces: [createDefaultSpace()], total: 1})
      projectConfigStore.write.resolves()

      await callAutoSetupHandler()

      expect(spaceService.getSpaces.calledWith('session-key', 'team-1', {fetchAll: true})).to.be.true
    })

    it('should resolve project path from clientId', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams: [createDefaultTeam()], total: 1})
      spaceService.getSpaces.resolves({spaces: [createDefaultSpace()], total: 1})
      projectConfigStore.write.resolves()

      await callAutoSetupHandler('client-42')

      expect(resolveProjectPath.calledWith('client-42')).to.be.true
    })
  })

  describe('complete', () => {
    it('should mark user as onboarded', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      userService.updateCurrentUser.resolves(createMockUser(true))

      const result = await callCompleteHandler()

      expect(result.success).to.be.true
      expect(userService.updateCurrentUser.calledWith('session-key', {hasOnboardedCli: true})).to.be.true
    })

    it('should return success=false when not authenticated', async () => {
      createHandler()
      tokenStore.load.resolves()

      const result = await callCompleteHandler()

      expect(result.success).to.be.false
      expect(userService.updateCurrentUser.called).to.be.false
    })

    it('should return success=false when user service throws', async () => {
      createHandler()
      tokenStore.load.resolves(createMockToken())
      userService.updateCurrentUser.rejects(new Error('Network error'))

      const result = await callCompleteHandler()

      expect(result.success).to.be.false
    })
  })
})
