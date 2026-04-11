/* eslint-disable camelcase -- YAML fixtures use snake_case keys */
/* eslint-disable no-template-curly-in-string -- resolveEnvVars tests use literal ${VAR} patterns */
import {expect} from 'chai'

import {
  resolveEnvVars,
  safeValidateSwarmConfig,
  SwarmConfigSchema,
  validateSwarmConfig,
} from '../../../../../src/agent/infra/swarm/config/swarm-config-schema.js'

describe('SwarmConfigSchema', () => {
  describe('minimal config', () => {
    it('accepts config with only byterover enabled', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.byterover.enabled).to.be.true
    })

    it('applies default values for all optional sections', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
        },
      }
      const result = SwarmConfigSchema.parse(input)

      // Routing defaults
      expect(result.routing.defaultStrategy).to.equal('adaptive')
      expect(result.routing.classificationMethod).to.equal('auto')
      expect(result.routing.defaultMaxResults).to.equal(10)
      expect(result.routing.rrfK).to.equal(60)

      // Performance defaults
      expect(result.performance.maxQueryLatencyMs).to.equal(2000)
      expect(result.performance.maxConcurrentProviders).to.equal(4)
      expect(result.performance.indexCacheTtlSeconds).to.equal(300)

      // Provenance defaults
      expect(result.provenance.enabled).to.be.true
      expect(result.provenance.fullRetentionDays).to.equal(30)
    })
  })

  describe('provider configs', () => {
    it('accepts obsidian with vault path', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
          obsidian: {enabled: true, vault_path: '~/Documents/MyVault'},
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.obsidian?.enabled).to.be.true
      expect(result.providers.obsidian?.vaultPath).to.equal('~/Documents/MyVault')
    })

    it('accepts local_markdown with folders', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
          local_markdown: {
            enabled: true,
            folders: [
              {follow_wikilinks: true, name: 'notes', path: '~/notes', read_only: true},
            ],
          },
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.localMarkdown?.folders).to.have.length(1)
      expect(result.providers.localMarkdown?.folders[0].followWikilinks).to.be.true
    })

    it('accepts honcho with api_key and app_id', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
          honcho: {api_key: 'test-key', app_id: 'my-app', enabled: true},
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.honcho?.apiKey).to.equal('test-key')
      expect(result.providers.honcho?.appId).to.equal('my-app')
    })

    it('accepts hindsight with connection_string and networks', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
          hindsight: {
            connection_string: 'postgres://localhost/hindsight',
            enabled: true,
            networks: ['world', 'experience'],
          },
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.hindsight?.connectionString).to.equal('postgres://localhost/hindsight')
      expect(result.providers.hindsight?.networks).to.deep.equal(['world', 'experience'])
    })

    it('accepts gbrain with repo_path', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
          gbrain: {enabled: true, repo_path: '~/gbrain-repo', search_mode: 'hybrid'},
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.gbrain?.repoPath).to.equal('~/gbrain-repo')
      expect(result.providers.gbrain?.searchMode).to.equal('hybrid')
    })

    it('defaults disabled providers to undefined', () => {
      const input = {
        providers: {
          byterover: {enabled: true},
        },
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.providers.obsidian).to.be.undefined
      expect(result.providers.honcho).to.be.undefined
    })
  })

  describe('budget config', () => {
    it('accepts budget with global cap and per-provider limits', () => {
      const input = {
        budget: {
          global_monthly_cap_cents: 5000,
          per_provider: {
            honcho: {max_queries_per_minute: 10, monthly_cap_cents: 2000},
          },
          warning_threshold_pct: 80,
        },
        providers: {byterover: {enabled: true}},
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.budget?.globalMonthlyCapCents).to.equal(5000)
      expect(result.budget?.warningThresholdPct).to.equal(80)
      expect(result.budget?.perProvider?.honcho?.monthlyCapCents).to.equal(2000)
    })
  })

  describe('enrichment config', () => {
    it('accepts enrichment edges', () => {
      const input = {
        enrichment: {
          edges: [
            {from: 'byterover', to: 'obsidian'},
            {from: 'byterover', to: 'local-markdown'},
          ],
        },
        providers: {byterover: {enabled: true}},
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.enrichment?.edges).to.have.length(2)
      expect(result.enrichment?.edges[0]).to.deep.equal({from: 'byterover', to: 'obsidian'})
    })

    it('defaults to empty edges when enrichment section is omitted', () => {
      const input = {
        providers: {byterover: {enabled: true}},
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.enrichment?.edges).to.deep.equal([])
    })

    it('defaults to empty edges when enrichment section is empty', () => {
      const input = {
        enrichment: {},
        providers: {byterover: {enabled: true}},
      }
      const result = SwarmConfigSchema.parse(input)
      expect(result.enrichment?.edges).to.deep.equal([])
    })
  })

  describe('validation errors', () => {
    it('rejects config without providers', () => {
      const result = safeValidateSwarmConfig({})
      expect(result.success).to.be.false
    })

    it('rejects invalid routing strategy', () => {
      const input = {
        providers: {byterover: {enabled: true}},
        routing: {default_strategy: 'invalid'},
      }
      const result = safeValidateSwarmConfig(input)
      expect(result.success).to.be.false
    })

    it('rejects negative budget values', () => {
      const input = {
        budget: {global_monthly_cap_cents: -100},
        providers: {byterover: {enabled: true}},
      }
      const result = safeValidateSwarmConfig(input)
      expect(result.success).to.be.false
    })
  })

  describe('validateSwarmConfig (throwing)', () => {
    it('returns validated config for valid input', () => {
      const result = validateSwarmConfig({
        providers: {byterover: {enabled: true}},
      })
      expect(result.providers.byterover.enabled).to.be.true
    })

    it('throws for invalid input', () => {
      expect(() => validateSwarmConfig({})).to.throw()
    })
  })

  describe('resolveEnvVars', () => {
    it('resolves ${VAR} syntax from env', () => {
      const result = resolveEnvVars('${MY_API_KEY}', {MY_API_KEY: 'secret123'})
      expect(result).to.equal('secret123')
    })

    it('returns original string when no env var pattern', () => {
      const result = resolveEnvVars('plain-value', {})
      expect(result).to.equal('plain-value')
    })

    it('returns original string when env var is not set', () => {
      const result = resolveEnvVars('${MISSING_VAR}', {})
      expect(result).to.equal('${MISSING_VAR}')
    })

    it('resolves multiple env vars in a string', () => {
      const result = resolveEnvVars('${HOST}:${PORT}', {HOST: 'localhost', PORT: '5432'})
      expect(result).to.equal('localhost:5432')
    })
  })
})
