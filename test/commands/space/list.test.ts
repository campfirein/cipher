import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {TeamWithSpacesDTO} from '../../../src/shared/transport/events/space-events.js'

import SpaceList from '../../../src/oclif/commands/space/list.js'
import {SpaceEvents} from '../../../src/shared/transport/events/space-events.js'

// ==================== TestableSpaceListCommand ====================

class TestableSpaceListCommand extends SpaceList {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchSpaces() {
    return super.fetchSpaces({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Space List Command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>
  let stdoutOutput: string[]

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

  function createCommand(argv: string[] = []): TestableSpaceListCommand {
    const command = new TestableSpaceListCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function mockTeamsWithSpaces(teams: TeamWithSpacesDTO[]): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves({teams})
  }

  // ==================== List Teams & Spaces ====================

  describe('list teams and spaces', () => {
    it('should display teams with their spaces', async () => {
      mockTeamsWithSpaces([
        {
          spaces: [
            {id: 'space-1', isDefault: true, name: 'backend-api', teamId: 'team-1', teamName: 'acme'},
            {id: 'space-2', isDefault: false, name: 'frontend-app', teamId: 'team-1', teamName: 'acme'},
          ],
          teamId: 'team-1',
          teamName: 'acme',
        },
      ])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('1. acme (team)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('- backend-api (default) (space)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('- frontend-app (space)') && !m.includes('(default)'))).to.be.true
    })

    it('should display message when no teams found', async () => {
      mockTeamsWithSpaces([])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('No teams found.'))).to.be.true
    })

    it('should display "No spaces" for teams without spaces', async () => {
      mockTeamsWithSpaces([{spaces: [], teamId: 'team-1', teamName: 'empty-team'}])

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('1. empty-team (team)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('No spaces'))).to.be.true
    })

    it('should call correct transport event', async () => {
      mockTeamsWithSpaces([])

      await createCommand().run()

      expect((mockClient.requestWithAck as sinon.SinonStub).calledWith(SpaceEvents.LIST)).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('json output', () => {
    it('should output JSON when --format json', async () => {
      mockTeamsWithSpaces([
        {
          spaces: [{id: 'space-1', isDefault: true, name: 'backend-api', teamId: 'team-1', teamName: 'acme'}],
          teamId: 'team-1',
          teamName: 'acme',
        },
      ])

      await createCommand(['--format', 'json']).run()

      const output = stdoutOutput.join('')
      const parsed = JSON.parse(output)
      expect(parsed.success).to.be.true
      expect(parsed.command).to.equal('space list')
      expect(parsed.data.teams).to.have.length(1)
      expect(parsed.data.teams[0].teamName).to.equal('acme')
      expect(parsed.data.teams[0].spaces[0].spaceName).to.equal('backend-api')
    })

    it('should output JSON error on failure', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand(['--format', 'json']).run()

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

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })
  })
})
