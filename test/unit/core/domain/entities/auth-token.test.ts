import {expect} from 'chai'

import {AuthToken} from '../../../../../src/core/domain/entities/auth-token.js'

describe('AuthToken', () => {
  describe('constructor', () => {
    it('should create token with all required fields including userId and userEmail', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken({
        accessToken: 'access-token',
        expiresAt,
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc123',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-id-123',
      })
      expect(token.accessToken).to.equal('access-token')
      expect(token.sessionKey).to.equal('session-abc123')
      expect(token.userId).to.equal('user-id-123')
      expect(token.userEmail).to.equal('user@example.com')
    })
  })

  describe('isExpired', () => {
    it('should return false for non-expired token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000) // 1 hour from now
      const token = new AuthToken({accessToken: 'access-token', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc123', tokenType: 'Bearer', userId: 'user-id-123', userEmail: 'user@example.com'})
      expect(token.isExpired()).to.be.false
    })

    it('should return true for expired token', () => {
      const expiresAt = new Date(Date.now() - 1000) // 1 second ago
      const token = new AuthToken({accessToken: 'access-token', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc124', tokenType: 'Bearer', userId: 'user-id-124', userEmail: 'user@example.com'})
      expect(token.isExpired()).to.be.true
    })

    it('should return true for token expiring now', () => {
      const expiresAt = new Date()
      const token = new AuthToken({accessToken: 'access-token', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc125', tokenType: 'Bearer', userId: 'user-id-125', userEmail: 'user@example.com'})
      expect(token.isExpired()).to.be.true
    })
  })

  describe('isValid', () => {
    it('should return true for valid non-expired token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken({accessToken: 'access-token', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc126', tokenType: 'Bearer', userId: 'user-id-126', userEmail: 'user@example.com'})
      expect(token.isValid()).to.be.true
    })

    it('should return false for expired token', () => {
      const expiresAt = new Date(Date.now() - 1000)
      const token = new AuthToken({accessToken: 'access-token', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc127', tokenType: 'Bearer', userId: 'user-id-127', userEmail: 'user@example.com'})
      expect(token.isValid()).to.be.false
    })

    it('should return false for token without access token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken({accessToken: '', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc128', tokenType: 'Bearer', userId: 'user-id-128', userEmail: 'user@example.com'})
      expect(token.isValid()).to.be.false
    })
  })

  describe('toJSON', () => {
    it('should serialize token to JSON including userId and userEmail', () => {
      const expiresAt = new Date('2024-12-31T23:59:59.000Z')
      const token = new AuthToken({accessToken: 'access-token', expiresAt, refreshToken: 'refresh-token', sessionKey: 'session-abc129', tokenType: 'Bearer', userId: 'user-id-129', userEmail: 'user@example.com'})
      const json = token.toJson()

      expect(json).to.deep.equal({
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc129',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-id-129',
      })
    })
  })

  describe('fromJSON', () => {
    it('should deserialize token from JSON with all fields', () => {
      const json = {
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc130',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-id-130',
      }

      const token = AuthToken.fromJson(json)

      expect(token?.accessToken).to.equal('access-token')
      expect(token?.refreshToken).to.equal('refresh-token')
      expect(token?.expiresAt.toISOString()).to.equal('2024-12-31T23:59:59.000Z')
      expect(token?.sessionKey).to.equal('session-abc130')
      expect(token?.tokenType).to.equal('Bearer')
      expect(token?.userId).to.equal('user-id-130')
      expect(token?.userEmail).to.equal('user@example.com')
    })

    it('should return undefined when userId is missing (old token format)', () => {
      const json = {
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc131',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
      }

      const token = AuthToken.fromJson(json)

      expect(token).to.be.undefined
    })

    it('should return undefined when userEmail is missing (old token format)', () => {
      const json = {
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc132',
        tokenType: 'Bearer',
        userId: 'user-id-132',
      }

      const token = AuthToken.fromJson(json)

      expect(token).to.be.undefined
    })

    it('should return undefined when both userId and userEmail are missing (old token format)', () => {
      const json = {
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc133',
        tokenType: 'Bearer',
      }

      const token = AuthToken.fromJson(json)

      expect(token).to.be.undefined
    })

    it('should round-trip serialize and deserialize correctly', () => {
      const expiresAt = new Date('2024-12-31T23:59:59.000Z')
      const originalToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt,
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc134',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-id-134',
      })

      const json = originalToken.toJson()
      const deserializedToken = AuthToken.fromJson(json)

      expect(deserializedToken?.accessToken).to.equal(originalToken.accessToken)
      expect(deserializedToken?.refreshToken).to.equal(originalToken.refreshToken)
      expect(deserializedToken?.expiresAt.toISOString()).to.equal(originalToken.expiresAt.toISOString())
      expect(deserializedToken?.sessionKey).to.equal(originalToken.sessionKey)
      expect(deserializedToken?.tokenType).to.equal(originalToken.tokenType)
      expect(deserializedToken?.userId).to.equal(originalToken.userId)
      expect(deserializedToken?.userEmail).to.equal(originalToken.userEmail)
    })
  })
})
