import {expect} from 'chai'
import keytar from 'keytar'
import {restore, SinonStub, stub} from 'sinon'

import {AuthToken} from '../../../../src/server/core/domain/entities/auth-token'
import {KeychainTokenStore} from '../../../../src/server/infra/storage/keychain-token-store'

describe('KeychainTokenStore', () => {
  let store: KeychainTokenStore
  let getPasswordStub: SinonStub
  let setPasswordStub: SinonStub
  let deletePasswordStub: SinonStub

  beforeEach(() => {
    getPasswordStub = stub(keytar, 'getPassword')
    setPasswordStub = stub(keytar, 'setPassword')
    deletePasswordStub = stub(keytar, 'deletePassword')
    store = new KeychainTokenStore()
  })

  afterEach(() => {
    restore()
  })

  describe('save', () => {
    it('should save token to keychain with userId and userEmail', async () => {
      const token = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-store-001',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-id-001',
      })

      // Simulate successful saving
      setPasswordStub.resolves()

      await store.save(token)

      expect(setPasswordStub.calledOnce).to.be.true
      expect(setPasswordStub.firstCall.args[0]).to.equal('byterover-cli')
      expect(setPasswordStub.firstCall.args[1]).to.equal('auth-token')

      // Assert that the token was serialized correctly
      const savedData = JSON.parse(setPasswordStub.firstCall.args[2])
      expect(savedData.accessToken).to.equal('access-token')
      expect(savedData.refreshToken).to.equal('refresh-token')
      expect(savedData.sessionKey).to.equal('session-store-001')
      expect(savedData.tokenType).to.equal('Bearer')
      expect(savedData.userId).to.equal('user-id-001')
      expect(savedData.userEmail).to.equal('user@example.com')
    })

    it('should handle save errors gracefully', async () => {
      const token = new AuthToken({
        accessToken: 'access',
        expiresAt: new Date(),
        refreshToken: 'refresh',
        sessionKey: 'session-store-002',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-id-002',
      })
      const errMsg = 'Keychain access denied'
      setPasswordStub.rejects(new Error(errMsg))

      try {
        await store.save(token)
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include(errMsg)
      }
    })
  })

  describe('load', () => {
    it('should load token from keychain with userId and userEmail', async () => {
      const accessToken = 'access-token'
      const refreshToken = 'refresh-token'
      const expiresAt = '2025-12-31T23:59:59.000Z'
      const sessionKey = 'session-stored-token'
      const tokenType = 'Bearer'
      const userId = 'user-id-load-test'
      const userEmail = 'user@example.com'

      const tokenData = {
        accessToken,
        expiresAt,
        refreshToken,
        sessionKey,
        tokenType,
        userEmail,
        userId,
      }

      getPasswordStub.resolves(JSON.stringify(tokenData))

      const loadedToken = await store.load()

      expect(loadedToken).to.not.be.undefined
      expect(loadedToken?.accessToken).to.equal(accessToken)
      expect(loadedToken?.refreshToken).to.equal(refreshToken)
      expect(loadedToken?.expiresAt.toISOString()).to.equal(expiresAt)
      expect(loadedToken?.sessionKey).to.equal(sessionKey)
      expect(loadedToken?.tokenType).to.equal(tokenType)
      expect(loadedToken?.userId).to.equal(userId)
      expect(loadedToken?.userEmail).to.equal(userEmail)
    })

    it('should return undefined for old token format (missing userId and userEmail)', async () => {
      const oldTokenData = {
        accessToken: 'access-token',
        expiresAt: '2025-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-old-token',
        tokenType: 'Bearer',
      }

      getPasswordStub.resolves(JSON.stringify(oldTokenData))

      const loadedToken = await store.load()

      // Old tokens without userId/userEmail should return undefined (forces re-login)
      expect(loadedToken).to.be.undefined
    })

    it('should return undefined if token does not exist', async () => {
      getPasswordStub.resolves(null)

      const token = await store.load()
      expect(token).to.be.undefined
    })

    it('should return undefined if token data is invalid', async () => {
      getPasswordStub.resolves('invalid-json-data')

      const token = await store.load()
      expect(token).to.be.undefined
    })

    it('should handle keychain read errors gracefully', async () => {
      getPasswordStub.rejects(new Error('Keychain read error'))

      const token = await store.load()
      expect(token).to.be.undefined
    })
  })

  describe('clear', () => {
    it('should delete token from keychain', async () => {
      deletePasswordStub.resolves(true)

      await store.clear()

      expect(deletePasswordStub.calledOnce).to.be.true
      expect(deletePasswordStub.firstCall.args[0]).to.equal('byterover-cli')
      expect(deletePasswordStub.firstCall.args[1]).to.equal('auth-token')
    })

    it('should not throw if token does not exist', async () => {
      deletePasswordStub.resolves(false)

      try {
        await store.clear()
      } catch {
        // If an error is thrown, the test should fail
        expect.fail('Expected store.clear() to handle errors gracefully, but it threw an error')
      }
    })

    it('should handle deletion errors gracefully', async () => {
      deletePasswordStub.rejects(new Error('Keychain delete error'))

      try {
        await store.clear()
      } catch {
        // If an error is thrown, the test should fail
        expect.fail('Expected store.clear() to handle errors gracefully, but it threw an error')
      }
    })
  })
})
