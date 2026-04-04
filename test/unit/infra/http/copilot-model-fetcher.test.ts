/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'
import {restore, stub} from 'sinon'

import type {ProviderModelInfo} from '../../../../src/server/core/interfaces/i-provider-model-fetcher.js'

import {CopilotModelFetcher} from '../../../../src/server/infra/http/provider-model-fetchers.js'
import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'

const SAMPLE_COPILOT_RESPONSE = {
  data: [
    {context_length: 200_000, id: 'claude-sonnet-4', name: 'Claude Sonnet 4'},
    {context_length: 128_000, id: 'gpt-4o', name: 'GPT-4o'},
    {context_length: 200_000, id: 'claude-opus-4', name: 'Claude Opus 4'},
  ],
}

describe('CopilotModelFetcher', () => {
  beforeEach(() => {
    stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
    nock.cleanAll()
  })

  afterEach(() => {
    restore()
    nock.cleanAll()
  })

  describe('fetchModels', () => {
    it('should fetch and parse models from Copilot API', async () => {
      nock('https://api.githubcopilot.com')
        .get('/models')
        .matchHeader('authorization', 'Bearer ghu_test-token')
        .matchHeader('copilot-integration-id', 'vscode-chat')
        .matchHeader('editor-version', 'vscode/1.99.0')
        .reply(200, SAMPLE_COPILOT_RESPONSE)

      const fetcher = new CopilotModelFetcher()
      const models = await fetcher.fetchModels('ghu_test-token')

      expect(models).to.have.length(3)
      const ids = models.map((m: ProviderModelInfo) => m.id)
      expect(ids).to.include('claude-sonnet-4')
      expect(ids).to.include('gpt-4o')
      expect(ids).to.include('claude-opus-4')
    })

    it('should map model fields correctly', async () => {
      nock('https://api.githubcopilot.com').get('/models').reply(200, SAMPLE_COPILOT_RESPONSE)

      const fetcher = new CopilotModelFetcher()
      const models = await fetcher.fetchModels('token')
      const sonnet = models.find((m: ProviderModelInfo) => m.id === 'claude-sonnet-4')

      expect(sonnet).to.deep.equal({
        contextLength: 200_000,
        id: 'claude-sonnet-4',
        isFree: false,
        name: 'Claude Sonnet 4',
        pricing: {inputPerM: 0, outputPerM: 0},
        provider: 'GitHub Copilot',
      })
    })

    it('should sort models by ID', async () => {
      nock('https://api.githubcopilot.com').get('/models').reply(200, SAMPLE_COPILOT_RESPONSE)

      const fetcher = new CopilotModelFetcher()
      const models = await fetcher.fetchModels('token')
      const ids = models.map((m: ProviderModelInfo) => m.id)

      expect(ids).to.deep.equal([...ids].sort())
    })

    it('should return cached models on second call without hitting API again', async () => {
      nock('https://api.githubcopilot.com').get('/models').once().reply(200, SAMPLE_COPILOT_RESPONSE)

      const fetcher = new CopilotModelFetcher()
      const first = await fetcher.fetchModels('token')
      const second = await fetcher.fetchModels('token')

      expect(first).to.equal(second)
      expect(nock.isDone()).to.be.true
    })

    it('should bypass cache when forceRefresh is true', async () => {
      nock('https://api.githubcopilot.com').get('/models').twice().reply(200, SAMPLE_COPILOT_RESPONSE)

      const fetcher = new CopilotModelFetcher()
      await fetcher.fetchModels('token')
      await fetcher.fetchModels('token', {forceRefresh: true})

      expect(nock.isDone()).to.be.true
    })

    it('should handle top-level array response', async () => {
      const arrayResponse = [
        {id: 'claude-sonnet-4', name: 'Claude Sonnet 4'},
        {id: 'gpt-4o', name: 'GPT-4o'},
      ]
      nock('https://api.githubcopilot.com').get('/models').reply(200, arrayResponse)

      const fetcher = new CopilotModelFetcher()
      const models = await fetcher.fetchModels('token')

      expect(models).to.have.length(2)
    })

    it('should use 200_000 as default context length when not provided', async () => {
      nock('https://api.githubcopilot.com')
        .get('/models')
        .reply(200, {data: [{id: 'some-model', name: 'Some Model'}]})

      const fetcher = new CopilotModelFetcher()
      const models = await fetcher.fetchModels('token')

      expect(models[0].contextLength).to.equal(200_000)
    })
  })

  describe('validateApiKey', () => {
    it('should return isValid true when API responds successfully', async () => {
      nock('https://api.githubcopilot.com').get('/models').reply(200, SAMPLE_COPILOT_RESPONSE)

      const fetcher = new CopilotModelFetcher()
      const result = await fetcher.validateApiKey('valid-token')

      expect(result.isValid).to.be.true
      expect(result.error).to.be.undefined
    })

    it('should return isValid false with error message for 401', async () => {
      nock('https://api.githubcopilot.com').get('/models').reply(401, {message: 'Unauthorized'})

      const fetcher = new CopilotModelFetcher()
      const result = await fetcher.validateApiKey('bad-token')

      expect(result.isValid).to.be.false
      expect(result.error).to.equal('Invalid or expired Copilot token')
    })

    it('should return isValid false with error message for 403', async () => {
      nock('https://api.githubcopilot.com').get('/models').reply(403, {message: 'Forbidden'})

      const fetcher = new CopilotModelFetcher()
      const result = await fetcher.validateApiKey('no-perms-token')

      expect(result.isValid).to.be.false
      expect(result.error).to.equal('Copilot token does not have required permissions')
    })

    it('should return isValid false for other API errors', async () => {
      nock('https://api.githubcopilot.com').get('/models').reply(500, 'Internal Server Error')

      const fetcher = new CopilotModelFetcher()
      const result = await fetcher.validateApiKey('token')

      expect(result.isValid).to.be.false
    })
  })
})
