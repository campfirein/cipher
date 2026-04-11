/* eslint-disable camelcase -- YAML-shaped config fixtures use snake_case keys */
/* eslint-disable no-template-curly-in-string -- fixtures use literal ${VAR} placeholders */
import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {validateSwarmConfig as parseConfig} from '../../../../../src/agent/infra/swarm/config/swarm-config-schema.js'
import {validateSwarmProviders} from '../../../../../src/agent/infra/swarm/validation/config-validator.js'

describe('validateSwarmProviders', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-validate-test-${Date.now()}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, {force: true, recursive: true})
    }
  })

  it('returns no errors for byterover-only config', async () => {
    const config = parseConfig({providers: {byterover: {enabled: true}}})
    const result = await validateSwarmProviders(config)
    expect(result.errors).to.have.length(0)
    expect(result.warnings).to.have.length(0)
  })

  it('returns error when obsidian vault path does not exist', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        obsidian: {enabled: true, vault_path: '/nonexistent/vault/path'},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors).to.have.length(1)
    expect(result.errors[0].provider).to.equal('obsidian')
    expect(result.errors[0].message).to.include('not found')
  })

  it('returns error when local_markdown folder does not exist', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        local_markdown: {
          enabled: true,
          folders: [{follow_wikilinks: true, name: 'test', path: '/nonexistent/folder', read_only: true}],
        },
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'local-markdown')).to.be.true
  })

  it('passes when obsidian vault path exists', async () => {
    const vaultPath = join(testDir, 'vault')
    mkdirSync(join(vaultPath, '.obsidian'), {recursive: true})
    writeFileSync(join(vaultPath, 'note.md'), '# Test')

    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        obsidian: {enabled: true, vault_path: vaultPath},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.filter((e) => e.provider === 'obsidian')).to.have.length(0)
  })

  it('returns warning when obsidian path exists but has no .obsidian directory', async () => {
    const vaultPath = join(testDir, 'not-obsidian')
    mkdirSync(vaultPath, {recursive: true})
    writeFileSync(join(vaultPath, 'note.md'), '# Test')

    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        obsidian: {enabled: true, vault_path: vaultPath},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.warnings.some((w) => w.provider === 'obsidian')).to.be.true
  })

  it('returns error when honcho api_key looks unresolved', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        honcho: {api_key: '${HONCHO_API_KEY}', app_id: 'test', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'honcho')).to.be.true
    expect(result.errors[0].suggestion).to.include('HONCHO_API_KEY')
  })

  it('returns error when hindsight connection_string looks unresolved', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        hindsight: {connection_string: '${HINDSIGHT_DB_URL}', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'hindsight')).to.be.true
  })

  it('returns error when honcho app_id is empty', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        honcho: {api_key: 'valid-key', app_id: '', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    const appIdError = result.errors.find((e) => e.provider === 'honcho' && e.field === 'app_id')
    expect(appIdError).to.exist
    expect(appIdError!.message).to.include('empty')
  })

  it('returns error when honcho app_id is whitespace only', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        honcho: {api_key: 'valid-key', app_id: '   ', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'honcho' && e.field === 'app_id')).to.be.true
  })

  it('accumulates multiple errors from different providers', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        honcho: {api_key: '${HONCHO_API_KEY}', app_id: 'test', enabled: true},
        obsidian: {enabled: true, vault_path: '/nonexistent'},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.length).to.be.at.least(2)
  })

  it('returns error when honcho api_key is empty', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        honcho: {api_key: '', app_id: 'test', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'honcho')).to.be.true
    expect(result.errors[0].message).to.include('empty')
  })

  it('returns error when honcho api_key is whitespace only', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        honcho: {api_key: '   ', app_id: 'test', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'honcho')).to.be.true
  })

  it('returns error when hindsight connection_string is empty', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        hindsight: {connection_string: '', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'hindsight')).to.be.true
  })

  it('returns error when hindsight connection_string is not a valid postgres URL', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        hindsight: {connection_string: 'not-a-url', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.errors.some((e) => e.provider === 'hindsight')).to.be.true
  })

  describe('enrichment edge validation', () => {
    it('passes valid enrichment edges', async () => {
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'obsidian'}]},
        providers: {
          byterover: {enabled: true},
          obsidian: {enabled: true, vault_path: testDir},
        },
      })
      const result = await validateSwarmProviders(config)
      const enrichmentErrors = result.errors.filter((e) => e.provider === 'enrichment')
      expect(enrichmentErrors).to.have.length(0)
    })

    it('returns error for self-edge', async () => {
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'byterover'}]},
        providers: {byterover: {enabled: true}},
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('self-edge'))).to.be.true
    })

    it('returns error for simple cycle (A→B→A)', async () => {
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'obsidian'}, {from: 'obsidian', to: 'byterover'}]},
        providers: {
          byterover: {enabled: true},
          obsidian: {enabled: true, vault_path: testDir},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('cycle'))).to.be.true
    })

    it('returns error for longer cycle (A→B→C→A)', async () => {
      mkdirSync(join(testDir, 'notes'), {recursive: true})
      const config = parseConfig({
        enrichment: {edges: [
          {from: 'byterover', to: 'obsidian'},
          {from: 'obsidian', to: 'local-markdown'},
          {from: 'local-markdown', to: 'byterover'},
        ]},
        providers: {
          byterover: {enabled: true},
          local_markdown: {enabled: true, folders: [{name: 'notes', path: join(testDir, 'notes')}]},
          obsidian: {enabled: true, vault_path: testDir},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('cycle'))).to.be.true
    })

    it('returns warning for edge referencing disabled provider', async () => {
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'obsidian'}]},
        providers: {
          byterover: {enabled: true},
          obsidian: {enabled: false, vault_path: testDir},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.warnings.some((w) => w.message.includes('disabled') || w.message.includes('obsidian'))).to.be.true
    })

    it('returns error for edge referencing nonexistent provider', async () => {
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'honcho'}]},
        providers: {byterover: {enabled: true}},
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('honcho'))).to.be.true
    })

    it('returns error for edge referencing nonexistent local-markdown folder', async () => {
      mkdirSync(join(testDir, 'notes'), {recursive: true})
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'local-markdown:missing'}]},
        providers: {
          byterover: {enabled: true},
          local_markdown: {enabled: true, folders: [{name: 'notes', path: join(testDir, 'notes')}]},
        },
      })
      const result = await validateSwarmProviders(config)
      // Should be an error, not a warning — "missing" folder doesn't exist
      expect(result.errors.some((e) => e.message.includes('local-markdown:missing'))).to.be.true
    })

    it('passes empty edges array', async () => {
      const config = parseConfig({
        enrichment: {edges: []},
        providers: {byterover: {enabled: true}},
      })
      const result = await validateSwarmProviders(config)
      const enrichmentErrors = result.errors.filter((e) => e.provider === 'enrichment')
      expect(enrichmentErrors).to.have.length(0)
    })

    it('detects cycle introduced by generic expansion', async () => {
      mkdirSync(join(testDir, 'notes'), {recursive: true})
      // local-markdown expands to local-markdown:notes
      // So: local-markdown→obsidian becomes local-markdown:notes→obsidian
      // Plus: obsidian→local-markdown:notes
      // = cycle: local-markdown:notes → obsidian → local-markdown:notes
      const config = parseConfig({
        enrichment: {edges: [
          {from: 'local-markdown', to: 'obsidian'},
          {from: 'obsidian', to: 'local-markdown:notes'},
        ]},
        providers: {
          byterover: {enabled: true},
          local_markdown: {enabled: true, folders: [{name: 'notes', path: join(testDir, 'notes')}]},
          obsidian: {enabled: true, vault_path: testDir},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('cycle'))).to.be.true
    })

    it('detects self-edge introduced by generic expansion', async () => {
      mkdirSync(join(testDir, 'notes'), {recursive: true})
      // local-markdown expands to local-markdown:notes on both sides → self-edge
      const config = parseConfig({
        enrichment: {edges: [{from: 'local-markdown', to: 'local-markdown:notes'}]},
        providers: {
          byterover: {enabled: true},
          local_markdown: {enabled: true, folders: [{name: 'notes', path: join(testDir, 'notes')}]},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('self-edge'))).to.be.true
    })

    it('disabled-provider edges do not produce cycle errors', async () => {
      // obsidian is disabled, so byterover→obsidian + obsidian→byterover
      // should only produce disabled warnings, NOT a cycle error
      const config = parseConfig({
        enrichment: {edges: [
          {from: 'byterover', to: 'obsidian'},
          {from: 'obsidian', to: 'byterover'},
        ]},
        providers: {
          byterover: {enabled: true},
          obsidian: {enabled: false, vault_path: testDir},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.some((e) => e.message.includes('cycle'))).to.be.false
      expect(result.warnings.some((w) => w.message.includes('disabled'))).to.be.true
    })

    it('enrichment errors do not trigger cloud cascade note', async () => {
      // An enrichment self-edge should NOT produce "cloud provider(s) failed"
      mkdirSync(join(testDir, 'notes'), {recursive: true})
      const config = parseConfig({
        enrichment: {edges: [{from: 'local-markdown', to: 'local-markdown:notes'}]},
        providers: {
          byterover: {enabled: true},
          local_markdown: {enabled: true, folders: [{name: 'notes', path: join(testDir, 'notes')}]},
        },
      })
      const result = await validateSwarmProviders(config)
      expect(result.errors.length).to.be.greaterThan(0)
      expect(result.cascadeNote).to.be.undefined
    })

    it('prefix-matches local-markdown edges', async () => {
      mkdirSync(join(testDir, 'notes'), {recursive: true})
      const config = parseConfig({
        enrichment: {edges: [{from: 'byterover', to: 'local-markdown'}]},
        providers: {
          byterover: {enabled: true},
          local_markdown: {enabled: true, folders: [{name: 'notes', path: join(testDir, 'notes')}]},
        },
      })
      const result = await validateSwarmProviders(config)
      const enrichmentErrors = result.errors.filter((e) => e.provider === 'enrichment')
      expect(enrichmentErrors).to.have.length(0)
    })
  })

  it('adds cascade note when cloud providers fail', async () => {
    const config = parseConfig({
      providers: {
        byterover: {enabled: true},
        hindsight: {connection_string: '${HINDSIGHT_DB_URL}', enabled: true},
        honcho: {api_key: '${HONCHO_API_KEY}', app_id: 'test', enabled: true},
      },
    })
    const result = await validateSwarmProviders(config)
    expect(result.cascadeNote).to.be.a('string')
    expect(result.cascadeNote).to.include('cloud')
  })
})
