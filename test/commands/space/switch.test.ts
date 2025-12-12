import {Config} from '@oclif/core'
import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {Agent} from '../../../src/core/domain/entities/agent.js'
import type {Space} from '../../../src/core/domain/entities/space.js'
import type {Team} from '../../../src/core/domain/entities/team.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../../src/core/interfaces/i-space-service.js'
import type {ITeamService} from '../../../src/core/interfaces/i-team-service.js'
import type {ITerminal} from '../../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'
import type {IWorkspaceDetectorService} from '../../../src/core/interfaces/i-workspace-detector-service.js'
import type {ISpaceSwitchUseCase} from '../../../src/core/interfaces/usecase/i-space-switch-use-case.js'

import SpaceSwitch from '../../../src/commands/space/switch.js'
import {BRV_CONFIG_VERSION} from '../../../src/constants.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {Space as SpaceEntity} from '../../../src/core/domain/entities/space.js'
import {Team as TeamEntity} from '../../../src/core/domain/entities/team.js'
import {SpaceSwitchUseCase} from '../../../src/infra/usecase/space-switch-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

interface TestableUseCaseOptions {
  mockSelectedAgent: Agent
  mockSelectedSpace: Space
  mockSelectedTeam: Team
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  teamService: ITeamService
  terminal: ITerminal
  tokenStore: ITokenStore
  workspaceDetector: IWorkspaceDetectorService
}

/**
 * Testable use case that allows overriding prompts
 */
class TestableSpaceSwitchUseCase extends SpaceSwitchUseCase {
  private readonly mockSelectedAgent: Agent
  private readonly mockSelectedSpace: Space
  private readonly mockSelectedTeam: Team

  constructor(options: TestableUseCaseOptions) {
    super({
      projectConfigStore: options.projectConfigStore,
      spaceService: options.spaceService,
      teamService: options.teamService,
      terminal: options.terminal,
      tokenStore: options.tokenStore,
      workspaceDetector: options.workspaceDetector,
    })
    this.mockSelectedAgent = options.mockSelectedAgent
    this.mockSelectedSpace = options.mockSelectedSpace
    this.mockSelectedTeam = options.mockSelectedTeam
  }

  protected async promptForAgentSelection(): Promise<Agent> {
    return this.mockSelectedAgent
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team> {
    return this.mockSelectedTeam
  }
}

/**
 * Testable command that accepts a pre-configured use case
 */
class TestableSpaceSwitch extends SpaceSwitch {
  constructor(private readonly useCase: ISpaceSwitchUseCase, config: Config) {
    super([], config)
  }

  protected createUseCase(): ISpaceSwitchUseCase {
    return this.useCase
  }
}

describe('space:switch', () => {
  let configStore: {
    exists: SinonStub
    read: SinonStub
    write: SinonStub
  }
  let spaceService: {
    getSpaces: SinonStub
  }
  let teamService: {
    getTeams: SinonStub
  }
  let tokenStore: {
    clear: SinonStub
    load: SinonStub
    save: SinonStub
  }
  let workspaceDetector: {
    detectWorkspaces: SinonStub
  }
  let oclifConfig: Config
  let testSpaces: SpaceEntity[]
  let testTeams: TeamEntity[]
  let validToken: AuthToken
  let currentConfig: BrvConfig

  beforeEach(async () => {
    oclifConfig = await Config.load(import.meta.url)

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

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    workspaceDetector = {
      detectWorkspaces: stub().returns({chatLogPath: '', cwd: '/test/cwd'}),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000), // Expires in 1 hour
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-switch',
    })

    testSpaces = [
      new SpaceEntity('space-1', 'frontend-app', 'team-1', 'acme-corp'),
      new SpaceEntity('space-2', 'backend-api', 'team-1', 'acme-corp'),
    ]

    testTeams = [
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

    currentConfig = new BrvConfig({
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
  })

  afterEach(() => {
    restore()
  })

  function createTestCommand(selectedTeam: TeamEntity, selectedSpace: SpaceEntity): TestableSpaceSwitch {
    const useCase = new TestableSpaceSwitchUseCase({
      mockSelectedAgent: 'Claude Code',
      mockSelectedSpace: selectedSpace,
      mockSelectedTeam: selectedTeam,
      projectConfigStore: configStore,
      spaceService,
      teamService,
      terminal: createMockTerminal({
        error(msg: string) {
          throw new Error(msg)
        },
      }),
      tokenStore,
      workspaceDetector,
    })
    return new TestableSpaceSwitch(useCase, oclifConfig)
  }

  it('should error if project not initialized', async () => {
    configStore.read.resolves()

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Project not initialized')
    }
  })

  it('should error if not authenticated', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves()

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Not authenticated')
    }
  })

  it('should error if token expired', async () => {
    const expiredToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-expired',
    })

    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(expiredToken)

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Authentication token expired')
    }
  })

  it('should error if no teams available', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: [], total: 0})

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('No teams found')
    }
  })

  it('should error if no spaces in selected team', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: [], total: 0})

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('No spaces found')
    }
  })

  it('should successfully switch to new space', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
    configStore.write.resolves()

    const command = createTestCommand(testTeams[0]!, testSpaces[1]!) // Switch to second space

    await command.run()

    // Verify config was written with new space
    expect(configStore.write.calledOnce).to.be.true
    const writtenConfig = configStore.write.firstCall.args[0] as BrvConfig
    expect(writtenConfig.spaceId).to.equal('space-2')
    expect(writtenConfig.spaceName).to.equal('backend-api')
    expect(writtenConfig.teamId).to.equal('team-1')
    expect(writtenConfig.teamName).to.equal('acme-corp')
  })

  it('should call teamService with correct parameters', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
    configStore.write.resolves()

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    await command.run()

    expect(teamService.getTeams.calledOnce).to.be.true
    expect(
      teamService.getTeams.calledWith('access-token', 'session-key', {
        fetchAll: true,
      }),
    ).to.be.true
  })

  it('should call spaceService with correct parameters', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
    configStore.write.resolves()

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    await command.run()

    expect(spaceService.getSpaces.calledOnce).to.be.true
    expect(
      spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {
        fetchAll: true,
      }),
    ).to.be.true
  })

  it('should switch to a different team and space', async () => {
    const spacesForTeam2 = [new SpaceEntity('space-3', 'mobile-app', 'team-2', 'beta-co')]

    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: spacesForTeam2, total: spacesForTeam2.length})
    configStore.write.resolves()

    const command = createTestCommand(testTeams[1]!, spacesForTeam2[0]!) // Select second team

    await command.run()

    // Verify spaceService was called with the selected team ID
    expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-2', {fetchAll: true})).to.be.true

    // Verify config was updated with new team and space
    expect(configStore.write.calledOnce).to.be.true
    const writtenConfig = configStore.write.firstCall.args[0] as BrvConfig
    expect(writtenConfig.spaceId).to.equal('space-3')
    expect(writtenConfig.spaceName).to.equal('mobile-app')
    expect(writtenConfig.teamId).to.equal('team-2')
    expect(writtenConfig.teamName).to.equal('beta-co')
  })

  it('should handle team service errors gracefully', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.rejects(new Error('Network error'))

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Network error')
    }
  })

  it('should handle space service errors gracefully', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.rejects(new Error('API error'))

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('API error')
    }
  })

  it('should handle config store write errors gracefully', async () => {
    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
    configStore.write.rejects(new Error('Write failed'))

    const command = createTestCommand(testTeams[0]!, testSpaces[0]!)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Write failed')
    }
  })
})
