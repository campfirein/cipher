/* eslint-disable camelcase -- wizard answers mirror YAML snake_case keys */
/* eslint-disable no-template-curly-in-string -- fixtures use literal ${VAR} placeholders */
import {expect} from 'chai'
import {load} from 'js-yaml'

import {SwarmConfigSchema} from '../../../../../src/agent/infra/swarm/config/swarm-config-schema.js'
import {scaffoldConfig, type WizardAnswers} from '../../../../../src/agent/infra/swarm/wizard/config-scaffolder.js'

describe('scaffoldConfig', () => {
  it('generates valid YAML for minimal config (byterover only)', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
      ],
    }
    const result = scaffoldConfig(answers)
    expect(result.yaml).to.be.a('string')
    expect(result.yaml).to.include('byterover')

    // Roundtrip: output must parse through the schema
    const parsed = load(result.yaml)
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.providers.byterover.enabled).to.be.true
  })

  it('generates config with obsidian provider', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {vault_path: '~/Documents/MyVault'}, enabled: true, id: 'obsidian'},
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.providers.obsidian?.enabled).to.be.true
    expect(validated.providers.obsidian?.vaultPath).to.equal('~/Documents/MyVault')
  })

  it('generates config with local_markdown folders', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {
          config: {
            folders: [
              {follow_wikilinks: true, name: 'notes', path: '~/notes', read_only: true},
            ],
          },
          enabled: true,
          id: 'local-markdown',
        },
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.providers.localMarkdown?.folders).to.have.length(1)
  })

  it('generates config with cloud providers and budget', () => {
    const answers: WizardAnswers = {
      budget: {globalMonthlyCents: 5000},
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {api_key: '${HONCHO_API_KEY}', app_id: 'my-app'}, enabled: true, id: 'honcho'},
      ],
    }
    const result = scaffoldConfig(answers)
    expect(result.yaml).to.include('budget')
    expect(result.yaml).to.include('HONCHO_API_KEY')

    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.providers.honcho?.enabled).to.be.true
    expect(validated.budget?.globalMonthlyCapCents).to.equal(5000)
  })

  it('omits budget section when no budget specified', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
      ],
    }
    const result = scaffoldConfig(answers)
    expect(result.yaml).to.not.include('budget')
  })

  it('merges multiple local-markdown entries into one folders array', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {
          config: {folders: [{follow_wikilinks: true, name: 'notes', path: '~/notes', read_only: true}]},
          enabled: true,
          id: 'local-markdown',
        },
        {
          config: {folders: [{follow_wikilinks: true, name: 'skills', path: '~/skills', read_only: false}]},
          enabled: true,
          id: 'local-markdown',
        },
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.providers.localMarkdown?.folders).to.have.length(2)
    expect(validated.providers.localMarkdown?.folders[0].name).to.equal('notes')
    expect(validated.providers.localMarkdown?.folders[1].name).to.equal('skills')
    // Folder merges should not produce warnings
    expect(result.warnings).to.have.length(0)
  })

  it('merges multiple obsidian entries by keeping the last vault_path and emitting a warning', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {vault_path: '~/Vault1'}, enabled: true, id: 'obsidian'},
        {config: {vault_path: '~/Vault2'}, enabled: true, id: 'obsidian'},
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    // Last vault wins (schema only supports one)
    expect(validated.providers.obsidian?.vaultPath).to.equal('~/Vault2')
    // Warning about dropped vault
    expect(result.warnings).to.have.length(1)
    expect(result.warnings[0]).to.include('~/Vault1')
    expect(result.warnings[0]).to.include('obsidian')
  })

  it('does not emit warnings when no duplicates exist', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {vault_path: '~/Vault1'}, enabled: true, id: 'obsidian'},
      ],
    }
    const result = scaffoldConfig(answers)
    expect(result.warnings).to.have.length(0)
  })

  it('includes enrichment edges when byterover + obsidian are enabled', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {vault_path: '~/Vault'}, enabled: true, id: 'obsidian'},
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.enrichment?.edges).to.have.length(1)
    expect(validated.enrichment?.edges[0]).to.deep.equal({from: 'byterover', to: 'obsidian'})
  })

  it('includes enrichment edges for byterover + local-markdown', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {
          config: {folders: [{follow_wikilinks: true, name: 'notes', path: '~/notes', read_only: true}]},
          enabled: true,
          id: 'local-markdown',
        },
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.enrichment?.edges).to.have.length(1)
    expect(validated.enrichment?.edges[0]).to.deep.equal({from: 'byterover', to: 'local-markdown'})
  })

  it('includes enrichment edges for byterover + gbrain', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {repo_path: '~/gbrain'}, enabled: true, id: 'gbrain'},
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.enrichment?.edges).to.have.length(1)
    expect(validated.enrichment?.edges[0]).to.deep.equal({from: 'byterover', to: 'gbrain'})
  })

  it('includes enrichment edges for all providers with byterover as master', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {vault_path: '~/Vault'}, enabled: true, id: 'obsidian'},
        {config: {repo_path: '~/gbrain'}, enabled: true, id: 'gbrain'},
      ],
    }
    const result = scaffoldConfig(answers)
    const parsed = load(result.yaml) as Record<string, unknown>
    const validated = SwarmConfigSchema.parse(parsed)
    expect(validated.enrichment?.edges).to.have.length(2)
    expect(validated.enrichment?.edges[0]).to.deep.equal({from: 'byterover', to: 'obsidian'})
    expect(validated.enrichment?.edges[1]).to.deep.equal({from: 'byterover', to: 'gbrain'})
  })

  it('omits enrichment section when user declines enrichment', () => {
    const answers: WizardAnswers = {
      enrichment: false,
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
        {config: {vault_path: '~/Vault'}, enabled: true, id: 'obsidian'},
      ],
    }
    const result = scaffoldConfig(answers)
    expect(result.yaml).to.not.include('enrichment')
  })

  it('omits enrichment section when only byterover is enabled', () => {
    const answers: WizardAnswers = {
      providers: [
        {config: {}, enabled: true, id: 'byterover'},
      ],
    }
    const result = scaffoldConfig(answers)
    expect(result.yaml).to.not.include('enrichment')
  })

  it('includes a comment header', () => {
    const answers: WizardAnswers = {
      providers: [{config: {}, enabled: true, id: 'byterover'}],
    }
    const result = scaffoldConfig(answers)
    expect(result.yaml).to.include('# Memory Swarm Configuration')
  })
})
