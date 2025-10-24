import {expect} from 'chai'

import {AuthToken} from '../../../../../src/core/domain/entities/auth-token.js'

describe('AuthToken', () => {
  describe('isExpired', () => {
    it('should return false for non-expired token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000) // 1 hour from now
      const token = new AuthToken('access-token', expiresAt, 'refresh-token', 'session-abc123', 'Bearer')
      expect(token.isExpired()).to.be.false
    })

    it('should return true for expired token', () => {
      const expiresAt = new Date(Date.now() - 1000) // 1 second ago
      const token = new AuthToken('access-token', expiresAt, 'refresh-token', 'session-abc124', 'Bearer')
      expect(token.isExpired()).to.be.true
    })

    it('should return true for token expiring now', () => {
      const expiresAt = new Date()
      const token = new AuthToken('access-token', expiresAt, 'refresh-token', 'session-abc125', 'Bearer')
      expect(token.isExpired()).to.be.true
    })
  })

  describe('isValid', () => {
    it('should return true for valid non-expired token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken('access-token', expiresAt, 'refresh-token', 'session-abc126', 'Bearer')
      expect(token.isValid()).to.be.true
    })

    it('should return false for expired token', () => {
      const expiresAt = new Date(Date.now() - 1000)
      const token = new AuthToken('access-token', expiresAt, 'refresh-token', 'session-abc127', 'Bearer')
      expect(token.isValid()).to.be.false
    })

    it('should return false for token without access token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken('', expiresAt, 'refresh-token', 'session-abc128', 'Bearer')
      expect(token.isValid()).to.be.false
    })
  })

  describe('toJSON', () => {
    it('should serialize token to JSON', () => {
      const expiresAt = new Date('2024-12-31T23:59:59.000Z')
      const token = new AuthToken('access-token', expiresAt, 'refresh-token', 'session-abc129', 'Bearer')
      const json = token.toJson()

      expect(json).to.deep.equal({
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc129',
        tokenType: 'Bearer',
      })
    })
  })

  describe('fromJSON', () => {
    it('should deserialize token from JSON', () => {
      const json = {
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        sessionKey: 'session-abc130',
        tokenType: 'Bearer',
      }

      const token = AuthToken.fromJson(json)

      expect(token.accessToken).to.equal('access-token')
      expect(token.refreshToken).to.equal('refresh-token')
      expect(token.expiresAt.toISOString()).to.equal('2024-12-31T23:59:59.000Z')
      expect(token.sessionKey).to.equal('session-abc130')
      expect(token.tokenType).to.equal('Bearer')
    })
  })
})
