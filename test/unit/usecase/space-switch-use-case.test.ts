import {expect} from 'chai'
import * as sinon from 'sinon'

import type {Space} from '../../../src/server/core/domain/entities/space.js'
import type {Team} from '../../../src/server/core/domain/entities/team.js'
import type {ITokenStore} from '../../../src/server/core/interfaces/auth/i-token-store.js'
import type {ISpaceService} from '../../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../src/server/core/interfaces/services/i-team-service.js'
import type {ITerminal} from '../../../src/server/core/interfaces/services/i-terminal.js'
import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {BRV_CONFIG_VERSION} from '../../../src/server/constants.js'
import {AuthToken} from '../../../src/server/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/server/core/domain/entities/brv-config.js'
import {Space as SpaceEntity} from '../../../src/server/core/domain/entities/space.js'
import {Team as TeamEntity} from '../../../src/server/core/domain/entities/team.js'
import {
  SpaceSwitchUseCase,
  type SpaceSwitchUseCaseDependencies,
} from '../../../src/server/infra/usecase/space-switch-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

// ==================== TestableSpaceSwitchUseCase ====================

interface TestableSpaceSwitchUseCaseOptions extends SpaceSwitchUseCaseDependencies {
  mockSelectedSpace: Space
  mockSelectedTeam: Team
}

class TestableSpaceSwitchUseCase extends SpaceSwitchUseCase {
  private readonly mockSelectedSpace: Space
  private readonly mockSelectedTeam: Team

  constructor(options: TestableSpaceSwitchUseCaseOptions) {
    super(options)
    this.mockSelectedSpace = options.mockSelectedSpace
    this.mockSelectedTeam = options.mockSelectedTeam
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team> {
    return this.mockSelectedTeam
  }
}

// ==================== Test Helpers ====================

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
    expiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
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

const createMockSpaces = (): SpaceEntity[] => [
  new SpaceEntity('space-1', 'frontend-app', 'team-1', 'acme-corp'),
  new SpaceEntity('space-2', 'backend-api', 'team-1', 'acme-corp'),
]

const createMockTeams = (): TeamEntity[] => [
  new TeamEntity({
    avatarUrl: 'https://example.com/avatar1.png',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    description: 'Acme Corporation',
    displayName: 'Acme Corp',
    id: 'team-1',
    isActive: true,
    name: 'acme-corp',
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  }),
  new TeamEntity({
    avatarUrl: 'https://example.com/avatar2.png',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    description: 'Beta Company',
    displayName: 'Beta Co',
    id: 'team-2',
    isActive: true,
    name: 'beta-co',
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  }),
]

// ==================== Tests ====================

describe('SpaceSwitchUseCase', () => {
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let logMessages: string[]
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let teamService: sinon.SinonStubbedInstance<ITeamService>
  let terminal: ITerminal
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>

  beforeEach(() => {
    logMessages = []

    terminal = createMockTerminal({
      log: (msg) => msg !== undefined && logMessages.push(msg),
    })

    tokenStore = {
      clear: sinon.stub(),
      load: sinon.stub(),
      save: sinon.stub(),
    }

    spaceService = {
      getSpaces: sinon.stub(),
    }

    teamService = {
      getTeams: sinon.stub(),
    }

    configStore = {
      exists: sinon.stub(),
      getModifiedTime: sinon.stub(),
      read: sinon.stub(),
      write: sinon.stub(),
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  function createUseCase(selectedTeam: TeamEntity, selectedSpace: SpaceEntity): TestableSpaceSwitchUseCase {
    return new TestableSpaceSwitchUseCase({
      mockSelectedSpace: selectedSpace,
      mockSelectedTeam: selectedTeam,
      projectConfigStore: configStore,
      spaceService,
      teamService,
      terminal,
      tokenStore,
    })
  }

  describe('Project initialization', () => {
    it('should exit early if project not initialized', async () => {
      configStore.read.resolves()

      const teams = createMockTeams()
      const spaces = createMockSpaces()
      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(logMessages.some((msg) => msg.includes('Project not initialized'))).to.be.true
      expect(tokenStore.load.called).to.be.false
      expect(teamService.getTeams.called).to.be.false
    })
  })

  describe('Authentication', () => {
    it('should exit early if not authenticated', async () => {
      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves()

      const teams = createMockTeams()
      const spaces = createMockSpaces()
      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(logMessages.some((msg) => msg.includes('Not authenticated'))).to.be.true
      expect(teamService.getTeams.called).to.be.false
    })

    it('should exit early if token expired', async () => {
      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createExpiredToken())

      const teams = createMockTeams()
      const spaces = createMockSpaces()
      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(logMessages.some((msg) => msg.includes('token expired'))).to.be.true
      expect(teamService.getTeams.called).to.be.false
    })
  })

  describe('Team availability', () => {
    it('should exit early if no teams available', async () => {
      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams: [], total: 0})

      const teams = createMockTeams()
      const spaces = createMockSpaces()
      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(logMessages.some((msg) => msg.includes('No teams found'))).to.be.true
      expect(spaceService.getSpaces.called).to.be.false
    })
  })

  describe('Space availability', () => {
    it('should exit early if no spaces in selected team', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(logMessages.some((msg) => msg.includes('No spaces found'))).to.be.true
      expect(configStore.write.called).to.be.false
    })
  })

  describe('Successful switch', () => {
    it('should successfully switch to new space', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0]!, spaces[1]!) // Switch to second space

      await useCase.run()

      expect(configStore.write.calledOnce).to.be.true
      const writtenConfig = configStore.write.firstCall.args[0] as BrvConfig
      expect(writtenConfig.spaceId).to.equal('space-2')
      expect(writtenConfig.spaceName).to.equal('backend-api')
      expect(writtenConfig.teamId).to.equal('team-1')
      expect(writtenConfig.teamName).to.equal('acme-corp')
    })

    it('should display success message after switch', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(logMessages.some((msg) => msg.includes('Successfully switched'))).to.be.true
    })

    it('should preserve existing agent from config when switching space', async () => {
      configStore.read.resolves(createMockConfig()) // Has ide: 'Claude Code'
      tokenStore.load.resolves(createMockToken())
      const teams = createMockTeams()
      const spaces = createMockSpaces()
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0], spaces[1])

      await useCase.run()

      expect(configStore.write.calledOnce).to.be.true
      const writtenConfig = configStore.write.firstCall.args[0]
      expect(writtenConfig.ide).to.equal('Claude Code')
    })

    it('should preserve chatLogPath and cwd when switching spaces', async () => {
      configStore.read.resolves(createMockConfig()) // Has chatLogPath: 'chat.log', cwd: '/test/cwd'
      tokenStore.load.resolves(createMockToken())
      const teams = createMockTeams()
      const spaces = createMockSpaces()
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0], spaces[1])
      await useCase.run()

      const writtenConfig = configStore.write.firstCall.args[0]
      expect(writtenConfig.chatLogPath).to.equal('chat.log')
      expect(writtenConfig.cwd).to.equal('/test/cwd')
    })

    it('should preserve cipher agent settings when switching spaces', async () => {
      const cipherAgentContext = 'existing context'
      const cipherAgentModes = ['mode1', 'mode2']
      const cipherAgentSystemPrompt = 'existing prompt'
      const existingConfig = new BrvConfig({
        ...createMockConfig(),
        cipherAgentContext,
        cipherAgentModes,
        cipherAgentSystemPrompt,
      })
      configStore.read.resolves(existingConfig)
      tokenStore.load.resolves(createMockToken())
      const teams = createMockTeams()
      teamService.getTeams.resolves({teams, total: teams.length})
      const spaces = createMockSpaces()
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0], spaces[1])
      await useCase.run()

      const writtenConfig = configStore.write.firstCall.args[0]
      expect(writtenConfig.cipherAgentContext).to.equal(cipherAgentContext)
      expect(writtenConfig.cipherAgentModes).to.deep.equal(cipherAgentModes)
      expect(writtenConfig.cipherAgentSystemPrompt).to.equal(cipherAgentSystemPrompt)
    })
  })

  describe('API calls', () => {
    it('should call teamService with correct parameters', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(teamService.getTeams.calledOnce).to.be.true
      expect(
        teamService.getTeams.calledWith('session-key', {
          fetchAll: true,
        }),
      ).to.be.true
    })

    it('should call spaceService with correct parameters', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      await useCase.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
      expect(
        spaceService.getSpaces.calledWith('session-key', 'team-1', {
          fetchAll: true,
        }),
      ).to.be.true
    })
  })

  describe('Switch to different team', () => {
    it('should switch to a different team and space', async () => {
      const teams = createMockTeams()
      const spacesForTeam2 = [new SpaceEntity('space-3', 'mobile-app', 'team-2', 'beta-co')]

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces: spacesForTeam2, total: spacesForTeam2.length})
      configStore.write.resolves()

      const useCase = createUseCase(teams[1]!, spacesForTeam2[0]!) // Select second team

      await useCase.run()

      // Verify spaceService was called with the selected team ID
      expect(spaceService.getSpaces.calledWith('session-key', 'team-2', {fetchAll: true})).to.be.true

      // Verify config was updated with new team and space
      expect(configStore.write.calledOnce).to.be.true
      const writtenConfig = configStore.write.firstCall.args[0] as BrvConfig
      expect(writtenConfig.spaceId).to.equal('space-3')
      expect(writtenConfig.spaceName).to.equal('mobile-app')
      expect(writtenConfig.teamId).to.equal('team-2')
      expect(writtenConfig.teamName).to.equal('beta-co')
    })
  })

  describe('Error handling', () => {
    it('should handle team service errors gracefully', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.rejects(new Error('Network error'))

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      try {
        await useCase.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Network error')
      }
    })

    it('should handle space service errors gracefully', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.rejects(new Error('API error'))

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      try {
        await useCase.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('API error')
      }
    })

    it('should handle config store write errors gracefully', async () => {
      const teams = createMockTeams()
      const spaces = createMockSpaces()

      configStore.read.resolves(createMockConfig())
      tokenStore.load.resolves(createMockToken())
      teamService.getTeams.resolves({teams, total: teams.length})
      spaceService.getSpaces.resolves({spaces, total: spaces.length})
      configStore.write.rejects(new Error('Write failed'))

      const useCase = createUseCase(teams[0]!, spaces[0]!)

      try {
        await useCase.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Write failed')
      }
    })
  })
})
