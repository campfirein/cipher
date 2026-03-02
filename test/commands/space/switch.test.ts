import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {match, restore, stub} from 'sinon'

import type {SpaceSwitchResponse, TeamWithSpacesDTO} from '../../../src/shared/transport/events/space-events.js'

import SpaceSwitch from '../../../src/oclif/commands/space/switch.js'
import {SpaceEvents} from '../../../src/shared/transport/events/space-events.js'

// ==================== TestableSpaceSwitchCommand ====================

class TestableSpaceSwitchCommand extends SpaceSwitch {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async executeSwitch(params: {spaceName: string; teamName: string}) {
    return super.executeSwitch(params, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Space Switch Command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>
  let stdoutOutput: string[]

  const testTeams: TeamWithSpacesDTO[] = [
    {
      spaces: [
        {id: 'space-1', isDefault: true, name: 'backend-api', teamId: 'team-1', teamName: 'acme'},
        {id: 'space-2', isDefault: false, name: 'frontend-app', teamId: 'team-1', teamName: 'acme'},
      ],
      teamId: 'team-1',
      teamName: 'acme',
    },
  ]

  const switchSuccessResponse: SpaceSwitchResponse = {
    config: {spaceId: 'space-2', spaceName: 'frontend-app', teamId: 'team-1', teamName: 'acme', version: '1'},
    success: true,
  }

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []

    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getState: stub().returns('connected'),
      isConnected: stub().resolves(true),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().returns(() => {}),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves({}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })

    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(argv: string[]): TestableSpaceSwitchCommand {
    const command = new TestableSpaceSwitchCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function mockListAndSwitch(teams: TeamWithSpacesDTO[], switchResponse: SpaceSwitchResponse): void {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.withArgs(SpaceEvents.LIST).resolves({teams})
    requestStub.withArgs(SpaceEvents.SWITCH, match.any).resolves(switchResponse)
  }

  // ==================== Switch Space ====================

  describe('switch space', () => {
    it('should switch to named space successfully', async () => {
      mockListAndSwitch(testTeams, switchSuccessResponse)

      await createCommand(['--team', 'acme', '--name', 'frontend-app']).run()

      expect(loggedMessages.some((m) => m.includes('Successfully switched to space: frontend-app'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Configuration updated in: .brv/config.json'))).to.be.true
    })

    it('should call switch with correct spaceId', async () => {
      mockListAndSwitch(testTeams, switchSuccessResponse)

      await createCommand(['--team', 'acme', '--name', 'frontend-app']).run()

      expect((mockClient.requestWithAck as sinon.SinonStub).calledWith(SpaceEvents.SWITCH, {spaceId: 'space-2'})).to.be
        .true
    })

    it('should show error when team not found', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.withArgs(SpaceEvents.LIST).resolves({teams: testTeams})

      await createCommand(['--team', 'nonexistent', '--name', 'frontend-app']).run()

      expect(loggedMessages.some((m) => m.includes('Team "nonexistent" not found') && m.includes('Available teams'))).to
        .be.true
    })

    it('should show error when no teams available', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.withArgs(SpaceEvents.LIST).resolves({teams: []})

      await createCommand(['--team', 'acme', '--name', 'any-space']).run()

      expect(loggedMessages.some((m) => m.includes('Team "acme" not found') && m.includes('No teams available'))).to.be
        .true
    })

    it('should show error when space not found in team', async () => {
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.withArgs(SpaceEvents.LIST).resolves({teams: testTeams})

      await createCommand(['--team', 'acme', '--name', 'nonexistent']).run()

      expect(
        loggedMessages.some(
          (m) => m.includes('Space "nonexistent" not found in team "acme"') && m.includes('Available spaces'),
        ),
      ).to.be.true
    })

    it('should show error when team has no spaces', async () => {
      const emptyTeam: TeamWithSpacesDTO[] = [{spaces: [], teamId: 'team-1', teamName: 'acme'}]
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      requestStub.withArgs(SpaceEvents.LIST).resolves({teams: emptyTeam})

      await createCommand(['--team', 'acme', '--name', 'any-space']).run()

      expect(
        loggedMessages.some(
          (m) => m.includes('Space "any-space" not found in team "acme"') && m.includes('No spaces available'),
        ),
      ).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON on success', async () => {
      mockListAndSwitch(testTeams, switchSuccessResponse)

      await createCommand(['--team', 'acme', '--name', 'frontend-app', '--format', 'json']).run()

      const output = stdoutOutput.join('')
      const parsed = JSON.parse(output)
      expect(parsed.success).to.be.true
      expect(parsed.command).to.equal('space switch')
      expect(parsed.data.config.spaceName).to.equal('frontend-app')
    })

    it('should output JSON error on failure', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand(['--team', 'acme', '--name', 'any-space', '--format', 'json']).run()

      const output = stdoutOutput.join('')
      const parsed = JSON.parse(output)
      expect(parsed.success).to.be.false
      expect(parsed.data.error).to.be.a('string')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle NoInstanceRunningError', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand(['--team', 'acme', '--name', 'any-space']).run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand(['--team', 'acme', '--name', 'any-space']).run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })
  })
})
