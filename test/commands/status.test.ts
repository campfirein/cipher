import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {sep} from 'node:path'
import sinon, {restore, stub} from 'sinon'

import type {IContextTreeService} from '../../src/core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../src/core/interfaces/i-context-tree-snapshot-service.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'
import type {IStatusUseCase} from '../../src/core/interfaces/usecase/i-status-use-case.js'

import {BRV_CONFIG_VERSION} from '../../src/constants.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../src/core/domain/entities/brv-config.js'
import {StatusUseCase} from '../../src/infra/usecase/status-use-case.js'
import Status from '../../src/oclif/commands/status.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

// ==================== TestableStatusCommand ====================

class TestableStatusCommand extends Status {
  constructor(
    private readonly useCase: IStatusUseCase,
    config: Config,
  ) {
    super([], config)
  }

  protected createUseCase(): IStatusUseCase {
    return this.useCase
  }
}

// ==================== Tests ====================

describe('Status Command', () => {
  let config: Config
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let contextTreeService: sinon.SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: sinon.SinonStubbedInstance<IContextTreeSnapshotService>
  let loggedMessages: string[]
  let terminal: ITerminal
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let validToken: AuthToken
  let testConfig: BrvConfig

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []

    terminal = createMockTerminal({
      log: (msg) => msg && loggedMessages.push(msg),
    })

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    contextTreeService = {
      exists: stub(),
      initialize: stub(),
    }

    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-123',
    })

    testConfig = new BrvConfig({
      chatLogPath: 'chat.log',
      createdAt: new Date().toISOString(),
      cwd: '/test/cwd',
      ide: 'Claude Code',
      spaceId: 'space-1',
      spaceName: 'backend-api',
      teamId: 'team-1',
      teamName: 'acme-corp',
      version: BRV_CONFIG_VERSION,
    })
  })

  afterEach(() => {
    restore()
  })

  function createTestUseCase(): StatusUseCase {
    return new StatusUseCase({
      contextTreeService,
      contextTreeSnapshotService,
      projectConfigStore: configStore,
      terminal,
      tokenStore,
      trackingService,
    })
  }

  function createTestCommand(useCase: IStatusUseCase): TestableStatusCommand {
    return new TestableStatusCommand(useCase, config)
  }

  describe('authentication status', () => {
    it('should display "Not logged in" when token is undefined', async () => {
      tokenStore.load.resolves()
      configStore.exists.resolves(false)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(loggedMessages.some((m) => m.includes('Not logged in'))).to.be.true
    })

    it('should display "Session expired" when token is expired', async () => {
      const expiredToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-expired',
      })

      tokenStore.load.resolves(expiredToken)
      configStore.exists.resolves(false)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(loggedMessages.some((m) => m.includes('Session expired'))).to.be.true
    })

    it('should display user email when logged in with valid token', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(false)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(loggedMessages.some((m) => m.includes('user@example.com'))).to.be.true
    })

    it('should handle token store errors gracefully', async () => {
      tokenStore.load.rejects(new Error('Keychain access denied'))
      configStore.exists.resolves(false)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      // Should not throw
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
    })
  })

  describe('project status', () => {
    it('should display "Not initialized" when project is not initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(false)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.called).to.be.false
      expect(loggedMessages.some((m) => m.includes('Not initialized'))).to.be.true
    })

    it('should display connected team/space when project is initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
      expect(loggedMessages.some((m) => m.includes('acme-corp/backend-api'))).to.be.true
    })

    it('should handle invalid config file gracefully', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves()
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(loggedMessages.some((m) => m.includes('invalid'))).to.be.true
    })

    it('should handle config store errors gracefully', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.rejects(new Error('File system error'))
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      // Should not throw
      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
    })
  })

  describe('context tree status', () => {
    it('should display "Not initialized" when context tree does not exist', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(false)

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(contextTreeService.exists.calledOnce).to.be.true
      expect(loggedMessages.some((m) => m.includes('Context Tree: Not initialized'))).to.be.true
    })

    it('should create empty snapshot when none exists', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.resolves(false)
      contextTreeSnapshotService.initEmptySnapshot.resolves()
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(contextTreeSnapshotService.hasSnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
    })

    it('should display "No changes" when snapshot exists and no changes', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.resolves(true)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
      expect(loggedMessages.some((m) => m.includes('No changes'))).to.be.true
    })

    it('should display added files', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.resolves(true)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['design/context.md', 'testing/context.md'],
        deleted: [],
        modified: [],
      })

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(loggedMessages.some((m) => m.includes('Context Tree Changes'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('new file:') && m.includes(`design${sep}context.md`))).to.be.true
      expect(loggedMessages.some((m) => m.includes('new file:') && m.includes(`testing${sep}context.md`))).to.be.true
    })

    it('should display modified files', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.resolves(true)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: [],
        modified: ['structure/context.md'],
      })

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(loggedMessages.some((m) => m.includes('modified:') && m.includes(`structure${sep}context.md`))).to.be.true
    })

    it('should display deleted files', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.resolves(true)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: ['old/context.md'],
        modified: [],
      })

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(loggedMessages.some((m) => m.includes('deleted:') && m.includes(`old${sep}context.md`))).to.be.true
    })

    it('should display all change types sorted by path', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.resolves(true)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['z-new/context.md'],
        deleted: ['a-deleted/context.md'],
        modified: ['m-modified/context.md'],
      })

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      // Find the indices of each change in logged messages
      const changeMessages = loggedMessages.filter(
        (m) => m.includes('new file:') || m.includes('modified:') || m.includes('deleted:'),
      )

      expect(changeMessages.length).to.equal(3)
      // Should be sorted by path: a-deleted, m-modified, z-new
      expect(changeMessages[0]).to.include('a-deleted')
      expect(changeMessages[1]).to.include('m-modified')
      expect(changeMessages[2]).to.include('z-new')
    })

    it('should handle context tree service errors gracefully', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.rejects(new Error('Permission denied'))

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      // Should not throw
      await command.run()

      expect(contextTreeService.exists.calledOnce).to.be.true
    })

    it('should handle snapshot service errors gracefully', async () => {
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)
      contextTreeService.exists.resolves(true)
      contextTreeSnapshotService.hasSnapshot.rejects(new Error('IO error'))

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      // Should not throw
      await command.run()

      expect(contextTreeSnapshotService.hasSnapshot.calledOnce).to.be.true
    })
  })
})
