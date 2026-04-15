import {expect} from 'chai'
import sinon from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {ISwarmCoordinator, SwarmQueryResult, SwarmStoreResult} from '../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {createToolsSDK} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

function createMockFileSystem(): IFileSystem {
  return {
    getWorkingDirectory: () => '/tmp/test',
    initialize: sinon.stub().resolves(),
  } as unknown as IFileSystem
}

function createMockCoordinator(overrides?: {
  executeResult?: SwarmQueryResult
  storeResult?: SwarmStoreResult
}): ISwarmCoordinator {
  const defaultQueryResult: SwarmQueryResult = {
    meta: {costCents: 0, providers: {}, queryType: 'factual', totalLatencyMs: 10},
    results: [{content: 'Test result', id: 'r1', metadata: {matchType: 'keyword', source: 'test.md'}, provider: 'gbrain', providerType: 'gbrain', score: 0.8}],
  }
  const defaultStoreResult: SwarmStoreResult = {
    id: 'concept/test',
    latencyMs: 50,
    provider: 'gbrain',
    success: true,
  }

  return {
    execute: sinon.stub().resolves(overrides?.executeResult ?? defaultQueryResult),
    getActiveProviders: sinon.stub().returns([]),
    getSummary: sinon.stub().returns({activeCount: 0, avgLatencyMs: 0, learningStatus: 'cold-start', monthlyBudgetCents: 0, monthlySpendCents: 0, providers: [], totalCount: 0, totalQueries: 0}),
    store: sinon.stub().resolves(overrides?.storeResult ?? defaultStoreResult),
  }
}

describe('ToolsSDK Swarm Integration', () => {
  afterEach(() => sinon.restore())

  describe('swarmQuery()', () => {
    it('delegates to coordinator.execute()', async () => {
      const coordinator = createMockCoordinator()
      const sdk = createToolsSDK({
        fileSystem: createMockFileSystem(),
        swarmCoordinator: coordinator,
      })

      const result = await sdk.swarmQuery('auth tokens') as SwarmQueryResult

      expect((coordinator.execute as sinon.SinonStub).calledOnce).to.be.true
      const callArgs = (coordinator.execute as sinon.SinonStub).firstCall.args[0]
      expect(callArgs.query).to.equal('auth tokens')
      expect(result.results).to.have.length(1)
    })

    it('passes limit and scope options', async () => {
      const coordinator = createMockCoordinator()
      const sdk = createToolsSDK({
        fileSystem: createMockFileSystem(),
        swarmCoordinator: coordinator,
      })

      await sdk.swarmQuery('test', {limit: 5, scope: 'auth'})

      const callArgs = (coordinator.execute as sinon.SinonStub).firstCall.args[0]
      expect(callArgs.maxResults).to.equal(5)
      expect(callArgs.scope).to.equal('auth')
    })

    it('works in query (read-only) mode', async () => {
      const coordinator = createMockCoordinator()
      const sdk = createToolsSDK({
        commandType: 'query',
        fileSystem: createMockFileSystem(),
        swarmCoordinator: coordinator,
      })

      const result = await sdk.swarmQuery('test') as SwarmQueryResult
      expect(result.results).to.have.length(1)
    })

    it('throws when coordinator is not configured', async () => {
      const sdk = createToolsSDK({
        fileSystem: createMockFileSystem(),
      })

      try {
        await sdk.swarmQuery('test')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('not available')
      }
    })
  })

  describe('swarmStore()', () => {
    it('delegates to coordinator.store()', async () => {
      const coordinator = createMockCoordinator()
      const sdk = createToolsSDK({
        fileSystem: createMockFileSystem(),
        swarmCoordinator: coordinator,
      })

      const result = await sdk.swarmStore({content: 'Dario Amodei is CEO of Anthropic'}) as SwarmStoreResult

      expect((coordinator.store as sinon.SinonStub).calledOnce).to.be.true
      expect(result.success).to.be.true
      expect(result.provider).to.equal('gbrain')
    })

    it('passes contentType and provider', async () => {
      const coordinator = createMockCoordinator()
      const sdk = createToolsSDK({
        fileSystem: createMockFileSystem(),
        swarmCoordinator: coordinator,
      })

      await sdk.swarmStore({content: 'test', contentType: 'entity', provider: 'gbrain'})

      const callArgs = (coordinator.store as sinon.SinonStub).firstCall.args[0]
      expect(callArgs.contentType).to.equal('entity')
      expect(callArgs.provider).to.equal('gbrain')
    })

    it('throws in query (read-only) mode', async () => {
      const coordinator = createMockCoordinator()
      const sdk = createToolsSDK({
        commandType: 'query',
        fileSystem: createMockFileSystem(),
        swarmCoordinator: coordinator,
      })

      try {
        await sdk.swarmStore({content: 'test'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('read-only')
      }
    })

    it('throws when coordinator is not configured', async () => {
      const sdk = createToolsSDK({
        fileSystem: createMockFileSystem(),
      })

      try {
        await sdk.swarmStore({content: 'test'})
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('not available')
      }
    })
  })
})
