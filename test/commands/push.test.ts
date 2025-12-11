import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {ICogitPushService} from '../../src/core/interfaces/i-cogit-push-service.js'
import type {IContextFileReader} from '../../src/core/interfaces/i-context-file-reader.js'
import type {IContextTreeSnapshotService} from '../../src/core/interfaces/i-context-tree-snapshot-service.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Push from '../../src/commands/push.js'
import {BRV_CONFIG_VERSION} from '../../src/constants.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../src/core/domain/entities/brv-config.js'
import {CogitPushResponse} from '../../src/core/domain/entities/cogit-push-response.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

class TestablePush extends Push {
  public errorMessages: string[] = []
  public logMessages: string[] = []

  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockCogitPushService: ICogitPushService,
    private readonly mockContextFileReader: IContextFileReader,
    private readonly mockContextTreeSnapshotService: IContextTreeSnapshotService,
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockTrackingService: ITrackingService,
    config: Config,
  ) {
    super([], config)
  }

  // Default implementation returns true to avoid blocking tests
  // Individual tests can override this by stubbing
  protected async confirmPush(): Promise<boolean> {
    return true
  }

  protected createServices() {
    this.terminal = createMockTerminal({
      error: (msg) => this.errorMessages.push(msg),
      log: (msg) => msg !== undefined && this.logMessages.push(msg),
    })
    return {
      cogitPushService: this.mockCogitPushService,
      contextFileReader: this.mockContextFileReader,
      contextTreeSnapshotService: this.mockContextTreeSnapshotService,
      projectConfigStore: this.mockConfigStore,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
  }
}

describe('Push Command', () => {
  let config: Config
  let cogitPushService: sinon.SinonStubbedInstance<ICogitPushService>
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let contextFileReader: sinon.SinonStubbedInstance<IContextFileReader>
  let contextTreeSnapshotService: sinon.SinonStubbedInstance<IContextTreeSnapshotService>
  let projectConfig: BrvConfig
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let uxActionStartStub: sinon.SinonStub
  let uxActionStopStub: sinon.SinonStub
  let validToken: AuthToken

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

    cogitPushService = {push: stub()}
    contextFileReader = {read: stub(), readMany: stub()}
    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
    }
    configStore = {exists: stub(), read: stub(), write: stub()}
    tokenStore = {clear: stub(), load: stub(), save: stub()}
    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-push',
    })

    projectConfig = new BrvConfig({
      chatLogPath: 'chat.log',
      createdAt: new Date().toISOString(),
      cwd: '/test/cwd',
      ide: 'Claude Code',
      spaceId: 'space-123',
      spaceName: 'my-space',
      teamId: 'team-456',
      teamName: 'my-team',
      version: BRV_CONFIG_VERSION,
    })
  })

  afterEach(() => {
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    restore()
  })

  describe('validation', () => {
    it('should error when not authenticated', async () => {
      tokenStore.load.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('Not authenticated')
    })

    it('should error when token is expired', async () => {
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

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(command.errorMessages).to.have.lengthOf(1)
      expect(command.errorMessages[0]).to.include('expired')
    })

    it('should error when project not initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Project not initialized')
      }
    })
  })

  describe('change detection', () => {
    it('should check for changes before reading files', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(contextTreeSnapshotService.getChanges.calledOnce).to.be.true
      expect(contextFileReader.readMany.called).to.be.false
    })

    it('should show message when no changes to push', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(command.logMessages).to.include('No context changes to push.')
      expect(cogitPushService.push.called).to.be.false
    })
  })

  describe('successful execution', () => {
    it('should read added files and push to CoGit', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['structure/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'structure/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Commit successful',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(contextFileReader.readMany.calledTwice).to.be.true
      expect(contextFileReader.readMany.firstCall.calledWith(['structure/context.md'])).to.be.true
      expect(contextFileReader.readMany.secondCall.calledWith([])).to.be.true
      expect(cogitPushService.push.calledOnce).to.be.true
    })

    it('should call cogitPushService.push with correct params', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# My Title\n\nMy content', path: 'test/context.md', title: 'My Title'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].accessToken).to.equal('access-token')
      expect(pushCall.args[0].sessionKey).to.equal('session-key')
      expect(pushCall.args[0].branch).to.equal('main')
      expect(pushCall.args[0].teamId).to.equal('team-456')
      expect(pushCall.args[0].spaceId).to.equal('space-123')
      expect(pushCall.args[0].contexts).to.have.lengthOf(1)
      expect(pushCall.args[0].contexts[0].path).to.equal('test/context.md')
      expect(pushCall.args[0].contexts[0].title).to.equal('My Title')
      expect(pushCall.args[0].contexts[0].operation).to.equal('add')
    })

    it('should use custom branch when provided via flag', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'test/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )
      command.argv = ['--branch', 'develop']

      await command.run()

      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].branch).to.equal('develop')
    })

    it('should save snapshot only after successful push', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'test/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.calledAfter(cogitPushService.push)).to.be.true
    })
  })

  describe('error handling', () => {
    it('should not save snapshot if push fails', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'test/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.rejects(new Error('Push failed: Network error'))

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch {
        // Expected error
      }

      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
    })

    it('should propagate errors from cogit push service', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'test/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.rejects(new Error('Failed to push to CoGit: Network timeout'))

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Network timeout')
      }
    })

    it('should propagate errors from context file reader', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany.rejects(new Error('File system error'))

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('File system error')
      }
    })
  })

  describe('confirmation prompt behavior', () => {
    it('should prompt for confirmation when --yes flag not provided and proceed when user confirms', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'test/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )
      const confirmStub = stub(command as unknown as {confirmPush: () => Promise<boolean>}, 'confirmPush').resolves(
        true,
      )

      await command.run()

      expect(confirmStub.calledOnce).to.be.true
      expect(cogitPushService.push.calledOnce).to.be.true
    })

    it('should cancel push when user declines confirmation', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )
      stub(command as unknown as {confirmPush: () => Promise<boolean>}, 'confirmPush').resolves(false)

      await command.run()

      expect(command.logMessages).to.include('Push cancelled.')
      expect(contextFileReader.readMany.called).to.be.false
      expect(cogitPushService.push.called).to.be.false
      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
    })

    it('should skip confirmation when --yes flag is provided', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', path: 'test/context.md', title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )
      command.argv = ['--yes']

      const confirmStub = stub(command as unknown as {confirmPush: () => Promise<boolean>}, 'confirmPush').resolves(
        true,
      )

      await command.run()

      expect(confirmStub.called).to.be.false
      expect(cogitPushService.push.calledOnce).to.be.true
    })
  })

  describe('multiple files', () => {
    it('should handle multiple added files', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['first/context.md', 'second/context.md', 'third/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([
          {content: '# First\n\nContent', path: 'first/context.md', title: 'First'},
          {content: '# Second\n\nContent', path: 'second/context.md', title: 'Second'},
          {content: '# Third\n\nContent', path: 'third/context.md', title: 'Third'},
        ])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(3)
      expect(pushCall.args[0].contexts[0].path).to.equal('first/context.md')
      expect(pushCall.args[0].contexts[1].path).to.equal('second/context.md')
      expect(pushCall.args[0].contexts[2].path).to.equal('third/context.md')
    })
  })

  describe('empty file handling', () => {
    it('should show message when no valid files after reading', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['missing/context.md'],
        deleted: [],
        modified: [],
      })
      // readMany returns empty array when files can't be read
      contextFileReader.readMany.resolves([])

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(command.logMessages).to.include('\nNo valid context files to push.')
      expect(cogitPushService.push.called).to.be.false
    })
  })

  describe('modified files (edit operation)', () => {
    it('should read modified files and push with edit operation', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: [],
        modified: ['existing/context.md'],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([])
        .onSecondCall()
        .resolves([{content: '# Updated\n\nUpdated content', path: 'existing/context.md', title: 'Updated'}])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(contextFileReader.readMany.calledTwice).to.be.true
      expect(contextFileReader.readMany.secondCall.calledWith(['existing/context.md'])).to.be.true
      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(1)
      expect(pushCall.args[0].contexts[0].operation).to.equal('edit')
      expect(pushCall.args[0].contexts[0].path).to.equal('existing/context.md')
    })

    it('should handle both added and modified files together', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['new/context.md'],
        deleted: [],
        modified: ['existing/context.md'],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# New\n\nNew content', path: 'new/context.md', title: 'New'}])
        .onSecondCall()
        .resolves([{content: '# Updated\n\nUpdated content', path: 'existing/context.md', title: 'Updated'}])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(2)
      expect(pushCall.args[0].contexts[0].operation).to.equal('add')
      expect(pushCall.args[0].contexts[0].path).to.equal('new/context.md')
      expect(pushCall.args[0].contexts[1].operation).to.equal('edit')
      expect(pushCall.args[0].contexts[1].path).to.equal('existing/context.md')
    })

    it('should trigger push when only modified files exist', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: [],
        modified: ['file1/context.md', 'file2/context.md'],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([])
        .onSecondCall()
        .resolves([
          {content: '# File1\n\nContent', path: 'file1/context.md', title: 'File1'},
          {content: '# File2\n\nContent', path: 'file2/context.md', title: 'File2'},
        ])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(cogitPushService.push.calledOnce).to.be.true
      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(2)
      expect(pushCall.args[0].contexts[0].operation).to.equal('edit')
      expect(pushCall.args[0].contexts[1].operation).to.equal('edit')
    })
  })

  describe('deleted files (delete operation)', () => {
    it('should push deleted files with delete operation', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: ['obsolete/context.md'],
        modified: [],
      })
      contextFileReader.readMany.onFirstCall().resolves([]).onSecondCall().resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(cogitPushService.push.calledOnce).to.be.true
      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(1)
      expect(pushCall.args[0].contexts[0].operation).to.equal('delete')
      expect(pushCall.args[0].contexts[0].path).to.equal('obsolete/context.md')
      expect(pushCall.args[0].contexts[0].content).to.equal('')
      expect(pushCall.args[0].contexts[0].title).to.equal('')
    })

    it('should handle added, modified, and deleted files together', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['new/context.md'],
        deleted: ['obsolete/context.md'],
        modified: ['existing/context.md'],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# New\n\nNew content', path: 'new/context.md', title: 'New'}])
        .onSecondCall()
        .resolves([{content: '# Updated\n\nUpdated content', path: 'existing/context.md', title: 'Updated'}])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(3)
      expect(pushCall.args[0].contexts[0].operation).to.equal('add')
      expect(pushCall.args[0].contexts[0].path).to.equal('new/context.md')
      expect(pushCall.args[0].contexts[1].operation).to.equal('edit')
      expect(pushCall.args[0].contexts[1].path).to.equal('existing/context.md')
      expect(pushCall.args[0].contexts[2].operation).to.equal('delete')
      expect(pushCall.args[0].contexts[2].path).to.equal('obsolete/context.md')
    })

    it('should trigger push when only deleted files exist', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: ['file1/context.md', 'file2/context.md'],
        modified: [],
      })
      contextFileReader.readMany.onFirstCall().resolves([]).onSecondCall().resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      expect(cogitPushService.push.calledOnce).to.be.true
      const pushCall = cogitPushService.push.getCall(0)
      expect(pushCall.args[0].contexts).to.have.lengthOf(2)
      expect(pushCall.args[0].contexts[0].operation).to.equal('delete')
      expect(pushCall.args[0].contexts[0].path).to.equal('file1/context.md')
      expect(pushCall.args[0].contexts[1].operation).to.equal('delete')
      expect(pushCall.args[0].contexts[1].path).to.equal('file2/context.md')
    })

    it('should not read deleted files from disk (only path needed)', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: [],
        deleted: ['deleted/context.md'],
        modified: [],
      })
      contextFileReader.readMany.onFirstCall().resolves([]).onSecondCall().resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const command = new TestablePush(
        cogitPushService,
        contextFileReader,
        contextTreeSnapshotService,
        configStore,
        tokenStore,
        trackingService,
        config,
      )

      await command.run()

      // contextFileReader.readMany is called only twice (for added and modified)
      // Deleted paths are passed directly to mapper without reading
      expect(contextFileReader.readMany.calledTwice).to.be.true
      expect(contextFileReader.readMany.firstCall.calledWith([])).to.be.true
      expect(contextFileReader.readMany.secondCall.calledWith([])).to.be.true
    })
  })
})
