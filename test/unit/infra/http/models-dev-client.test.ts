import {expect} from 'chai'
import nock from 'nock'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import {ModelsDevClient} from '../../../../src/server/infra/http/models-dev-client.js'
import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'

const SAMPLE_MODELS_DEV_DATA = {
  openai: {
    models: {
      'codex-mini-latest': {
        cost: {input: 1.5, output: 6},
        id: 'codex-mini-latest',
        limit: {context: 200_000, output: 128_000},
        name: 'Codex Mini (Latest)',
      },
      'gpt-4o': {
        cost: {input: 2.5, output: 10},
        id: 'gpt-4o',
        limit: {context: 128_000, output: 16_384},
        name: 'GPT-4o',
      },
      'gpt-5.3-codex': {
        cost: {input: 1.75, output: 14},
        id: 'gpt-5.3-codex',
        limit: {context: 400_000, output: 128_000},
        name: 'GPT-5.3 Codex',
      },
    },
    name: 'OpenAI',
  },
}

describe('ModelsDevClient', () => {
  let testDir: string
  let cachePath: string

  beforeEach(async () => {
    stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
    testDir = join(tmpdir(), `brv-test-models-dev-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    cachePath = join(testDir, 'models-dev.json')
    nock.cleanAll()
  })

  afterEach(async () => {
    restore()
    nock.cleanAll()
    await rm(testDir, {force: true, recursive: true})
  })

  it('should fetch models from models.dev and return for a provider', async () => {
    nock('https://models.dev').get('/api.json').reply(200, SAMPLE_MODELS_DEV_DATA)

    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('openai')

    expect(models).to.have.length(3)
    const ids = models.map((m) => m.id)
    expect(ids).to.include('gpt-5.3-codex')
    expect(ids).to.include('codex-mini-latest')
    expect(ids).to.include('gpt-4o')
  })

  it('should transform models.dev schema to ProviderModelInfo', async () => {
    nock('https://models.dev').get('/api.json').reply(200, SAMPLE_MODELS_DEV_DATA)

    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('openai')
    const codex = models.find((m) => m.id === 'gpt-5.3-codex')

    expect(codex).to.deep.equal({
      contextLength: 400_000,
      id: 'gpt-5.3-codex',
      isFree: false,
      name: 'GPT-5.3 Codex',
      pricing: {inputPerM: 1.75, outputPerM: 14},
      provider: 'OpenAI',
    })
  })

  it('should cache to disk after fetching', async () => {
    nock('https://models.dev').get('/api.json').reply(200, SAMPLE_MODELS_DEV_DATA)

    const client = new ModelsDevClient(cachePath)
    await client.getModelsForProvider('openai')

    const cacheContent = await readFile(cachePath, 'utf8')
    const envelope = JSON.parse(cacheContent)
    expect(envelope.data).to.have.property('openai')
    expect(envelope.timestamp).to.be.a('number')
  })

  it('should return cached data on subsequent calls within TTL', async () => {
    nock('https://models.dev').get('/api.json').once().reply(200, SAMPLE_MODELS_DEV_DATA)

    const client = new ModelsDevClient(cachePath)
    const models1 = await client.getModelsForProvider('openai')
    // Second call should NOT hit network (nock.once ensures single call)
    const models2 = await client.getModelsForProvider('openai')

    expect(models1).to.deep.equal(models2)
  })

  it('should use disk cache when available and in-memory cache is empty', async () => {
    // Pre-populate disk cache
    const envelope = {data: SAMPLE_MODELS_DEV_DATA, timestamp: Date.now()}
    await writeFile(cachePath, JSON.stringify(envelope), 'utf8')

    // No nock mock — should NOT hit network
    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('openai')

    expect(models).to.have.length(3)
  })

  it('should fall back to stale disk cache on network failure', async () => {
    // Pre-populate stale disk cache (timestamp 0 = expired)
    const envelope = {data: SAMPLE_MODELS_DEV_DATA, timestamp: 0}
    await writeFile(cachePath, JSON.stringify(envelope), 'utf8')

    nock('https://models.dev').get('/api.json').replyWithError('Network error')

    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('openai', true)

    expect(models).to.have.length(3)
  })

  it('should return empty array when network fails and no cache exists', async () => {
    nock('https://models.dev').get('/api.json').replyWithError('Network error')

    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('openai')

    expect(models).to.deep.equal([])
  })

  it('should return empty array for unknown provider', async () => {
    nock('https://models.dev').get('/api.json').reply(200, SAMPLE_MODELS_DEV_DATA)

    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('unknown-provider')

    expect(models).to.deep.equal([])
  })

  it('should bypass cache when forceRefresh is true', async () => {
    // Pre-populate disk cache with old data
    const oldData = {
      openai: {
        models: {
          'old-model': {cost: {input: 1, output: 2}, id: 'old-model', limit: {context: 100}, name: 'Old'},
        },
        name: 'OpenAI',
      },
    }
    const envelope = {data: oldData, timestamp: Date.now()}
    await writeFile(cachePath, JSON.stringify(envelope), 'utf8')

    nock('https://models.dev').get('/api.json').reply(200, SAMPLE_MODELS_DEV_DATA)

    const client = new ModelsDevClient(cachePath)
    // First call loads disk cache
    const models1 = await client.getModelsForProvider('openai')
    expect(models1).to.have.length(1)
    expect(models1[0].id).to.equal('old-model')

    // Force refresh fetches new data
    const models2 = await client.getModelsForProvider('openai', true)
    expect(models2).to.have.length(3)
  })

  it('should handle models without cost as free', async () => {
    const dataWithFreeModel = {
      openai: {
        models: {
          'free-model': {id: 'free-model', limit: {context: 100_000}, name: 'Free Model'},
        },
        name: 'OpenAI',
      },
    }
    nock('https://models.dev').get('/api.json').reply(200, dataWithFreeModel)

    const client = new ModelsDevClient(cachePath)
    const models = await client.getModelsForProvider('openai')

    expect(models[0].isFree).to.be.true
    expect(models[0].pricing).to.deep.equal({inputPerM: 0, outputPerM: 0})
  })
})
