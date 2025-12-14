import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import * as sinon from 'sinon'

import type {ICogitPullService} from '../../../src/core/interfaces/i-cogit-pull-service.js'
import type {IContextTreeSnapshotService} from '../../../src/core/interfaces/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../../src/core/interfaces/i-context-tree-writer-service.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../../src/core/interfaces/i-tracking-service.js'

import {BRV_CONFIG_VERSION} from '../../../src/constants.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {CogitSnapshotAuthor} from '../../../src/core/domain/entities/cogit-snapshot-author.js'
import {CogitSnapshotFile} from '../../../src/core/domain/entities/cogit-snapshot-file.js'
import {CogitSnapshot} from '../../../src/core/domain/entities/cogit-snapshot.js'
import {PullUseCase} from '../../../src/infra/usecase/pull-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

const createSnapshot = (): CogitSnapshot =>
  new CogitSnapshot({
    author: new CogitSnapshotAuthor({email: 'author@example.com', name: 'Author', when: '2024-01-01T00:00:00Z'}),
    branch: 'main',
    commitSha: 'abc123def456',
    files: [
      new CogitSnapshotFile({
        content: Buffer.from('# Test').toString('base64'),
        mode: '100644',
        path: 'test/context.md',
        sha: 'file-sha',
        size: 6,
      }),
    ],
    message: 'Test commit',
  })

describe('PullUseCase', () => {
  let cogitPullService: SinonStubbedInstance<ICogitPullService>
  let configStore: SinonStubbedInstance<IProjectConfigStore>
  let contextTreeSnapshotService: SinonStubbedInstance<IContextTreeSnapshotService>
  let contextTreeWriterService: SinonStubbedInstance<IContextTreeWriterService>
  let errorMessages: string[]
  let logMessages: string[]
  let projectConfig: BrvConfig
  let terminal: ITerminal
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let trackingService: SinonStubbedInstance<ITrackingService>
  let validToken: AuthToken

  beforeEach(() => {
    logMessages = []
    errorMessages = []

    terminal = createMockTerminal({
      error: (msg) => errorMessages.push(msg),
      log: (msg) => msg !== undefined && logMessages.push(msg),
    })

    cogitPullService = {pull: sinon.stub()}
    contextTreeSnapshotService = {
      getChanges: sinon.stub(),
      getCurrentState: sinon.stub(),
      hasSnapshot: sinon.stub(),
      initEmptySnapshot: sinon.stub(),
      saveSnapshot: sinon.stub(),
    }
    contextTreeWriterService = {sync: sinon.stub()}
    configStore = {exists: sinon.stub(), read: sinon.stub(), write: sinon.stub()}
    tokenStore = {clear: sinon.stub(), load: sinon.stub(), save: sinon.stub()}
    trackingService = {
      track: sinon.stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-pull',
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
    sinon.restore()
  })

  function createUseCase(): PullUseCase {
    return new PullUseCase({
      cogitPullService,
      contextTreeSnapshotService,
      contextTreeWriterService,
      projectConfigStore: configStore,
      terminal,
      tokenStore,
      trackingService,
    })
  }

  describe('validation', () => {
    it('should error when not authenticated', async () => {
      tokenStore.load.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

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

      await useCase.run({branch: 'main'})

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('expired')
    })

    it('should error when project not initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves()

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Project not initialized')
      }
    })
  })

  describe('local changes detection', () => {
    it('should error when there are local added changes', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: ['new/context.md'], deleted: [], modified: []})

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Run "brv push" first')
      }

      expect(cogitPullService.pull.called).to.be.false
    })

    it('should error when there are local modified changes', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: ['existing/context.md']})

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Run "brv push" first')
      }

      expect(cogitPullService.pull.called).to.be.false
    })

    it('should error when there are local deleted changes', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: ['old/context.md'], modified: []})

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Run "brv push" first')
      }

      expect(cogitPullService.pull.called).to.be.false
    })

    it('should proceed when no local changes', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: [], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      expect(cogitPullService.pull.calledOnce).to.be.true
    })
  })

  describe('successful execution', () => {
    it('should pull and sync files when no local changes', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: ['test/context.md'], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      expect(cogitPullService.pull.calledOnce).to.be.true
      expect(contextTreeWriterService.sync.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
    })

    it('should call cogitPullService.pull with correct params', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: [], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      const pullCall = cogitPullService.pull.getCall(0)
      expect(pullCall.args[0].accessToken).to.equal('access-token')
      expect(pullCall.args[0].sessionKey).to.equal('session-key')
      expect(pullCall.args[0].branch).to.equal('main')
      expect(pullCall.args[0].teamId).to.equal('team-456')
      expect(pullCall.args[0].spaceId).to.equal('space-123')
    })

    it('should use custom branch when provided', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: [], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'develop'})

      const pullCall = cogitPullService.pull.getCall(0)
      expect(pullCall.args[0].branch).to.equal('develop')
    })

    it('should pass snapshot files to contextTreeWriterService.sync', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})

      const snapshot = createSnapshot()
      cogitPullService.pull.resolves(snapshot)
      contextTreeWriterService.sync.resolves({added: ['test/context.md'], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      const syncCall = contextTreeWriterService.sync.getCall(0)
      expect(syncCall.args[0].files).to.deep.equal(snapshot.files)
    })

    it('should save snapshot only after successful sync', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: [], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
      expect(contextTreeSnapshotService.saveSnapshot.calledAfter(contextTreeWriterService.sync)).to.be.true
    })

    it('should display success message with stats', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: ['file1.md'], deleted: ['file2.md'], edited: ['file3.md']})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      expect(logMessages.some((msg) => msg.includes('Successfully pulled'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Branch: main'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Commit: abc123d'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Added: 1, Edited: 1, Deleted: 1'))).to.be.true
    })
  })

  describe('error handling', () => {
    it('should not save snapshot if pull fails', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.rejects(new Error('Pull failed: Network error'))

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch {
        // Expected error
      }

      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
    })

    it('should not save snapshot if sync fails', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.rejects(new Error('Sync failed: File system error'))

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch {
        // Expected error
      }

      expect(contextTreeSnapshotService.saveSnapshot.called).to.be.false
    })

    it('should propagate errors from cogit pull service', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.rejects(new Error('Failed to pull from CoGit: Network timeout'))

      const useCase = createUseCase()

      try {
        await useCase.run({branch: 'main'})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Network timeout')
      }
    })
  })

  describe('empty snapshot handling', () => {
    it('should handle empty files array from remote', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(
        new CogitSnapshot({
          author: new CogitSnapshotAuthor({email: 'a@b.com', name: 'A', when: '2024-01-01T00:00:00Z'}),
          branch: 'main',
          commitSha: 'abc123',
          files: [],
          message: 'Empty',
        }),
      )
      contextTreeWriterService.sync.resolves({added: [], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      expect(contextTreeWriterService.sync.calledOnce).to.be.true
      expect(contextTreeWriterService.sync.getCall(0).args[0].files).to.deep.equal([])
      expect(contextTreeSnapshotService.saveSnapshot.calledOnce).to.be.true
    })
  })

  describe('tracking', () => {
    it('should track mem:pull event', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      contextTreeSnapshotService.getChanges.resolves({added: [], deleted: [], modified: []})
      cogitPullService.pull.resolves(createSnapshot())
      contextTreeWriterService.sync.resolves({added: [], deleted: [], edited: []})
      contextTreeSnapshotService.saveSnapshot.resolves()

      const useCase = createUseCase()

      await useCase.run({branch: 'main'})

      expect(trackingService.track.calledWith('mem:pull')).to.be.true
    })
  })
})
