import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {match, restore, stub} from 'sinon'

import type {IMemoryStorageService} from '../../../src/core/interfaces/i-memory-storage-service.js'
import type {IPlaybookStore} from '../../../src/core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import MemPush from '../../../src/commands/mem/push.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrConfig} from '../../../src/core/domain/entities/br-config.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {PresignedUrl} from '../../../src/core/domain/entities/presigned-url.js'
import {PresignedUrlsResponse} from '../../../src/core/domain/entities/presigned-urls-response.js'

class TestableMemPush extends MemPush {
  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockMemoryService: IMemoryStorageService,
    private readonly mockPlaybookStore: IPlaybookStore,
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockTokenStore: ITokenStore,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      memoryService: this.mockMemoryService,
      playbookStore: this.mockPlaybookStore,
      projectConfigStore: this.mockConfigStore,
      tokenStore: this.mockTokenStore,
    }
  }
}

describe('MemPush Command', () => {
  let config: Config
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let memoryService: sinon.SinonStubbedInstance<IMemoryStorageService>
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let projectConfig: BrConfig
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let validToken: AuthToken

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    memoryService = {confirmUpload: stub(), getPresignedUrls: stub(), uploadFile: stub()}
    playbookStore = {clear: stub(), delete: stub(), exists: stub(), load: stub(), save: stub()}
    configStore = {exists: stub(), read: stub(), write: stub()}
    tokenStore = {clear: stub(), load: stub(), save: stub()}

    validToken = new AuthToken(
      'access-token',
      new Date(Date.now() + 3600 * 1000),
      'refresh-token',
      'session-key',
      'Bearer',
    )

    projectConfig = new BrConfig(new Date().toISOString(), 'space-123', 'my-space', 'team-456', 'my-team')
  })

  afterEach(() => {
    restore()
  })

  describe('validation', () => {
    it('should error when not authenticated', async () => {
      tokenStore.load.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Not authenticated')
      }
    })

    it('should error when token is expired', async () => {
      const expiredToken = new AuthToken(
        'access-token',
        new Date(Date.now() - 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )

      tokenStore.load.resolves(expiredToken)

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('expired')
      }
    })

    it('should error when project not initialized', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Project not initialized')
      }
    })

    it('should error when playbook not found', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(false)

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Playbook not found')
      }
    })
  })

  describe('successful execution', () => {
    it('should successfully get presigned URLs with default branch', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-123',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(memoryService.getPresignedUrls.calledOnce).to.be.true
      expect(
        memoryService.getPresignedUrls.calledWith({
          accessToken: 'access-token',
          branch: 'main',
          fileNames: ['playbook.json'],
          sessionKey: 'session-key',
          spaceId: 'space-123',
          teamId: 'team-456',
        }),
      ).to.be.true
    })

    it('should use custom branch when provided via flag', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-456',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)
      command.argv = ['--branch', 'develop']

      await command.run()

      expect(
        memoryService.getPresignedUrls.calledWith({
          accessToken: 'access-token',
          branch: 'develop',
          fileNames: ['playbook.json'],
          sessionKey: 'session-key',
          spaceId: 'space-123',
          teamId: 'team-456',
        }),
      ).to.be.true
    })

    it('should use short flag -b for branch', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-789',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)
      command.argv = ['-b', 'feature']

      await command.run()

      expect(
        memoryService.getPresignedUrls.calledWith(
          match({
            branch: 'feature',
          }),
        ),
      ).to.be.true
    })

    it('should handle multiple presigned URLs in response', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [
            new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url-1'),
            new PresignedUrl('metadata.json', 'https://storage.googleapis.com/signed-url-2'),
          ],
          'req-multi',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(memoryService.getPresignedUrls.calledOnce).to.be.true
    })
  })

  describe('error handling', () => {
    it('should propagate errors from memory service', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      memoryService.getPresignedUrls.rejects(new Error('Network timeout'))

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Network timeout')
      }
    })

    it('should propagate errors from playbook store', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.rejects(new Error('File system error'))

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('File system error')
      }
    })
  })

  describe('file upload', () => {
    it('should upload playbook after getting presigned URLs', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-upload-1',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(memoryService.uploadFile.calledOnce).to.be.true
      expect(playbookStore.load.calledOnce).to.be.true
    })

    it('should load playbook before uploading', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-upload-2',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      // Verify load was called before upload
      expect(playbookStore.load.calledBefore(memoryService.uploadFile)).to.be.true
    })

    it('should call uploadFile with correct parameters', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      const uploadUrl = 'https://storage.googleapis.com/bucket/file.json?sig=abc'
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse([new PresignedUrl('playbook.json', uploadUrl)], 'req-upload-3'),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(memoryService.uploadFile.calledOnce).to.be.true
      const uploadCall = memoryService.uploadFile.getCall(0)
      expect(uploadCall.args[0]).to.equal(uploadUrl)
      expect(uploadCall.args[1]).to.be.a('string') // Playbook JSON content
      expect(uploadCall.args[1]).to.include('"bullets"')
    })

    it('should upload multiple files sequentially', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [
            new PresignedUrl('playbook.json', 'https://storage.googleapis.com/url1'),
            new PresignedUrl('metadata.json', 'https://storage.googleapis.com/url2'),
          ],
          'req-upload-4',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(memoryService.uploadFile.callCount).to.equal(2)
      expect(memoryService.uploadFile.getCall(0).args[0]).to.include('url1')
      expect(memoryService.uploadFile.getCall(1).args[0]).to.include('url2')
    })

    it('should handle upload errors gracefully', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-upload-5',
        ),
      )
      memoryService.uploadFile.rejects(new Error('Upload failed: Network error'))

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Upload failed')
      }
    })

    it('should error if playbook load fails', async () => {
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves()
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-upload-6',
        ),
      )

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Failed to load playbook')
      }

      // Upload should not be called
      expect(memoryService.uploadFile.called).to.be.false
    })
  })

  describe('cleanup after upload', () => {
    it('should clear playbook after successful upload', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-cleanup-1',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()
      playbookStore.clear.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      // Verify playbook was cleared after upload and confirmation
      expect(playbookStore.clear.calledOnce).to.be.true
      expect(playbookStore.clear.calledAfter(memoryService.confirmUpload)).to.be.true
    })

    it('should not cleanup if upload fails', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-cleanup-2',
        ),
      )
      memoryService.uploadFile.rejects(new Error('Upload failed'))
      playbookStore.clear.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch {
        // Expected error
      }

      // Cleanup should NOT have been called
      expect(playbookStore.clear.called).to.be.false
    })

    it('should handle cleanup errors gracefully', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-cleanup-3',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()
      playbookStore.clear.rejects(new Error('Clear failed'))

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Clear failed')
      }
    })
  })

  describe('upload confirmation', () => {
    it('should call confirmUpload after successful file upload', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-confirm-1',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(memoryService.confirmUpload.calledOnce).to.be.true
      expect(memoryService.confirmUpload.calledAfter(memoryService.uploadFile)).to.be.true
    })

    it('should pass correct requestId to confirmUpload', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      const requestId = 'req-confirm-2'
      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          requestId,
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      await command.run()

      expect(
        memoryService.confirmUpload.calledWith({
          accessToken: 'access-token',
          requestId,
          sessionKey: 'session-key',
          spaceId: 'space-123',
          teamId: 'team-456',
        }),
      ).to.be.true
    })

    it('should not cleanup if confirmation fails', async () => {
      const mockPlaybook = new Playbook()
      mockPlaybook.addBullet('Test', 'Sample bullet', undefined, {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      tokenStore.load.resolves(validToken)
      configStore.read.resolves(projectConfig)
      playbookStore.exists.resolves(true)
      playbookStore.load.resolves(mockPlaybook)
      memoryService.getPresignedUrls.resolves(
        new PresignedUrlsResponse(
          [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/signed-url')],
          'req-confirm-3',
        ),
      )
      memoryService.uploadFile.resolves()
      memoryService.confirmUpload.rejects(new Error('Confirmation failed'))
      playbookStore.clear.resolves()

      const command = new TestableMemPush(memoryService, playbookStore, configStore, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Confirmation failed')
      }

      // Cleanup should NOT have been called
      expect(playbookStore.clear.called).to.be.false
    })
  })
})
