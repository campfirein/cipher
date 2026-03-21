import {expect} from 'chai'
import {type SinonStub, stub} from 'sinon'

import type {ProviderModelInfo} from '../../../../src/server/core/interfaces/i-provider-model-fetcher.js'
import type {ModelsDevClient} from '../../../../src/server/infra/http/models-dev-client.js'

import {CODEX_FALLBACK_MODELS, OpenAIModelFetcher} from '../../../../src/server/infra/http/provider-model-fetchers.js'

function createMockModelsDevClient(models: ProviderModelInfo[] = []): ModelsDevClient {
  return {
    getModelsForProvider: stub().resolves(models),
    refresh: stub().resolves(),
  } as unknown as ModelsDevClient
}

const SAMPLE_OPENAI_MODELS: ProviderModelInfo[] = [
  {
    contextLength: 400_000,
    id: 'gpt-5.3-codex',
    isFree: false,
    name: 'GPT-5.3 Codex',
    pricing: {inputPerM: 1.75, outputPerM: 14},
    provider: 'OpenAI',
  },
  {
    contextLength: 200_000,
    id: 'codex-mini-latest',
    isFree: false,
    name: 'Codex Mini (Latest)',
    pricing: {inputPerM: 1.5, outputPerM: 6},
    provider: 'OpenAI',
  },
  {
    contextLength: 200_000,
    id: 'gpt-5.3-codex-spark',
    isFree: false,
    name: 'GPT-5.3 Codex Spark',
    pricing: {inputPerM: 0.5, outputPerM: 2},
    provider: 'OpenAI',
  },
  {
    contextLength: 128_000,
    id: 'gpt-4o',
    isFree: false,
    name: 'GPT-4o',
    pricing: {inputPerM: 2.5, outputPerM: 10},
    provider: 'OpenAI',
  },
  {
    contextLength: 200_000,
    id: 'gpt-5.2',
    isFree: false,
    name: 'GPT-5.2',
    pricing: {inputPerM: 1.75, outputPerM: 14},
    provider: 'OpenAI',
  },
  {
    contextLength: 128_000,
    id: 'gpt-4.1',
    isFree: false,
    name: 'GPT-4.1',
    pricing: {inputPerM: 2, outputPerM: 8},
    provider: 'OpenAI',
  },
]

describe('OpenAIModelFetcher', () => {
  describe('fetchModels with OAuth (models.dev)', () => {
    it('should fetch from models.dev and filter to Codex-allowed models', async () => {
      const mockClient = createMockModelsDevClient(SAMPLE_OPENAI_MODELS)
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      const models = await fetcher.fetchModels('token', {authMethod: 'oauth'})

      const ids = models.map((m) => m.id)
      // Should include only models in the strict allowlist
      expect(ids).to.include('gpt-5.3-codex')
      expect(ids).to.include('gpt-5.2')
      // Should NOT include models with "codex" in name but not in allowlist
      expect(ids).to.not.include('codex-mini-latest')
      expect(ids).to.not.include('gpt-5.3-codex-spark')
      // Should NOT include non-allowlist models
      expect(ids).to.not.include('gpt-4o')
      expect(ids).to.not.include('gpt-4.1')
    })

    it('should zero out costs for all OAuth models (included in subscription)', async () => {
      const mockClient = createMockModelsDevClient(SAMPLE_OPENAI_MODELS)
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      const models = await fetcher.fetchModels('token', {authMethod: 'oauth'})

      for (const model of models) {
        expect(model.isFree).to.be.false
        expect(model.pricing.inputPerM).to.equal(0)
        expect(model.pricing.outputPerM).to.equal(0)
      }
    })

    it('should preserve context length from models.dev', async () => {
      const mockClient = createMockModelsDevClient(SAMPLE_OPENAI_MODELS)
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      const models = await fetcher.fetchModels('token', {authMethod: 'oauth'})

      const codex = models.find((m) => m.id === 'gpt-5.3-codex')
      expect(codex?.contextLength).to.equal(400_000)
    })

    it('should fall back to CODEX_FALLBACK_MODELS when models.dev returns empty', async () => {
      const mockClient = createMockModelsDevClient([])
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      const models = await fetcher.fetchModels('token', {authMethod: 'oauth'})

      expect(models).to.deep.equal([...CODEX_FALLBACK_MODELS])
    })

    it('should fall back when no models match the allowlist', async () => {
      const nonCodexModels: ProviderModelInfo[] = [
        {
          contextLength: 128_000,
          id: 'gpt-4o',
          isFree: false,
          name: 'GPT-4o',
          pricing: {inputPerM: 2.5, outputPerM: 10},
          provider: 'OpenAI',
        },
      ]
      const mockClient = createMockModelsDevClient(nonCodexModels)
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      const models = await fetcher.fetchModels('token', {authMethod: 'oauth'})

      expect(models).to.deep.equal([...CODEX_FALLBACK_MODELS])
    })

    it('should call getModelsForProvider with openai provider ID', async () => {
      const mockClient = createMockModelsDevClient(SAMPLE_OPENAI_MODELS)
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      await fetcher.fetchModels('token', {authMethod: 'oauth'})

      expect((mockClient.getModelsForProvider as SinonStub).calledWith('openai')).to.be.true
    })

    it('should pass forceRefresh to models.dev client', async () => {
      const mockClient = createMockModelsDevClient(SAMPLE_OPENAI_MODELS)
      const fetcher = new OpenAIModelFetcher({modelsDevClient: mockClient})
      await fetcher.fetchModels('token', {authMethod: 'oauth', forceRefresh: true})

      expect((mockClient.getModelsForProvider as SinonStub).calledWith('openai', true)).to.be.true
    })
  })
})
