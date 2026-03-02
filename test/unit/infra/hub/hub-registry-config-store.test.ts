import {expect} from 'chai'
import {mkdtempSync, rmSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {HubRegistryConfigStore} from '../../../../src/server/infra/hub/hub-registry-config-store.js'

describe('HubRegistryConfigStore', () => {
  let tempDir: string
  let filePath: string
  let store: HubRegistryConfigStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hub-registry-config-'))
    filePath = join(tempDir, 'hub-registries.json')
    store = new HubRegistryConfigStore({
      getDataDir: () => tempDir,
      getFilePath: () => filePath,
    })
  })

  afterEach(() => {
    rmSync(tempDir, {force: true, recursive: true})
  })

  describe('getRegistries', () => {
    it('should return empty array when no file exists', async () => {
      const registries = await store.getRegistries()
      expect(registries).to.deep.equal([])
    })

    it('should return stored registries', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})

      const registries = await store.getRegistries()

      expect(registries).to.have.lengthOf(1)
      expect(registries[0].name).to.equal('myco')
      expect(registries[0].url).to.equal('https://example.com/registry.json')
    })
  })

  describe('addRegistry', () => {
    it('should persist registry to file', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})

      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)

      expect(parsed).to.be.an('array').with.lengthOf(1)
      expect(parsed[0].name).to.equal('myco')
    })

    it('should add multiple registries', async () => {
      await store.addRegistry({name: 'first', url: 'https://first.com/registry.json'})
      await store.addRegistry({name: 'second', url: 'https://second.com/registry.json'})

      const registries = await store.getRegistries()

      expect(registries).to.have.lengthOf(2)
      expect(registries[0].name).to.equal('first')
      expect(registries[1].name).to.equal('second')
    })

    it('should persist authScheme when provided', async () => {
      await store.addRegistry({authScheme: 'token', name: 'github', url: 'https://github.com/registry.json'})

      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)

      expect(parsed[0].authScheme).to.equal('token')
    })

    it('should persist headerName for custom-header scheme', async () => {
      await store.addRegistry({
        authScheme: 'custom-header',
        headerName: 'PRIVATE-TOKEN',
        name: 'gitlab',
        url: 'https://gitlab.com/registry.json',
      })

      const registries = await store.getRegistries()

      expect(registries[0].authScheme).to.equal('custom-header')
      expect(registries[0].headerName).to.equal('PRIVATE-TOKEN')
    })

    it('should not persist authScheme when not provided', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})

      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)

      expect(parsed[0].authScheme).to.be.undefined
    })

    it('should load entries without authScheme (backward compatibility)', async () => {
      await writeFile(filePath, JSON.stringify([{name: 'old-reg', url: 'https://old.com/registry.json'}]))

      store.clearCache()
      const registries = await store.getRegistries()

      expect(registries).to.have.lengthOf(1)
      expect(registries[0].name).to.equal('old-reg')
      expect(registries[0].authScheme).to.be.undefined
    })

    it('should reject entries with invalid authScheme from file', async () => {
      await writeFile(filePath, JSON.stringify([
        {authScheme: 'invalid-scheme', name: 'bad', url: 'https://example.com/registry.json'},
        {name: 'good', url: 'https://example.com/registry.json'},
      ]))

      store.clearCache()
      const registries = await store.getRegistries()

      expect(registries).to.have.lengthOf(1)
      expect(registries[0].name).to.equal('good')
    })

    it('should throw if registry with same name already exists', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})

      try {
        await store.addRegistry({name: 'myco', url: 'https://other.com/registry.json'})
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include("'myco' already exists")
      }
    })
  })

  describe('removeRegistry', () => {
    it('should remove a registry by name', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})
      await store.removeRegistry('myco')

      const registries = await store.getRegistries()
      expect(registries).to.have.lengthOf(0)
    })

    it('should be a no-op if registry does not exist', async () => {
      await store.removeRegistry('nonexistent')

      const registries = await store.getRegistries()
      expect(registries).to.have.lengthOf(0)
    })

    it('should only remove the specified registry', async () => {
      await store.addRegistry({name: 'first', url: 'https://first.com/registry.json'})
      await store.addRegistry({name: 'second', url: 'https://second.com/registry.json'})
      await store.removeRegistry('first')

      const registries = await store.getRegistries()
      expect(registries).to.have.lengthOf(1)
      expect(registries[0].name).to.equal('second')
    })
  })

  describe('cache', () => {
    it('should serve from cache after first load', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})

      // First call loads from file
      const first = await store.getRegistries()
      // Second call should use cache (same result)
      const second = await store.getRegistries()

      expect(first).to.deep.equal(second)
    })

    it('should clear cache when clearCache is called', async () => {
      await store.addRegistry({name: 'myco', url: 'https://example.com/registry.json'})
      await store.getRegistries() // populate cache

      store.clearCache()

      // Should still work (re-reads from file)
      const registries = await store.getRegistries()
      expect(registries).to.have.lengthOf(1)
    })
  })
})
