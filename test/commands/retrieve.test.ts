import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IMemoryRetrievalService} from '../../src/core/interfaces/i-memory-retrieval-service.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Retrieve from '../../src/commands/retrieve.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../src/core/domain/entities/brv-config.js'
import {Memory} from '../../src/core/domain/entities/memory.js'
import {RetrieveResult} from '../../src/core/domain/entities/retrieve-result.js'

/**
 * Testable Retrieve command that accepts mocked services
 */
class TestableRetrieve extends Retrieve {
  public logMessages: string[] = []
  public warnMessages: string[] = []

  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockMemoryService: IMemoryRetrievalService,
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

  // Helper to get all log output as a single string
  public getLogOutput(): string {
    return this.logMessages.join('\n')
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

  const validConfig = new BrvConfig(
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

    it('should output valid pretty-printed JSON to stdout by default', async () => {
      const relatedMemory = new Memory({
        bulletId: 'common-00001',
        content: 'Related content',
        id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
        metadataType: 'knowledge',
        nodeKeys: [],
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
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query', '--node-keys', 'path1,path2'],
        config,
      )

      await command.run()

      // Verify JSON output
      const output = command.getLogOutput()
      const json = JSON.parse(output)

      // Verify structure
      expect(json).to.have.all.keys(['query', 'spaceName', 'nodeKeys', 'memories', 'relatedMemories'])
      expect(json.query).to.equal('test query')
      expect(json.spaceName).to.equal(validConfig.spaceName)
      expect(json.nodeKeys).to.deep.equal(['path1', 'path2'])
      expect(json.memories).to.have.lengthOf(1)
      expect(json.relatedMemories).to.have.lengthOf(1)

      // Verify primary memory has all fields
      const memory = json.memories[0]
      expect(memory).to.have.all.keys([
        'id',
        'bulletId',
        'title',
        'content',
        'section',
        'metadataType',
        'timestamp',
        'tags',
        'nodeKeys',
        'score',
        'parentIds',
        'childrenIds',
      ])
      expect(memory.id).to.equal('019a1e9f-a5ec-7046-956d-27cdff4b6b67')
      expect(memory.bulletId).to.equal('lessons-00001')
      expect(memory.title).to.equal('Sample Memory')
      expect(memory.score).to.equal(0.85)

      // Verify related memory (without score, parentIds, childrenIds)
      const relatedMem = json.relatedMemories[0]
      expect(relatedMem).to.have.all.keys([
        'id',
        'bulletId',
        'title',
        'content',
        'section',
        'metadataType',
        'timestamp',
        'tags',
        'nodeKeys',
      ])
      expect(relatedMem.id).to.equal('019a1e9f-a5ec-7046-956d-27cdff4b6b68')

      // Verify pretty-printed (contains newlines)
      expect(output).to.include('\n')
    })

    it('should output compact JSON with --compact flag', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query', '--compact'],
        config,
      )

      await command.run()

      const output = command.getLogOutput()
      const json = JSON.parse(output)

      // Verify it's valid JSON
      expect(json.query).to.equal('test query')
      expect(json.memories).to.have.lengthOf(1)

      // Verify compact (single line, no pretty formatting)
      expect(output).to.not.match(/\n\s+/)
    })

    it('should omit nodeKeys from JSON when not provided', async () => {
      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(validToken)
      memoryService.retrieve.resolves(sampleResult)

      const command = new TestableRetrieve(
        memoryService,
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      const output = command.getLogOutput()
      const json = JSON.parse(output)

      expect(json).to.not.have.property('nodeKeys')
      expect(json).to.have.all.keys(['query', 'spaceName', 'memories', 'relatedMemories'])
    })

    it('should return empty arrays for empty results', async () => {
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
        projectConfigStore,
        tokenStore,
        trackingService,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      const output = command.getLogOutput()
      const json = JSON.parse(output)

      expect(json.memories).to.be.an('array').that.is.empty
      expect(json.relatedMemories).to.be.an('array').that.is.empty
    })
  })

  describe('flag validation', () => {
    it('should require query flag', async () => {
      const command = new TestableRetrieve(memoryService, projectConfigStore, tokenStore, trackingService, [], config)

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
