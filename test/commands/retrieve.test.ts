import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IMemoryRetrievalService} from '../../src/core/interfaces/i-memory-retrieval-service.js'
import type {IPlaybookStore} from '../../src/core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Retrieve from '../../src/commands/retrieve.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrConfig} from '../../src/core/domain/entities/br-config.js'
import {Memory} from '../../src/core/domain/entities/memory.js'
import {RetrieveResult} from '../../src/core/domain/entities/retrieve-result.js'

/**
 * Testable Retrieve command that accepts mocked services
 */
class TestableRetrieve extends Retrieve {
  public logMessages: string[] = []
  public warnMessages: string[] = []

  // eslint-disable-next-line max-params
  constructor(
    private readonly mockMemoryService: IMemoryRetrievalService,
    private readonly mockPlaybookStore: IPlaybookStore,
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockTrackingService: ITrackingService,
    argv: string[],
    config: Config,
  ) {
    super(argv, config)
  }

  protected createServices() {
    return {
      memoryService: this.mockMemoryService,
      playbookStore: this.mockPlaybookStore,
      projectConfigStore: this.mockProjectConfigStore,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
  }

  // Suppress all output to prevent noisy test runs but capture for test assertions
  public error(input: Error | string): never {
    // Throw error to maintain behavior but suppress output
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(message?: string): void {
    // Capture message but suppress output
    if (message !== undefined) {
      this.logMessages.push(message)
    }
  }

  public warn(input: Error | string): Error | string {
    // Capture warning but suppress output, return input to match base signature
    const warnMessage = typeof input === 'string' ? input : input.message
    this.warnMessages.push(warnMessage)
    return input
  }
}

describe('retrieve command', () => {
  let config: Config
  let memoryService: sinon.SinonStubbedInstance<IMemoryRetrievalService>
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>

  const validToken = new AuthToken({
    accessToken: 'test-access-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: 'test-refresh-token',
    sessionKey: 'test-session-key',
    tokenType: 'Bearer',
    userEmail: 'user@example.com',
    userId: 'user-retrieve',
  })

  const validConfig = new BrConfig(
    new Date().toISOString(),
    'a0000000-b001-0000-0000-000000000000',
    'test-space',
    'team-id',
    'test-team',
  )

  const sampleMemory = new Memory({
    bulletId: 'lessons-00001',
    childrenIds: [],
    content: 'Sample memory content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    metadataType: 'experience',
    nodeKeys: ['path1'],
    parentIds: [],
    score: 0.85,
    section: 'Lessons Learned',
    tags: ['typescript', 'testing'],
    timestamp: '2025-10-26T15:59:01.191Z',
    title: 'Sample Memory',
  })

  const sampleResult = new RetrieveResult({
    memories: [sampleMemory],
    relatedMemories: [],
  })

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    memoryService = {
      retrieve: stub(),
    }
    playbookStore = {
      clear: stub(),
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }
    projectConfigStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }
    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }
    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('successful retrieval', () => {
    it('should retrieve memories with all flags', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query', '--node-keys', 'path1,path2'],
        config,
      )

      await command.run()

      // Verify service was called with correct parameters
      expect(memoryService.retrieve.calledOnce).to.be.true
      const callArgs = memoryService.retrieve.firstCall.args[0]
      expect(callArgs.query).to.equal('test query')
      expect(callArgs.spaceId).to.equal(validConfig.spaceId)
      expect(callArgs.accessToken).to.equal(validToken.accessToken)
      expect(callArgs.sessionKey).to.equal(validToken.sessionKey)
      expect(callArgs.nodeKeys).to.deep.equal(['path1', 'path2'])
    })

    it('should retrieve memories without node-keys (broad search)', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      // Verify service was called without nodeKeys
      expect(memoryService.retrieve.calledOnce).to.be.true
      const callArgs = memoryService.retrieve.firstCall.args[0]
      expect(callArgs.nodeKeys).to.be.undefined
    })

    it('should use short flags', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['-q', 'test query', '-n', 'path1'],
        config,
      )

      await command.run()

      expect(memoryService.retrieve.calledOnce).to.be.true
    })

    it('should parse comma-separated node-keys correctly', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query', '--node-keys', 'path1,path2,path3'],
        config,
      )

      await command.run()

      const callArgs = memoryService.retrieve.firstCall.args[0]
      expect(callArgs.nodeKeys).to.deep.equal(['path1', 'path2', 'path3'])
    })

    it('should trim whitespace from node-keys', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query', '--node-keys', ' path1 , path2 , path3 '],
        config,
      )

      await command.run()

      const callArgs = memoryService.retrieve.firstCall.args[0]
      expect(callArgs.nodeKeys).to.deep.equal(['path1', 'path2', 'path3'])
    })

    it('should display memories and related memories', async () => {
      const relatedMemory = new Memory({
        bulletId: 'common-00001',
        childrenIds: [],
        content: 'Related content',
        id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
        metadataType: 'knowledge',
        nodeKeys: [],
        parentIds: [],
        score: 0.5,
        section: 'Common Errors',
        tags: ['related'],
        timestamp: '2025-10-26T16:00:00.000Z',
        title: 'Related Memory',
      })

      const resultWithRelated = new RetrieveResult({
        memories: [sampleMemory],
        relatedMemories: [relatedMemory],
      })

      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(resultWithRelated)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      // Verify output contains both memories and related memories sections
      expect(command.logMessages.some((msg) => msg.includes('Memories'))).to.be.true
      expect(command.logMessages.some((msg) => msg.includes('Related Memories'))).to.be.true
      expect(command.logMessages.some((msg) => msg.includes('Sample Memory'))).to.be.true
      expect(command.logMessages.some((msg) => msg.includes('Related Memory'))).to.be.true
    })

    it('should handle empty results gracefully', async () => {
      const emptyResult = new RetrieveResult({
        memories: [],
        relatedMemories: [],
      })

      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(emptyResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      expect(command.logMessages.some((msg) => msg.includes('No memories found'))).to.be.true
    })

    it('should save retrieved memories to playbook', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      // Verify playbook operations
      expect(playbookStore.clear.calledOnce).to.be.true
      expect(playbookStore.save.calledOnce).to.be.true

      // Verify save was called after clear
      expect(playbookStore.clear.calledBefore(playbookStore.save)).to.be.true

      // Verify the saved playbook contains bullet with memoryId
      const savedPlaybook = playbookStore.save.getCall(0).args[0]
      const bullet = savedPlaybook.getBullet('lessons-00001')
      expect(bullet).to.exist
      expect(bullet?.memoryId).to.equal('019a1e9f-a5ec-7046-956d-27cdff4b6b67')
    })

    it('should warn but continue if playbook save fails', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)
      playbookStore.save.rejects(new Error('Save failed'))

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      // Verify warning was issued
      expect(command.warnMessages.length).to.equal(1)
      expect(command.warnMessages[0]).to.include('Failed to save memories to playbook')

      // Verify memories were still displayed
      expect(command.logMessages.some((msg) => msg.includes('Sample Memory'))).to.be.true
    })
  })

  describe('flag validation', () => {
    it('should require query flag', async () => {
      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        [],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        // oclif validation error
      }
    })
  })

  describe('project initialization check', () => {
    it('should error when project is not initialized', async () => {
      tokenStore.load.resolves(validToken)
      projectConfigStore.exists.resolves(false)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('not initialized')
      }
    })

    it('should error when project config cannot be read', async () => {
      tokenStore.load.resolves(validToken)
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves()

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to read project configuration')
      }
    })
  })

  describe('authentication check', () => {
    it('should error when not authenticated', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves()

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Not authenticated')
      }
    })

    it('should error when token is expired', async () => {
      const expiredToken = new AuthToken({
        accessToken: 'expired-token',
        expiresAt: new Date(Date.now() - 3600 * 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-expired',
      })

      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(expiredToken)

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('expired')
      }
    })
  })

  describe('service error handling', () => {
    it('should handle memory service errors gracefully', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.rejects(new Error('Service unavailable'))

      const command = new TestableRetrieve(
        memoryService,
        playbookStore,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Service unavailable')
      }
    })
  })
})
