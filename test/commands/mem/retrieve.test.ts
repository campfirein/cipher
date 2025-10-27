import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IMemoryRetrievalService} from '../../../src/core/interfaces/i-memory-retrieval-service.js'
import type {IProjectConfigStore} from '../../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import Retrieve from '../../../src/commands/mem/retrieve.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {BrConfig} from '../../../src/core/domain/entities/br-config.js'
import {Memory} from '../../../src/core/domain/entities/memory.js'
import {RetrieveResult} from '../../../src/core/domain/entities/retrieve-result.js'

/**
 * Testable Retrieve command that accepts mocked services
 */
class TestableRetrieve extends Retrieve {
  // eslint-disable-next-line max-params
  constructor(
    private readonly mockMemoryService: IMemoryRetrievalService,
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockTokenStore: ITokenStore,
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
    }
  }
}

describe('mem:retrieve command', () => {
  let config: Config
  let memoryService: sinon.SinonStubbedInstance<IMemoryRetrievalService>
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>

  const validToken = new AuthToken(
    'test-access-token',
    new Date(Date.now() + 3600 * 1000),
    'test-refresh-token',
    'test-session-key',
    'Bearer',
  )

  const validConfig = new BrConfig(
    new Date().toISOString(),
    'a0000000-b001-0000-0000-000000000000',
    'test-space',
    'team-id',
    'test-team',
  )

  const sampleMemory = new Memory({
    childrenIds: [],
    content: 'Sample memory content',
    id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
    nodeKeys: ['path1'],
    parentIds: [],
    score: 0.85,
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
        ['--query', 'test query', '--node-keys', ' path1 , path2 , path3 '],
        config,
      )

      await command.run()

      const callArgs = memoryService.retrieve.firstCall.args[0]
      expect(callArgs.nodeKeys).to.deep.equal(['path1', 'path2', 'path3'])
    })

    it('should display memories and related memories', async () => {
      const relatedMemory = new Memory({
        childrenIds: [],
        content: 'Related content',
        id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
        nodeKeys: [],
        parentIds: [],
        score: 0.5,
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

      const logStub = stub(Retrieve.prototype, 'log')

      const command = new TestableRetrieve(
        memoryService,
        projectConfigStore,
        tokenStore,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      // Verify output contains both memories and related memories sections
      const logMessages = logStub.getCalls().map((call) => call.args[0] as string)
      expect(logMessages.some((msg) => msg.includes('Memories'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Related Memories'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Sample Memory'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Related Memory'))).to.be.true

      logStub.restore()
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

      const logStub = stub(Retrieve.prototype, 'log')

      const command = new TestableRetrieve(
        memoryService,
        projectConfigStore,
        tokenStore,
        ['--query', 'test query'],
        config,
      )

      await command.run()

      const logMessages = logStub.getCalls().map((call) => call.args[0] as string)
      expect(logMessages.some((msg) => msg.includes('No memories found'))).to.be.true

      logStub.restore()
    })
  })

  describe('flag validation', () => {
    it('should require query flag', async () => {
      const command = new TestableRetrieve(memoryService, projectConfigStore, tokenStore, [], config)

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
      const expiredToken = new AuthToken(
        'expired-token',
        new Date(Date.now() - 3600 * 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )

      projectConfigStore.exists.resolves(true)
      projectConfigStore.read.resolves(validConfig)
      tokenStore.load.resolves(expiredToken)

      const command = new TestableRetrieve(
        memoryService,
        projectConfigStore,
        tokenStore,
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
