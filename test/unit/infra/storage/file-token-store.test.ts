import {expect} from 'chai'
import {existsSync, statSync} from 'node:fs'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AuthToken} from '../../../../src/core/domain/entities/auth-token'
import {FileTokenStore, FileTokenStoreDeps} from '../../../../src/infra/storage/file-token-store'

function createTestToken(): AuthToken {
  return new AuthToken({
    accessToken: 'test-access-token',
    expiresAt: new Date('2025-12-31T23:59:59.000Z'),
    refreshToken: 'test-refresh-token',
    sessionKey: 'test-session-key',
    tokenType: 'Bearer',
    userEmail: 'test@example.com',
    userId: 'test-user-id',
  })
}

describe('FileTokenStore', () => {
  let tempDir: string
  let store: FileTokenStore
  let deps: FileTokenStoreDeps

  beforeEach(async () => {
    // Create unique temp directory for each test
    tempDir = join(tmpdir(), `brv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})

    deps = {
      getCredentialsPath: () => join(tempDir, 'credentials'),
      getDataDir: () => tempDir,
      getKeyPath: () => join(tempDir, '.token-key'),
    }

    store = new FileTokenStore(deps)
  })

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await rm(tempDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('save', () => {
    it('should create key file on first save', async () => {
      const token = createTestToken()

      await store.save(token)

      const keyPath = deps.getKeyPath()
      expect(existsSync(keyPath)).to.be.true

      // Key should be 32 bytes
      const key = await readFile(keyPath)
      expect(key.length).to.equal(32)
    })

    it('should create credentials file on save', async () => {
      const token = createTestToken()

      await store.save(token)

      const credentialsPath = deps.getCredentialsPath()
      expect(existsSync(credentialsPath)).to.be.true
    })

    it('should set 0600 permissions on key file', async () => {
      const token = createTestToken()

      await store.save(token)

      const keyPath = deps.getKeyPath()
      const stats = statSync(keyPath)
      // Check permissions (0600 = owner read/write only)
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o777).to.equal(0o600)
    })

    it('should set 0600 permissions on credentials file', async () => {
      const token = createTestToken()

      await store.save(token)

      const credentialsPath = deps.getCredentialsPath()
      const stats = statSync(credentialsPath)
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o777).to.equal(0o600)
    })

    it('should rotate key on each save (key rotation)', async () => {
      const token1 = createTestToken()
      const json = token1.toJson()
      const token2 = new AuthToken({
        accessToken: 'updated-access-token',
        expiresAt: new Date(json.expiresAt),
        refreshToken: json.refreshToken,
        sessionKey: json.sessionKey,
        tokenType: json.tokenType,
        userEmail: json.userEmail,
        userId: json.userId,
      })

      await store.save(token1)
      const key1 = await readFile(deps.getKeyPath())

      await store.save(token2)
      const key2 = await readFile(deps.getKeyPath())

      // Key SHOULD change between saves (rotation)
      expect(key1.equals(key2)).to.be.false
    })

    it('should encrypt credentials (not plain text)', async () => {
      const token = createTestToken()

      await store.save(token)

      const credentialsPath = deps.getCredentialsPath()
      const encrypted = await readFile(credentialsPath, 'utf8')

      // Should NOT contain plain text token data
      expect(encrypted).to.not.include('test-access-token')
      expect(encrypted).to.not.include('test-refresh-token')

      // Should be in format: iv:authTag:data (base64)
      const parts = encrypted.split(':')
      expect(parts.length).to.equal(3)
    })
  })

  describe('load', () => {
    it('should return undefined if no key file exists', async () => {
      const result = await store.load()
      expect(result).to.be.undefined
    })

    it('should return undefined if no credentials file exists', async () => {
      // Create only key file
      await writeFile(deps.getKeyPath(), Buffer.alloc(32))

      const result = await store.load()
      expect(result).to.be.undefined
    })

    it('should load saved token correctly', async () => {
      const token = createTestToken()
      await store.save(token)

      const loaded = await store.load()

      expect(loaded).to.not.be.undefined
      expect(loaded?.accessToken).to.equal(token.accessToken)
      expect(loaded?.refreshToken).to.equal(token.refreshToken)
      expect(loaded?.sessionKey).to.equal(token.sessionKey)
      expect(loaded?.userId).to.equal(token.userId)
      expect(loaded?.userEmail).to.equal(token.userEmail)
    })

    it('should return undefined for corrupted credentials', async () => {
      const token = createTestToken()
      await store.save(token)

      // Corrupt the credentials file
      await writeFile(deps.getCredentialsPath(), 'invalid-data')

      const result = await store.load()
      expect(result).to.be.undefined
    })

    it('should return undefined for wrong key', async () => {
      const token = createTestToken()
      await store.save(token)

      // Replace key with different random bytes
      await writeFile(deps.getKeyPath(), Buffer.alloc(32, 1))

      const result = await store.load()
      expect(result).to.be.undefined
    })
  })

  describe('clear', () => {
    it('should delete credentials file', async () => {
      const token = createTestToken()
      await store.save(token)

      expect(existsSync(deps.getCredentialsPath())).to.be.true

      await store.clear()

      expect(existsSync(deps.getCredentialsPath())).to.be.false
    })

    it('should delete key file', async () => {
      const token = createTestToken()
      await store.save(token)

      expect(existsSync(deps.getKeyPath())).to.be.true

      await store.clear()

      // Key should be deleted
      expect(existsSync(deps.getKeyPath())).to.be.false
    })

    it('should not throw if credentials file does not exist', async () => {
      // Should not throw
      await store.clear()
    })
  })

  describe('encryption/decryption', () => {
    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const token = createTestToken()

      await store.save(token)
      const encrypted1 = await readFile(deps.getCredentialsPath(), 'utf8')

      // Clear and save again
      await store.clear()
      await store.save(token)
      const encrypted2 = await readFile(deps.getCredentialsPath(), 'utf8')

      // Ciphertext should be different due to random IV
      expect(encrypted1).to.not.equal(encrypted2)

      // But both should decrypt to same token
      const loaded = await store.load()
      expect(loaded?.accessToken).to.equal(token.accessToken)
    })
  })
})
