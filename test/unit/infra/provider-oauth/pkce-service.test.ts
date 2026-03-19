import {expect} from 'chai'
import crypto from 'node:crypto'

import {
  generateCodeChallenge,
  generateCodeVerifier,
  generatePkce,
  generateState,
} from '../../../../src/server/infra/provider-oauth/pkce-service.js'

describe('pkce-service', () => {
  describe('generateCodeVerifier', () => {
    it('should return a base64url string of 43 characters', () => {
      const verifier = generateCodeVerifier()
      expect(verifier).to.be.a('string')
      expect(verifier).to.have.lengthOf(43)
    })

    it('should only contain base64url characters', () => {
      const verifier = generateCodeVerifier()
      expect(verifier).to.match(/^[A-Za-z0-9_-]+$/)
    })

    it('should generate unique values on each call', () => {
      const v1 = generateCodeVerifier()
      const v2 = generateCodeVerifier()
      expect(v1).to.not.equal(v2)
    })
  })

  describe('generateCodeChallenge', () => {
    it('should return a base64url-encoded SHA-256 hash', () => {
      const verifier = 'test-verifier'
      const challenge = generateCodeChallenge(verifier)
      expect(challenge).to.be.a('string')
      expect(challenge).to.match(/^[A-Za-z0-9_-]+$/)
    })

    it('should produce a known output for a known input', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      // SHA-256 of the verifier, base64url-encoded (RFC 7636 Appendix B)
      const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
      const challenge = generateCodeChallenge(verifier)
      expect(challenge).to.equal(expected)
    })

    it('should be deterministic for the same input', () => {
      const verifier = generateCodeVerifier()
      const c1 = generateCodeChallenge(verifier)
      const c2 = generateCodeChallenge(verifier)
      expect(c1).to.equal(c2)
    })

    it('should produce different challenges for different verifiers', () => {
      const v1 = generateCodeVerifier()
      const v2 = generateCodeVerifier()
      const c1 = generateCodeChallenge(v1)
      const c2 = generateCodeChallenge(v2)
      expect(c1).to.not.equal(c2)
    })
  })

  describe('generateState', () => {
    it('should return a base64url string of 22 characters', () => {
      const state = generateState()
      expect(state).to.be.a('string')
      expect(state).to.have.lengthOf(22)
    })

    it('should generate unique values on each call', () => {
      const s1 = generateState()
      const s2 = generateState()
      expect(s1).to.not.equal(s2)
    })
  })

  describe('generatePkce', () => {
    it('should return codeVerifier, codeChallenge, and state', () => {
      const pkce = generatePkce()
      expect(pkce).to.have.property('codeVerifier')
      expect(pkce).to.have.property('codeChallenge')
      expect(pkce).to.have.property('state')
    })

    it('should return a challenge that matches the verifier', () => {
      const pkce = generatePkce()
      const expected = generateCodeChallenge(pkce.codeVerifier)
      expect(pkce.codeChallenge).to.equal(expected)
    })

    it('should generate unique parameters on each call', () => {
      const p1 = generatePkce()
      const p2 = generatePkce()
      expect(p1.codeVerifier).to.not.equal(p2.codeVerifier)
      expect(p1.state).to.not.equal(p2.state)
    })
  })
})
