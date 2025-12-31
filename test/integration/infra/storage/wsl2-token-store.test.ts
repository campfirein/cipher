/**
 * WSL2 Token Store Integration Test
 *
 * This test verifies that token storage works correctly on WSL2 environments
 * where keychain is not available.
 *
 * HOW TO RUN:
 * 1. Open WSL2 terminal
 * 2. cd to project directory
 * 3. Run: npx mocha --forbid-only "test/integration/infra/storage/wsl2-token-store.test.ts"
 *
 * EXPECTED BEHAVIOR:
 * - On WSL2: Uses FileTokenStore (file-based encryption)
 * - On macOS/Linux with keychain: Uses keytar
 */

import {expect} from 'chai'
import {existsSync, readFileSync} from 'node:fs'
import {rm} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {AuthToken} from '../../../../src/core/domain/entities/auth-token'
import {KeychainTokenStore} from '../../../../src/infra/storage/keychain-token-store'
import {isWSL2} from '../../../../src/utils/environment-detector'

function createTestToken(): AuthToken {
  return new AuthToken({
    accessToken: `test-access-${Date.now()}`,
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: `test-refresh-${Date.now()}`,
    sessionKey: `test-session-${Date.now()}`,
    tokenType: 'Bearer',
    userEmail: 'wsl2-test@example.com',
    userId: 'wsl2-test-user',
  })
}

const dataDir = join(homedir(), '.local', 'share', 'brv')
const keyPath = join(dataDir, '.token-key')
const credentialsPath = join(dataDir, 'credentials')

describe('KeychainTokenStore WSL2 Integration', function () {
  // Increase timeout for keychain operations
  this.timeout(10_000)

  let store: KeychainTokenStore

  beforeEach(() => {
    store = new KeychainTokenStore()
  })

  afterEach(async () => {
    // Clean up token
    await store.clear()

    // On WSL2, also clean up file-based storage for clean tests
    if (isWSL2()) {
      try {
        await rm(credentialsPath, {force: true})
      } catch {
        // Ignore
      }
    }
  })

  describe('environment detection', () => {
    it('should detect WSL2 environment correctly', () => {
      const detected = isWSL2()
      expect(typeof detected).to.equal('boolean')
    })
  })

  describe('save and load', () => {
    it('should save and load token correctly', async () => {
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

    it('should persist token across new store instances', async () => {
      const token = createTestToken()

      await store.save(token)

      // Create new store instance
      const newStore = new KeychainTokenStore()
      const loaded = await newStore.load()

      expect(loaded).to.not.be.undefined
      expect(loaded?.accessToken).to.equal(token.accessToken)
    })
  })

  describe('clear', () => {
    it('should clear token', async () => {
      const token = createTestToken()

      await store.save(token)
      expect(await store.load()).to.not.be.undefined

      await store.clear()
      expect(await store.load()).to.be.undefined
    })
  })

  // WSL2-specific tests
  if (isWSL2()) {
    describe('WSL2-specific: file-based storage', () => {
      it('should create encrypted credentials file', async () => {
        const token = createTestToken()

        await store.save(token)

        expect(existsSync(credentialsPath)).to.be.true

        // Read and verify it's encrypted
        const encrypted = readFileSync(credentialsPath, 'utf8')
        expect(encrypted).to.not.include(token.accessToken)
        expect(encrypted.split(':').length).to.equal(3) // iv:authTag:data format
      })

      it('should create encryption key file', async () => {
        const token = createTestToken()

        await store.save(token)

        expect(existsSync(keyPath)).to.be.true

        // Key should be 32 bytes
        const key = readFileSync(keyPath)
        expect(key.length).to.equal(32)
      })

      it('should reuse same key for subsequent saves', async () => {
        const token1 = createTestToken()
        await store.save(token1)
        const key1 = readFileSync(keyPath)

        const token2 = createTestToken()
        await store.save(token2)
        const key2 = readFileSync(keyPath)

        expect(key1.equals(key2)).to.be.true
      })
    })
  }
})
