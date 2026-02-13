import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ITokenStore} from '../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextFileReader} from '../../../src/server/core/interfaces/context-tree/i-context-file-reader.js'
import type {IContextTreeSnapshotService} from '../../../src/server/core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICogitPushService} from '../../../src/server/core/interfaces/services/i-cogit-push-service.js'
import type {ITerminal} from '../../../src/server/core/interfaces/services/i-terminal.js'
import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {BRV_CONFIG_VERSION} from '../../../src/server/constants.js'
import {AuthToken} from '../../../src/server/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/server/core/domain/entities/brv-config.js'
import {CogitPushResponse} from '../../../src/server/core/domain/entities/cogit-push-response.js'
import {PushUseCase} from '../../../src/server/infra/usecase/push-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

describe('PushUseCase', () => {
  let cogitPushService: SinonStubbedInstance<ICogitPushService>
  let configStore: SinonStubbedInstance<IProjectConfigStore>
  let contextFileReader: SinonStubbedInstance<IContextFileReader>
  let contextTreeSnapshotService: SinonStubbedInstance<IContextTreeSnapshotService>
  let errorMessages: string[]
  let logMessages: string[]
  let projectConfig: BrvConfig
  let terminal: ITerminal
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let validToken: AuthToken

  beforeEach(() => {
    logMessages = []
    errorMessages = []

    terminal = createMockTerminal({
      confirm: async () => true, // Default to true - individual tests can override
      error: (msg) => errorMessages.push(msg),
      log: (msg) => msg !== undefined && logMessages.push(msg),
    })

    cogitPushService = {push: stub()}
    contextFileReader = {read: stub(), readMany: stub()}
    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
    }
    configStore = {exists: stub(), getModifiedTime: stub(), read: stub(), write: stub()}
    tokenStore = {clear: stub(), load: stub(), save: stub()}
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
    restore()
  })

  function createUseCase(): PushUseCase {
    return new PushUseCase({
      cogitPushService,
      contextFileReader,
      contextTreeSnapshotService,
      projectConfigStore: configStore,
      terminal,
      tokenStore,
      webAppUrl: 'https://app.byterover.com',
    })
  }

  describe('validation', () => {
    it('should error when not authenticated', async () => {
      tokenStore.load.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Not authenticated')
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

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('expired')
    })

    it('should error when project config is missing', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(logMessages.some((msg) => msg.includes('Not connected to a space'))).to.be.true
    })

    it('should error when project is local-only (not cloud connected)', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(BrvConfig.createLocal({cwd: '/test/cwd'}))

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(logMessages.some((msg) => msg.includes('Not connected to a space'))).to.be.true
    })
  })

  describe('change detection', () => {
    it('should check for changes before reading files', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(contextTreeSnapshotService.getChanges.calledOnce).to.be.true
      expect(contextFileReader.readMany.called).to.be.false
    })

    it('should show message when no changes to push', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(logMessages).to.include('No context changes to push.')
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
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'structure/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Commit successful',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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
        .resolves([{content: '# My Title\n\nMy content', keywords: [], path: 'test/context.md', tags: [], title: 'My Title'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'test/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'develop', skipConfirmation: false})

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
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'test/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'test/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.rejects(new Error('Push failed: Network error'))

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
      expect(errorMessages.some((msg) => msg.includes('Network error'))).to.be.true
    })

    it('should display errors from cogit push service', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany
        .onFirstCall()
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'test/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.rejects(new Error('Failed to push to CoGit: Network timeout'))

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(errorMessages.some((msg) => msg.includes('Network timeout'))).to.be.true
    })

    it('should display errors from context file reader', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({
        added: ['test/context.md'],
        deleted: [],
        modified: [],
      })
      contextFileReader.readMany.rejects(new Error('File system error'))

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(errorMessages.some((msg) => msg.includes('File system error'))).to.be.true
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
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'test/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const confirmStub = stub(terminal, 'confirm').resolves(true)

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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

      stub(terminal, 'confirm').resolves(false)

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(logMessages).to.include('Push cancelled.')
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
        .resolves([{content: '# Test\n\nContent', keywords: [], path: 'test/context.md', tags: [], title: 'Test'}])
        .onSecondCall()
        .resolves([])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const confirmStub = stub(terminal, 'confirm').resolves(true)

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: true})

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
          {content: '# First\n\nContent', keywords: [], path: 'first/context.md', tags: [], title: 'First'},
          {content: '# Second\n\nContent', keywords: [], path: 'second/context.md', tags: [], title: 'Second'},
          {content: '# Third\n\nContent', keywords: [], path: 'third/context.md', tags: [], title: 'Third'},
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

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      expect(logMessages).to.include('\nNo valid context files to push.')
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
        .resolves([{content: '# Updated\n\nUpdated content', keywords: [], path: 'existing/context.md', tags: [], title: 'Updated'}])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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
        .resolves([{content: '# New\n\nNew content', keywords: [], path: 'new/context.md', tags: [], title: 'New'}])
        .onSecondCall()
        .resolves([{content: '# Updated\n\nUpdated content', keywords: [], path: 'existing/context.md', tags: [], title: 'Updated'}])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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
          {content: '# File1\n\nContent', keywords: [], path: 'file1/context.md', tags: [], title: 'File1'},
          {content: '# File2\n\nContent', keywords: [], path: 'file2/context.md', tags: [], title: 'File2'},
        ])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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
        .resolves([{content: '# New\n\nNew content', keywords: [], path: 'new/context.md', tags: [], title: 'New'}])
        .onSecondCall()
        .resolves([{content: '# Updated\n\nUpdated content', keywords: [], path: 'existing/context.md', tags: [], title: 'Updated'}])
      cogitPushService.push.resolves(
        new CogitPushResponse({
          message: 'Success',
          success: true,
        }),
      )
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

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

      const useCase = createUseCase()

      await useCase.run({branch: 'main', skipConfirmation: false})

      // contextFileReader.readMany is called only twice (for added and modified)
      // Deleted paths are passed directly to mapper without reading
      expect(contextFileReader.readMany.calledTwice).to.be.true
      expect(contextFileReader.readMany.firstCall.calledWith([])).to.be.true
      expect(contextFileReader.readMany.secondCall.calledWith([])).to.be.true
    })
  })
})
