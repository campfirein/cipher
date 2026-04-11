import {expect} from 'chai'

import type {SwarmConfig} from '../../../../src/agent/infra/swarm/config/swarm-config-schema.js'

import {buildProvidersFromConfig} from '../../../../src/agent/infra/swarm/provider-factory.js'

function createMinimalConfig(overrides?: Partial<SwarmConfig>): SwarmConfig {
  return {
    optimization: {
      edgeLearning: {enabled: true, explorationRate: 0.05, fixThreshold: 0.95, minObservationsToPrune: 100, pruneThreshold: 0.05},
      templateOptimization: {abTestSize: 5, enabled: true, failureRateTrigger: 0.3, frequency: 20},
    },
    performance: {
      fileWatcherDebounceMs: 1000,
      indexCacheTtlSeconds: 300,
      maxConcurrentProviders: 4,
      maxQueryLatencyMs: 2000,
    },
    provenance: {enabled: true, fullRetentionDays: 30, keepSummaries: true, storagePath: 'swarm/provenance'},
    providers: {byterover: {enabled: true}},
    routing: {classificationMethod: 'auto', defaultMaxResults: 10, defaultStrategy: 'adaptive', rrfK: 60},
    ...overrides,
  }
}

describe('buildProvidersFromConfig', () => {
  it('creates ByteRover adapter when enabled', () => {
    const config = createMinimalConfig()
    const providers = buildProvidersFromConfig(config)

    expect(providers.some((p) => p.id === 'byterover')).to.be.true
  })

  it('creates Obsidian adapter when enabled with vault path', () => {
    const config = createMinimalConfig({
      providers: {
        byterover: {enabled: true},
        obsidian: {
          enabled: true,
          ignorePatterns: [],
          indexOnStartup: true,
          readOnly: true,
          vaultPath: '/tmp/test-vault',
          watchForChanges: false,
        },
      },
    })
    const providers = buildProvidersFromConfig(config)

    expect(providers.some((p) => p.id === 'obsidian')).to.be.true
  })

  it('creates LocalMarkdown adapters for each folder when enabled', () => {
    const config = createMinimalConfig({
      providers: {
        byterover: {enabled: true},
        localMarkdown: {
          enabled: true,
          folders: [
            {followWikilinks: true, name: 'notes', path: '/tmp/notes', readOnly: true},
            {followWikilinks: true, name: 'docs', path: '/tmp/docs', readOnly: true},
          ],
          watchForChanges: false,
        },
      },
    })
    const providers = buildProvidersFromConfig(config)

    expect(providers.some((p) => p.id === 'local-markdown:notes')).to.be.true
    expect(providers.some((p) => p.id === 'local-markdown:docs')).to.be.true
  })

  it('skips disabled providers', () => {
    const config = createMinimalConfig({
      providers: {
        byterover: {enabled: true},
        obsidian: {
          enabled: false,
          ignorePatterns: [],
          indexOnStartup: true,
          readOnly: true,
          vaultPath: '/tmp/test-vault',
          watchForChanges: false,
        },
      },
    })
    const providers = buildProvidersFromConfig(config)

    expect(providers.some((p) => p.id === 'obsidian')).to.be.false
  })

  it('accepts optional searchService for ByteRover adapter', () => {
    const config = createMinimalConfig()
    const mockSearch = {
      async search() {
        return {results: [{excerpt: 'test', path: 'test.md', score: 0.9, title: 'Test'}], totalFound: 1}
      },
    }
    const providers = buildProvidersFromConfig(config, {searchService: mockSearch})

    expect(providers.some((p) => p.id === 'byterover')).to.be.true
  })

  it('deduplicates local-markdown folders with the same name', () => {
    const config = createMinimalConfig({
      providers: {
        byterover: {enabled: true},
        localMarkdown: {
          enabled: true,
          folders: [
            {followWikilinks: true, name: 'notes', path: '/tmp/notes-a', readOnly: true},
            {followWikilinks: true, name: 'notes', path: '/tmp/notes-b', readOnly: true},
          ],
          watchForChanges: false,
        },
      },
    })
    const providers = buildProvidersFromConfig(config)

    // Both folders should be present with distinct IDs
    const mdProviders = providers.filter((p) => p.type === 'local-markdown')
    expect(mdProviders).to.have.length(2)
    const ids = new Set(mdProviders.map((p) => p.id))
    expect(ids.size).to.equal(2)
  })

  it('passes readOnly config to local-markdown adapter', () => {
    const config = createMinimalConfig({
      providers: {
        byterover: {enabled: true},
        localMarkdown: {
          enabled: true,
          folders: [
            {followWikilinks: true, name: 'readonly-notes', path: '/tmp/readonly', readOnly: true},
          ],
          watchForChanges: false,
        },
      },
    })
    const providers = buildProvidersFromConfig(config)
    const mdProvider = providers.find((p) => p.type === 'local-markdown')

    expect(mdProvider?.capabilities.writeSupported).to.be.false
  })

  it('passes followWikilinks=false to disable graph traversal', () => {
    const config = createMinimalConfig({
      providers: {
        byterover: {enabled: true},
        localMarkdown: {
          enabled: true,
          folders: [
            {followWikilinks: false, name: 'flat-notes', path: '/tmp/flat', readOnly: false},
          ],
          watchForChanges: false,
        },
      },
    })
    const providers = buildProvidersFromConfig(config)
    const mdProvider = providers.find((p) => p.type === 'local-markdown')

    expect(mdProvider?.capabilities.graphTraversal).to.be.false
  })

  it('returns empty array when byterover is disabled and no other providers', () => {
    const config = createMinimalConfig({
      providers: {byterover: {enabled: false}},
    })
    const providers = buildProvidersFromConfig(config)

    expect(providers).to.have.length(0)
  })
})
