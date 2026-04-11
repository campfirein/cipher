import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {detectProviders} from '../../../../../src/agent/infra/swarm/wizard/provider-detector.js'

describe('detectProviders', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-detect-test-${Date.now()}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, {force: true, recursive: true})
    }
  })

  it('always includes byterover as detected', async () => {
    const result = await detectProviders({env: {}, searchPaths: []})
    const brv = result.find((p) => p.id === 'byterover')
    expect(brv).to.exist
    expect(brv!.detected).to.be.true
    expect(brv!.type).to.equal('local')
  })

  it('detects obsidian vault when .obsidian/ directory exists', async () => {
    const vaultPath = join(testDir, 'MyVault')
    mkdirSync(join(vaultPath, '.obsidian'), {recursive: true})
    writeFileSync(join(vaultPath, 'note1.md'), '# Note 1')
    writeFileSync(join(vaultPath, 'note2.md'), '# Note 2')

    const result = await detectProviders({env: {}, searchPaths: [testDir]})
    const obsidian = result.find((p) => p.id === 'obsidian')
    expect(obsidian).to.exist
    expect(obsidian!.detected).to.be.true
    expect(obsidian!.path).to.equal(vaultPath)
    expect(obsidian!.noteCount).to.equal(2)
  })

  it('does not detect obsidian when no .obsidian/ directory', async () => {
    mkdirSync(join(testDir, 'regular-folder'), {recursive: true})

    const result = await detectProviders({env: {}, searchPaths: [testDir]})
    const obsidian = result.find((p) => p.id === 'obsidian' && p.detected)
    expect(obsidian).to.not.exist
  })

  it('detects markdown folders with .md files', async () => {
    const mdFolder = join(testDir, 'notes')
    mkdirSync(mdFolder, {recursive: true})
    writeFileSync(join(mdFolder, 'note.md'), '# Note')

    const result = await detectProviders({
      env: {},
      markdownPaths: [mdFolder],
      searchPaths: [testDir],
    })
    const localMd = result.find((p) => p.id === 'local-markdown' && p.detected && p.path === mdFolder)
    expect(localMd).to.exist
    expect(localMd!.noteCount).to.be.at.least(1)
  })

  it('detects honcho when HONCHO_API_KEY is set', async () => {
    const result = await detectProviders({
      env: {HONCHO_API_KEY: 'test-key'},
      searchPaths: [],
    })
    const honcho = result.find((p) => p.id === 'honcho')
    expect(honcho).to.exist
    expect(honcho!.detected).to.be.true
    expect(honcho!.envVar).to.equal('HONCHO_API_KEY')
  })

  it('marks honcho as not detected when env var is missing', async () => {
    const result = await detectProviders({env: {}, searchPaths: []})
    const honcho = result.find((p) => p.id === 'honcho')
    expect(honcho).to.exist
    expect(honcho!.detected).to.be.false
  })

  it('detects hindsight when HINDSIGHT_DB_URL is set', async () => {
    const result = await detectProviders({
      env: {HINDSIGHT_DB_URL: 'postgres://localhost/hindsight'},
      searchPaths: [],
    })
    const hindsight = result.find((p) => p.id === 'hindsight')
    expect(hindsight!.detected).to.be.true
  })

  it('includes gbrain as not detected by default', async () => {
    const result = await detectProviders({env: {}, searchPaths: []})
    const gbrain = result.find((p) => p.id === 'gbrain')
    expect(gbrain).to.exist
    expect(gbrain!.detected).to.be.false
  })

  it('always includes an undetected local-markdown entry for manual add', async () => {
    const result = await detectProviders({env: {}, markdownPaths: [], searchPaths: []})
    const localMd = result.find((p) => p.id === 'local-markdown' && !p.detected)
    expect(localMd).to.exist
    expect(localMd!.type).to.equal('local')
  })

  it('includes undetected local-markdown even when some folders were detected', async () => {
    const mdFolder = join(testDir, 'notes')
    mkdirSync(mdFolder, {recursive: true})
    writeFileSync(join(mdFolder, 'note.md'), '# Note')

    const result = await detectProviders({env: {}, markdownPaths: [mdFolder], searchPaths: []})
    const detectedMd = result.filter((p) => p.id === 'local-markdown' && p.detected)
    const undetectedMd = result.find((p) => p.id === 'local-markdown' && !p.detected)
    expect(detectedMd).to.have.length(1)
    expect(undetectedMd).to.exist
  })

  it('uses real default search paths when no options provided', async () => {
    const {getDefaultSearchPaths} = await import('../../../../../src/agent/infra/swarm/wizard/provider-detector.js')
    const defaults = getDefaultSearchPaths()
    // searchPaths always includes home dir which exists
    expect(defaults.searchPaths).to.be.an('array').with.length.greaterThan(0)
    // markdownPaths may be empty if none of the well-known folders exist
    expect(defaults.markdownPaths).to.be.an('array')
  })

  it('detects multiple obsidian vaults as separate entries', async () => {
    const vault1 = join(testDir, 'Vault1')
    const vault2 = join(testDir, 'Vault2')
    mkdirSync(join(vault1, '.obsidian'), {recursive: true})
    mkdirSync(join(vault2, '.obsidian'), {recursive: true})
    writeFileSync(join(vault1, 'a.md'), '# A')
    writeFileSync(join(vault2, 'b.md'), '# B')

    const result = await detectProviders({env: {}, searchPaths: [testDir]})
    const obsidianEntries = result.filter((p) => p.id === 'obsidian' && p.detected)
    expect(obsidianEntries).to.have.length(2)
    const paths = obsidianEntries.map((e) => e.path)
    expect(paths).to.include(vault1)
    expect(paths).to.include(vault2)
  })
})
