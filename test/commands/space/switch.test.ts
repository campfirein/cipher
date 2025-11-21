import type {Config} from '@oclif/core'

import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {Agent} from '../../../src/core/domain/entities/agent.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../../src/core/interfaces/i-space-service.js'
import type {ITeamService} from '../../../src/core/interfaces/i-team-service.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import SpaceSwitch from '../../../src/commands/space/switch.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {Space} from '../../../src/core/domain/entities/space.js'
import {Team} from '../../../src/core/domain/entities/team.js'

class TestableSpaceSwitch extends SpaceSwitch {
  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTeamService: ITeamService,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockSelectedTeam: Team,
    private readonly mockSelectedSpace: Space,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    spaceService: ISpaceService
    teamService: ITeamService
    tokenStore: ITokenStore
  } {
    return {
      projectConfigStore: this.mockConfigStore,
      spaceService: this.mockSpaceService,
      teamService: this.mockTeamService,
      tokenStore: this.mockTokenStore,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }

  protected async promptForAgentSelection(): Promise<Agent> {
    return 'Claude Code'
  }

  protected async promptForSpaceSelection(_spaces: Space[]): Promise<Space> {
    return this.mockSelectedSpace
  }

  protected async promptForTeamSelection(_teams: Team[]): Promise<Team> {
    return this.mockSelectedTeam
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
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
  let oclifConfig: Config
  let testSpaces: Space[]
  let testTeams: Team[]
  let validToken: AuthToken
  let currentConfig: BrvConfig

  // Stub ux.action to suppress spinner output
  let uxActionStartStub: SinonStub
  let uxActionStopStub: SinonStub

  beforeEach(async () => {
    const {Config} = await import('@oclif/core')
    oclifConfig = await Config.load(import.meta.url)

    // Stub ux.action methods to suppress output
    const {ux} = await import('@oclif/core')
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

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
      new Space('space-1', 'frontend-app', 'team-1', 'acme-corp'),
      new Space('space-2', 'backend-api', 'team-1', 'acme-corp'),
    ]

    testTeams = [
      new Team({
        avatarUrl: 'https://example.com/avatar1.png',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        description: 'Acme Corporation',
        displayName: 'Acme Corp',
        id: 'team-1',
        isActive: true,
        name: 'acme-corp',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      }),
      new Team({
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

    currentConfig = new BrvConfig(
      '2024-01-01T00:00:00.000Z',
      'space-1',
      'frontend-app',
      'team-1',
      'acme-corp',
      'Claude Code' as Agent,
      'chat.log',
      '/test/cwd',
    )
  })

  afterEach(() => {
    // Restore all stubs
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    restore()
  })

  it('should error if project not initialized', async () => {
    configStore.read.resolves()

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[1]!, // Switch to second space
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

    await command.run()

    expect(spaceService.getSpaces.calledOnce).to.be.true
    expect(
      spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {
        fetchAll: true,
      }),
    ).to.be.true
  })

  it('should switch to a different team and space', async () => {
    const spacesForTeam2 = [new Space('space-3', 'mobile-app', 'team-2', 'beta-co')]

    configStore.read.resolves(currentConfig)
    tokenStore.load.resolves(validToken)
    teamService.getTeams.resolves({teams: testTeams, total: testTeams.length})
    spaceService.getSpaces.resolves({spaces: spacesForTeam2, total: spacesForTeam2.length})
    configStore.write.resolves()

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[1]!, // Select second team
      spacesForTeam2[0]!, // Select space from second team
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

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

    const command = new TestableSpaceSwitch(
      configStore,
      spaceService,
      teamService,
      tokenStore,
      testTeams[0]!,
      testSpaces[0]!,
      oclifConfig,
    )

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Write failed')
    }
  })
})
