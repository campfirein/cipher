import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  isHarnessCommandType,
  openHarnessStoreForProject,
  readHarnessFeatureConfig,
} from '../../../../src/oclif/lib/harness-cli.js'

describe('harness-cli helpers', () => {
  describe('isHarnessCommandType', () => {
    it('accepts the three canonical values', () => {
      expect(isHarnessCommandType('chat')).to.equal(true)
      expect(isHarnessCommandType('curate')).to.equal(true)
      expect(isHarnessCommandType('query')).to.equal(true)
    })

    it('rejects anything else', () => {
      expect(isHarnessCommandType('CURATE')).to.equal(false)
      expect(isHarnessCommandType('')).to.equal(false)
      expect(isHarnessCommandType('bogus')).to.equal(false)
    })
  })

  describe('openHarnessStoreForProject', () => {
    it('returns undefined when the derived storage directory does not exist', async () => {
      // tmpdir path is registered — but no XDG storage directory has
      // ever been written for it, so the resolver's `existsSync` short-
      // circuits to undefined. This is the only externally-observable
      // behaviour of the "unused project" path; the happy path is
      // exercised implicitly via daemon integration (Phase 7.7 test).
      const tempRoot = await mkdtemp(join(tmpdir(), 'brv-harness-open-'))
      try {
        const opened = await openHarnessStoreForProject(tempRoot)
        expect(opened).to.equal(undefined)
      } finally {
        await rm(tempRoot, {force: true, recursive: true})
      }
    })
  })

  describe('readHarnessFeatureConfig', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'brv-harness-cli-test-'))
  })

  afterEach(async () => {
    await rm(tempRoot, {force: true, recursive: true})
  })

  it('1. returns defaults (disabled, autoLearn=true) when .brv/ absent', async () => {
    const cfg = await readHarnessFeatureConfig(tempRoot)
    expect(cfg).to.deep.equal({autoLearn: true, enabled: false})
  })

  it('2. returns defaults when config.json is malformed JSON', async () => {
    await mkdir(join(tempRoot, '.brv'), {recursive: true})
    await writeFile(join(tempRoot, '.brv', 'config.json'), '{not valid')
    const cfg = await readHarnessFeatureConfig(tempRoot)
    expect(cfg).to.deep.equal({autoLearn: true, enabled: false})
  })

  it('3. returns defaults when config.json has no harness key', async () => {
    await mkdir(join(tempRoot, '.brv'), {recursive: true})
    await writeFile(
      join(tempRoot, '.brv', 'config.json'),
      JSON.stringify({createdAt: '2026-04-22'}),
    )
    const cfg = await readHarnessFeatureConfig(tempRoot)
    expect(cfg).to.deep.equal({autoLearn: true, enabled: false})
  })

  it('4. reads harness.enabled=true from config.json', async () => {
    await mkdir(join(tempRoot, '.brv'), {recursive: true})
    await writeFile(
      join(tempRoot, '.brv', 'config.json'),
      JSON.stringify({createdAt: '2026-04-22', harness: {autoLearn: false, enabled: true}}),
    )
    const cfg = await readHarnessFeatureConfig(tempRoot)
    expect(cfg).to.deep.equal({autoLearn: false, enabled: true})
  })

  it('5. non-boolean fields in harness block fall back to the default', async () => {
    await mkdir(join(tempRoot, '.brv'), {recursive: true})
    await writeFile(
      join(tempRoot, '.brv', 'config.json'),
      JSON.stringify({createdAt: '2026-04-22', harness: {enabled: 'yes'}}),
    )
    const cfg = await readHarnessFeatureConfig(tempRoot)
    expect(cfg.enabled).to.equal(false)
    expect(cfg.autoLearn).to.equal(true)
  })
  })
})
