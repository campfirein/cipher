import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {StatusDTO} from '../../src/shared/transport/types/dto.js'

import Status from '../../src/oclif/commands/status.js'

// ==================== TestableStatusCommand ====================

class TestableStatusCommand extends Status {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(mockConnector: () => Promise<ConnectionResult>, config: Config, argv: string[] = []) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchStatus(): Promise<StatusDTO> {
    return super.fetchStatus({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Status Command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []

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
  })

  afterEach(() => {
    restore()
  })

  function createCommand(): TestableStatusCommand {
    const command = new TestableStatusCommand(mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function mockStatusResponse(status: Omit<StatusDTO, 'locations'> & Partial<Pick<StatusDTO, 'locations'>>): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves({status: {locations: [], ...status}})
  }

  // ==================== Auth Status ====================

  describe('authentication status', () => {
    it('should display cloud sync not connected when not authenticated', async () => {
      mockStatusResponse({
        authStatus: 'not_logged_in',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.startsWith('Account:') && m.includes('Not connected'))).to.be.true
    })

    it('should display "Session expired" when token is expired', async () => {
      mockStatusResponse({
        authStatus: 'expired',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Session expired'))).to.be.true
    })

    it('should display user email when logged in', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('user@example.com'))).to.be.true
    })

    it('should display unknown auth status gracefully', async () => {
      mockStatusResponse({
        authStatus: 'unknown',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Unable to check'))).to.be.true
    })
  })

  // ==================== Project Status ====================

  describe('project status', () => {
    it('should display "Not initialized" when project is not initialized', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Not initialized'))).to.be.true
    })

    it('should display connected team/space when project is initialized', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        spaceName: 'backend-api',
        teamName: 'acme-corp',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('acme-corp/backend-api'))).to.be.true
    })

    it('should display "Not connected" when no team/space', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.startsWith('Space:') && m.includes('Not connected'))).to.be.true
    })
  })

  // ==================== Context Tree Status ====================

  describe('context tree status', () => {
    it('should display "Not initialized" when context tree does not exist', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
        spaceName: 'backend-api',
        teamName: 'acme-corp',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Context Tree: Not initialized'))).to.be.true
    })

    it('should display "No changes" when no changes detected', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        spaceName: 'backend-api',
        teamName: 'acme-corp',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('No changes'))).to.be.true
    })

    it('should display added files with context tree relative path', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeChanges: {
          added: ['design/context.md', 'testing/context.md'],
          deleted: [],
          modified: [],
        },
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        spaceName: 'backend-api',
        teamName: 'acme-corp',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Context Tree Changes'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('new file:') && m.includes('.brv/context-tree/design/context.md')))
        .to.be.true
      expect(loggedMessages.some((m) => m.includes('new file:') && m.includes('.brv/context-tree/testing/context.md')))
        .to.be.true
    })

    it('should display modified files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeChanges: {
          added: [],
          deleted: [],
          modified: ['structure/context.md'],
        },
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(
        loggedMessages.some((m) => m.includes('modified:') && m.includes('.brv/context-tree/structure/context.md')),
      ).to.be.true
    })

    it('should display deleted files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeChanges: {
          added: [],
          deleted: ['old/context.md'],
          modified: [],
        },
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('deleted:') && m.includes('.brv/context-tree/old/context.md'))).to.be
        .true
    })

    it('should display all change types sorted by path', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeChanges: {
          added: ['z-new/context.md'],
          deleted: ['a-deleted/context.md'],
          modified: ['m-modified/context.md'],
        },
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      const changeMessages = loggedMessages.filter(
        (m) => m.includes('new file:') || m.includes('modified:') || m.includes('deleted:'),
      )

      expect(changeMessages.length).to.equal(3)
      expect(changeMessages[0]).to.include('a-deleted')
      expect(changeMessages[1]).to.include('m-modified')
      expect(changeMessages[2]).to.include('z-new')
    })
  })

  // ==================== Registered Project Locations ====================

  describe('registered project locations', () => {
    it('should display current project with [current] label and domain/file counts', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [
          {
            domainCount: 4,
            fileCount: 18,
            isActive: false,
            isCurrent: true,
            isInitialized: true,
            projectPath: '/Users/andy/byterover',
          },
        ],
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('[current]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('/Users/andy/byterover'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('4 domains') && m.includes('18 files'))).to.be.true
    })

    it('should display active project with [active] label', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [
          {
            domainCount: 2,
            fileCount: 8,
            isActive: true,
            isCurrent: false,
            isInitialized: true,
            projectPath: '/Users/andy/brv-transport',
          },
        ],
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('[active]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('/Users/andy/brv-transport'))).to.be.true
    })

    it('should display (not initialized) when isInitialized=false', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [
          {
            domainCount: 0,
            fileCount: 0,
            isActive: false,
            isCurrent: false,
            isInitialized: false,
            projectPath: '/Users/andy/my-app',
          },
        ],
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('(not initialized)'))).to.be.true
    })

    it('should use singular "domain" and "file" labels when count is 1', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [
          {
            domainCount: 1,
            fileCount: 1,
            isActive: false,
            isCurrent: true,
            isInitialized: true,
            projectPath: '/Users/andy/byterover',
          },
        ],
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('1 domain') && !m.includes('1 domains'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('1 file') && !m.includes('1 files'))).to.be.true
    })

    it('should display "none found" when locations is empty', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [],
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Registered Projects — none found'))).to.be.true
    })

    it('should display header with project count when locations exist', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [
          {
            domainCount: 1,
            fileCount: 5,
            isActive: false,
            isCurrent: true,
            isInitialized: true,
            projectPath: '/project/a',
          },
          {
            domainCount: 0,
            fileCount: 0,
            isActive: false,
            isCurrent: false,
            isInitialized: false,
            projectPath: '/project/b',
          },
        ],
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Registered Projects — 2 found'))).to.be.true
    })
  })

  // ==================== JSON Output ====================

  describe('JSON output', () => {
    it('should include locations array in JSON output', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        locations: [
          {
            domainCount: 3,
            fileCount: 10,
            isActive: false,
            isCurrent: true,
            isInitialized: true,
            projectPath: '/Users/andy/byterover',
          },
        ],
        userEmail: 'user@example.com',
      })

      let captured = ''
      const writeStub = stub(process.stdout, 'write').callsFake((chunk) => {
        captured += chunk
        return true
      })

      try {
        await new TestableStatusCommand(mockConnector, config, ['--format', 'json']).run()
      } finally {
        writeStub.restore()
      }

      const parsed = JSON.parse(captured) as {data: {locations: unknown[]}}
      expect(parsed.data.locations).to.be.an('array').with.lengthOf(1)
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle NoInstanceRunningError', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      mockConnector.rejects(new InstanceCrashedError())

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon crashed unexpectedly'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })
  })
})
