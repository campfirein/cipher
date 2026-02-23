/**
 * TokenStore Integration Test
 *
 * Verifies that token storage works correctly using file-based encrypted storage.
 * createTokenStore() always returns FileTokenStore (AES-256-GCM).
 *
 * HOW TO RUN:
 * 1. Run: npx mocha --forbid-only "test/integration/infra/storage/token-store.integration.test.ts"
 */

import {expect} from 'chai'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import type {ITokenStore} from '../../../../src/server/core/interfaces/auth/i-token-store.js'

import {AuthToken} from '../../../../src/server/core/domain/entities/auth-token'
import {createTokenStore} from '../../../../src/server/infra/storage/token-store'
import {getGlobalDataDir} from '../../../../src/server/utils/global-data-path'

function createTestToken(): AuthToken {
  return new AuthToken({
    accessToken: `test-access-${Date.now()}`,
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: `test-refresh-${Date.now()}`,
    sessionKey: `test-session-${Date.now()}`,
    tokenType: 'Bearer',
    userEmail: 'integration-test@example.com',
    userId: 'integration-test-user',
  })
}

const dataDir = getGlobalDataDir()
const keyPath = join(dataDir, '.token-key')
const credentialsPath = join(dataDir, 'credentials')

describe('TokenStore Integration', function () {
  /** Increase timeout for file operations */
  this.timeout(10_000)

  let store: ITokenStore

  beforeEach(() => {
    store = createTokenStore()
  })

  afterEach(async () => {
    await store.clear()
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

      /** Create new store instance */
      const newStore = createTokenStore()
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

  describe('file-based storage', () => {
    it('should create encrypted credentials file', async () => {
      const token = createTestToken()

      await store.save(token)

      expect(existsSync(credentialsPath)).to.be.true

      /** Read and verify it's encrypted */
      const encrypted = readFileSync(credentialsPath, 'utf8')
      expect(encrypted).to.not.include(token.accessToken)
      expect(encrypted.split(':').length).to.equal(3) /* iv:authTag:data format */
    })

    it('should create encryption key file', async () => {
      const token = createTestToken()

      await store.save(token)

      expect(existsSync(keyPath)).to.be.true

      /** Key should be 32 bytes */
      const key = readFileSync(keyPath)
      expect(key.length).to.equal(32)
    })

    it('should rotate key on each save', async () => {
      const token1 = createTestToken()
      await store.save(token1)
      const key1 = readFileSync(keyPath)

      const token2 = createTestToken()
      await store.save(token2)
      const key2 = readFileSync(keyPath)

      // Key SHOULD change between saves (rotation)
      expect(key1.equals(key2)).to.be.false
    })
  })
})
