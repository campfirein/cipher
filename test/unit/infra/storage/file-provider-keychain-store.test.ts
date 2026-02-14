import {expect} from 'chai'
import {existsSync, statSync} from 'node:fs'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  FileProviderKeychainStore,
  FileProviderKeychainStoreDeps,
} from '../../../../src/server/infra/storage/file-provider-keychain-store'

describe('FileProviderKeychainStore', () => {
  let tempDir: string
  let store: FileProviderKeychainStore
  let deps: FileProviderKeychainStoreDeps

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})

    deps = {
      getCredentialsPath: () => join(tempDir, 'provider-credentials'),
      getDataDir: () => tempDir,
      getKeyPath: () => join(tempDir, '.provider-keys'),
    }

    store = new FileProviderKeychainStore(deps)
  })

  afterEach(async () => {
    try {
      await rm(tempDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('setApiKey', () => {
    it('should create key file on first save', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      const keyPath = deps.getKeyPath()
      expect(existsSync(keyPath)).to.be.true

      const key = await readFile(keyPath)
      expect(key.length).to.equal(32)
    })

    it('should create credentials file on save', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      const credentialsPath = deps.getCredentialsPath()
      expect(existsSync(credentialsPath)).to.be.true
    })

    it('should set 0600 permissions on key file', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      const keyPath = deps.getKeyPath()
      const stats = statSync(keyPath)
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o777).to.equal(0o600)
    })

    it('should set 0600 permissions on credentials file', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      const credentialsPath = deps.getCredentialsPath()
      const stats = statSync(credentialsPath)
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o777).to.equal(0o600)
    })

    it('should rotate key on each save (key rotation)', async () => {
      await store.setApiKey('openai', 'sk-test-key-1')
      const key1 = await readFile(deps.getKeyPath())

      await store.setApiKey('anthropic', 'sk-ant-test-key')
      const key2 = await readFile(deps.getKeyPath())

      expect(key1.equals(key2)).to.be.false
    })

    it('should encrypt credentials (not plain text)', async () => {
      await store.setApiKey('openai', 'sk-test-secret-key')

      const credentialsPath = deps.getCredentialsPath()
      const encrypted = await readFile(credentialsPath, 'utf8')

      expect(encrypted).to.not.include('sk-test-secret-key')
      expect(encrypted).to.not.include('openai')

      const parts = encrypted.split(':')
      expect(parts.length).to.equal(3)
    })
  })

  describe('getApiKey', () => {
    it('should return undefined if no key file exists', async () => {
      const result = await store.getApiKey('openai')
      expect(result).to.be.undefined
    })

    it('should return undefined if no credentials file exists', async () => {
      await writeFile(deps.getKeyPath(), Buffer.alloc(32))

      const result = await store.getApiKey('openai')
      expect(result).to.be.undefined
    })

    it('should return saved API key correctly', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      const result = await store.getApiKey('openai')
      expect(result).to.equal('sk-test-key')
    })

    it('should return undefined for non-existent provider', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      const result = await store.getApiKey('anthropic')
      expect(result).to.be.undefined
    })

    it('should return undefined for corrupted credentials', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      await writeFile(deps.getCredentialsPath(), 'invalid-data')

      const result = await store.getApiKey('openai')
      expect(result).to.be.undefined
    })

    it('should return undefined for wrong key', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      await writeFile(deps.getKeyPath(), Buffer.alloc(32, 1))

      const result = await store.getApiKey('openai')
      expect(result).to.be.undefined
    })
  })

  describe('deleteApiKey', () => {
    it('should delete a specific provider key', async () => {
      await store.setApiKey('openai', 'sk-openai-key')
      await store.setApiKey('anthropic', 'sk-ant-key')

      await store.deleteApiKey('openai')

      expect(await store.getApiKey('openai')).to.be.undefined
      expect(await store.getApiKey('anthropic')).to.equal('sk-ant-key')
    })

    it('should not throw if provider key does not exist', async () => {
      await store.deleteApiKey('nonexistent')
    })
  })

  describe('hasApiKey', () => {
    it('should return true for existing provider', async () => {
      await store.setApiKey('openai', 'sk-test-key')

      expect(await store.hasApiKey('openai')).to.be.true
    })

    it('should return false for non-existent provider', async () => {
      expect(await store.hasApiKey('openai')).to.be.false
    })
  })

  describe('multi-provider storage', () => {
    it('should store and retrieve multiple provider keys', async () => {
      await store.setApiKey('openai', 'sk-openai')
      await store.setApiKey('anthropic', 'sk-ant')
      await store.setApiKey('google', 'goog-key')

      expect(await store.getApiKey('openai')).to.equal('sk-openai')
      expect(await store.getApiKey('anthropic')).to.equal('sk-ant')
      expect(await store.getApiKey('google')).to.equal('goog-key')
    })

    it('should preserve other keys when updating one', async () => {
      await store.setApiKey('openai', 'sk-openai-v1')
      await store.setApiKey('anthropic', 'sk-ant')

      await store.setApiKey('openai', 'sk-openai-v2')

      expect(await store.getApiKey('openai')).to.equal('sk-openai-v2')
      expect(await store.getApiKey('anthropic')).to.equal('sk-ant')
    })

    it('should produce different ciphertext for same content (random IV)', async () => {
      await store.setApiKey('openai', 'sk-test-key')
      const encrypted1 = await readFile(deps.getCredentialsPath(), 'utf8')

      // Re-save same key to trigger re-encryption
      await store.setApiKey('openai', 'sk-test-key')
      const encrypted2 = await readFile(deps.getCredentialsPath(), 'utf8')

      expect(encrypted1).to.not.equal(encrypted2)

      // But should still decrypt correctly
      expect(await store.getApiKey('openai')).to.equal('sk-test-key')
    })
  })
})
