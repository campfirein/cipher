import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FileBillingConfigStore} from '../../../../src/server/infra/storage/file-billing-config-store.js'

describe('FileBillingConfigStore', () => {
  let configDir: string
  let configPath: string
  let store: FileBillingConfigStore

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'brv-billing-config-'))
    configPath = join(configDir, 'billing.json')
    store = new FileBillingConfigStore({
      getConfigDir: () => configDir,
      getConfigPath: () => configPath,
    })
  })

  afterEach(async () => {
    await rm(configDir, {force: true, recursive: true})
  })

  describe('getPinnedOrganizationId', () => {
    it('returns undefined when the config file does not exist', async () => {
      expect(await store.getPinnedOrganizationId()).to.equal(undefined)
    })

    it('returns undefined when the file is corrupted', async () => {
      const {writeFile} = await import('node:fs/promises')
      await writeFile(configPath, '{not valid json', 'utf8')
      expect(await store.getPinnedOrganizationId()).to.equal(undefined)
    })

    it('returns the previously-written organization id', async () => {
      await store.setPinnedOrganizationId('org-123')
      expect(await store.getPinnedOrganizationId()).to.equal('org-123')
    })

    it('returns undefined after the pin is cleared', async () => {
      await store.setPinnedOrganizationId('org-123')
      await store.setPinnedOrganizationId(undefined)
      expect(await store.getPinnedOrganizationId()).to.equal(undefined)
    })
  })

  describe('setPinnedOrganizationId', () => {
    it('creates the config directory if it does not exist', async () => {
      const nestedDir = join(configDir, 'nested')
      const nestedPath = join(nestedDir, 'billing.json')
      const nestedStore = new FileBillingConfigStore({
        getConfigDir: () => nestedDir,
        getConfigPath: () => nestedPath,
      })

      await nestedStore.setPinnedOrganizationId('org-1')

      expect(existsSync(nestedPath)).to.equal(true)
    })

    it('persists pretty-printed JSON', async () => {
      await store.setPinnedOrganizationId('org-456')
      const content = await readFile(configPath, 'utf8')
      expect(content).to.contain('\n')
      expect(JSON.parse(content)).to.deep.equal({pinnedOrganizationId: 'org-456'})
    })

    it('omits the field when cleared so the file stays minimal', async () => {
      await store.setPinnedOrganizationId('org-999')
      await store.setPinnedOrganizationId(undefined)
      const content = await readFile(configPath, 'utf8')
      expect(JSON.parse(content)).to.deep.equal({})
    })
  })
})
