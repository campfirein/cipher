/* eslint-disable camelcase */
import {expect} from 'chai'
import crypto from 'node:crypto'

describe('OAuth Authorization Code Flow - Learning Tests', () => {
  describe('PKCE Code Generation', () => {
    it('should generate a random code verifier', () => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url')

      expect(codeVerifier).to.have.lengthOf.at.least(43)
      expect(codeVerifier).to.have.lengthOf.at.most(128)
    })

    it('should generate SHA256 code challenge from verifier', () => {
      const codeVerifier = 'test-verifier-1234567890-abcdefghijklmnop'
      const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

      expect(hash).to.be.a('string')
      expect(hash).to.have.lengthOf(43)
    })

    it('should generate different challenges for different verifiers', () => {
      const verifier1 = crypto.randomBytes(32).toString('base64url')
      const verifier2 = crypto.randomBytes(32).toString('base64url')

      const challenge1 = crypto.createHash('sha256').update(verifier1).digest('base64url')
      const challenge2 = crypto.createHash('sha256').update(verifier2).digest('base64url')

      expect(challenge1).to.not.equal(challenge2)
    })
  })

  describe('State Parameter Generation', () => {
    it('should generate a random state parameter', () => {
      const state = crypto.randomBytes(16).toString('base64url')

      expect(state).to.be.a('string')
      expect(state.length).to.be.at.least(20)
    })
  })

  describe('Authorization URL Construction', () => {
    it('should build authorization URL with required parameters', () => {
      const baseUrl = 'https://auth.example.com/oauth/authorize'
      const params = new URLSearchParams({
        client_id: 'test-client-id',
        code_challenge: 'test-challenge',
        code_challenge_method: 'S256',
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
        scope: 'read write',
        state: 'test-state',
      })

      const authUrl = `${baseUrl}?${params.toString()}`

      expect(authUrl).to.include('client_id=test-client-id')
      expect(authUrl).to.include('response_type=code')
      expect(authUrl).to.include('code_challenge=test-challenge')
      expect(authUrl).to.include('code_challenge_method=S256')
      expect(authUrl).to.include('state=test-state')
    })
  })
})
