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
