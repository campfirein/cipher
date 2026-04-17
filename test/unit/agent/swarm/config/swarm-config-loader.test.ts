import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {join} from 'node:path'

import {loadSwarmConfig} from '../../../../../src/agent/infra/swarm/config/swarm-config-loader.js'

describe('loadSwarmConfig', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-config-test-${Date.now()}`)
    mkdirSync(join(testDir, '.brv', 'swarm'), {recursive: true})
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, {force: true, recursive: true})
    }
  })

  it('loads and parses a valid YAML config', async () => {
    const yaml = `
providers:
  byterover:
    enabled: true
  obsidian:
    enabled: true
    vault_path: /absolute/path/MyVault
`
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), yaml)
    const result = await loadSwarmConfig(testDir)
    expect(result.providers.byterover.enabled).to.be.true
    expect(result.providers.obsidian?.vaultPath).to.equal('/absolute/path/MyVault')
  })

  it('expands ~ to home directory in string values', async () => {
    const yaml = `
providers:
  byterover:
    enabled: true
  obsidian:
    enabled: true
    vault_path: ~/Documents/MyVault
`
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), yaml)
    const result = await loadSwarmConfig(testDir)
    const expected = join(homedir(), 'Documents', 'MyVault')
    expect(result.providers.obsidian?.vaultPath).to.equal(expected)
    expect(result.providers.obsidian?.vaultPath).to.not.include('~')
  })

  it(String.raw`expands ~\ (Windows-style) to home directory`, async () => {
    const yaml = `
providers:
  byterover:
    enabled: true
  obsidian:
    enabled: true
    vault_path: "~\\\\Documents\\\\Vault"
`
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), yaml)
    const result = await loadSwarmConfig(testDir)
    expect(result.providers.obsidian?.vaultPath).to.not.include('~')
    expect(result.providers.obsidian?.vaultPath).to.include('Documents')
  })

  it('expands ~ in local_markdown folder paths', async () => {
    const yaml = `
providers:
  byterover:
    enabled: true
  local_markdown:
    enabled: true
    folders:
      - path: ~/notes
        name: notes
        follow_wikilinks: true
        read_only: true
`
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), yaml)
    const result = await loadSwarmConfig(testDir)
    expect(result.providers.localMarkdown?.folders[0].path).to.equal(join(homedir(), 'notes'))
  })

  it('resolves environment variables in string values', async () => {
    const yaml = `
providers:
  byterover:
    enabled: true
  honcho:
    enabled: true
    api_key: \${TEST_HONCHO_KEY}
    app_id: my-app
`
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), yaml)
    const result = await loadSwarmConfig(testDir, {TEST_HONCHO_KEY: 'resolved-key'})
    expect(result.providers.honcho?.apiKey).to.equal('resolved-key')
  })

  it('throws when config file does not exist', async () => {
    try {
      await loadSwarmConfig(testDir)
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).to.include('config.yaml')
    }
  })

  it('throws a friendly message when YAML is invalid', async () => {
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), '{{invalid yaml')
    try {
      await loadSwarmConfig(testDir)
      expect.fail('Should have thrown')
    } catch (error) {
      const msg = (error as Error).message
      expect(msg).to.include('Failed to parse')
      expect(msg).to.include('config.yaml')
    }
  })

  it('throws a friendly message when config fails schema validation', async () => {
    writeFileSync(join(testDir, '.brv', 'swarm', 'config.yaml'), 'routing:\n  default_strategy: invalid\n')
    try {
      await loadSwarmConfig(testDir)
      expect.fail('Should have thrown')
    } catch (error) {
      const msg = (error as Error).message
      expect(msg).to.include('Invalid swarm config')
      // Should include the specific field that failed
      expect(msg).to.include('defaultStrategy')
    }
  })
})
