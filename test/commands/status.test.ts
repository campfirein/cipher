import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {GitChanges, StatusDTO} from '../../src/shared/transport/types/dto.js'

import Status from '../../src/oclif/commands/status.js'

// ==================== TestableStatusCommand ====================

class TestableStatusCommand extends Status {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super([], config)
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

  function mockStatusResponse(status: StatusDTO): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves({status})
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

      expect(loggedMessages.some((m) => m.includes('Not connected'))).to.be.true
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

      expect(loggedMessages.some((m) => m.includes('Not connected'))).to.be.true
    })
  })

  // ==================== Context Tree Status ====================

  const emptyGitChanges: GitChanges = {
    staged: {added: [], deleted: [], modified: []},
    unstaged: {deleted: [], modified: []},
    untracked: [],
  }

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
        gitBranch: 'main',
        spaceName: 'backend-api',
        teamName: 'acme-corp',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('No changes'))).to.be.true
    })

    it('should display branch name when git is initialized', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'no_changes',
        currentDirectory: '/test',
        gitBranch: 'feat/my-branch',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('On branch: feat/my-branch'))).to.be.true
    })

    it('should display hint to run init when git is not initialized', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeStatus: 'not_initialized',
        currentDirectory: '/test',
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Context Tree: Not initialized'))).to.be.true
    })

    it('should display staged added files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        gitBranch: 'main',
        gitChanges: {
          ...emptyGitChanges,
          staged: {added: ['design/context.md', 'testing/context.md'], deleted: [], modified: []},
        },
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Changes to be committed'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('new file:') && m.includes('.brv/context-tree/design/context.md')))
        .to.be.true
      expect(loggedMessages.some((m) => m.includes('new file:') && m.includes('.brv/context-tree/testing/context.md')))
        .to.be.true
    })

    it('should display staged modified files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        gitBranch: 'main',
        gitChanges: {
          ...emptyGitChanges,
          staged: {added: [], deleted: [], modified: ['structure/context.md']},
        },
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Changes to be committed'))).to.be.true
      expect(
        loggedMessages.some((m) => m.includes('modified:') && m.includes('.brv/context-tree/structure/context.md')),
      ).to.be.true
    })

    it('should display staged deleted files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        gitBranch: 'main',
        gitChanges: {
          ...emptyGitChanges,
          staged: {added: [], deleted: ['old/context.md'], modified: []},
        },
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('deleted:') && m.includes('.brv/context-tree/old/context.md'))).to.be
        .true
    })

    it('should display unstaged modified and deleted files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        gitBranch: 'main',
        gitChanges: {
          ...emptyGitChanges,
          unstaged: {deleted: ['removed/context.md'], modified: ['edited/context.md']},
        },
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Changes not staged for commit'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('modified:') && m.includes('.brv/context-tree/edited/context.md')))
        .to.be.true
      expect(loggedMessages.some((m) => m.includes('deleted:') && m.includes('.brv/context-tree/removed/context.md')))
        .to.be.true
    })

    it('should display untracked files', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        gitBranch: 'main',
        gitChanges: {
          ...emptyGitChanges,
          untracked: ['new-file.md', 'another-new.md'],
        },
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Untracked files'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('.brv/context-tree/new-file.md'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('.brv/context-tree/another-new.md'))).to.be.true
    })

    it('should omit empty sections', async () => {
      mockStatusResponse({
        authStatus: 'logged_in',
        contextTreeRelativeDir: '.brv/context-tree',
        contextTreeStatus: 'has_changes',
        currentDirectory: '/test',
        gitBranch: 'main',
        gitChanges: {
          ...emptyGitChanges,
          staged: {added: ['only-staged.md'], deleted: [], modified: []},
        },
        userEmail: 'user@example.com',
      })

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Changes to be committed'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Changes not staged for commit'))).to.be.false
      expect(loggedMessages.some((m) => m.includes('Untracked files'))).to.be.false
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
