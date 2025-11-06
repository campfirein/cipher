/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {
  DiscoveryError,
  DiscoveryNetworkError,
  DiscoveryTimeoutError,
} from '../../../../src/core/domain/errors/discovery-error.js'
import {OidcDiscoveryService} from '../../../../src/infra/auth/oidc-discovery-service.js'

describe('OidcDiscoveryService', () => {
  let service: OidcDiscoveryService
  const issuerUrl = 'https://auth.example.com/oidc'
  const wellKnownPath = '/.well-known/openid-configuration'

  const validDiscoveryResponse = {
    authorization_endpoint: 'https://auth.example.com/oidc/authorize',
    issuer: 'https://auth.example.com/oidc',
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint: 'https://auth.example.com/oidc/token',
  }

  beforeEach(() => {
    service = new OidcDiscoveryService()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('successful discovery', () => {
    it('should fetch and parse OIDC metadata', async () => {
      nock(issuerUrl).get(wellKnownPath).reply(200, validDiscoveryResponse)

      const metadata = await service.discover(issuerUrl)

      expect(metadata.authorizationEndpoint).to.equal('https://auth.example.com/oidc/authorize')
      expect(metadata.tokenEndpoint).to.equal('https://auth.example.com/oidc/token')
      expect(metadata.issuer).to.equal('https://auth.example.com/oidc')
      expect(metadata.scopesSupported).to.deep.equal(['openid', 'profile', 'email'])
    })

    it('should handle discovery response without scopes_supported', async () => {
      const responseWithoutScopes = {
        authorization_endpoint: 'https://auth.example.com/oidc/authorize',
        issuer: 'https://auth.example.com/oidc',
        token_endpoint: 'https://auth.example.com/oidc/token',
      }

      nock(issuerUrl).get(wellKnownPath).reply(200, responseWithoutScopes)

      const metadata = await service.discover(issuerUrl)

      expect(metadata.scopesSupported).to.be.undefined
    })
  })

  describe('caching', () => {
    it('should cache discovery results', async () => {
      nock(issuerUrl).get(wellKnownPath).once().reply(200, validDiscoveryResponse)

      // First call - fetches from server
      await service.discover(issuerUrl)

      // Second call - should use cache (nock will fail if it tries to fetch again)
      const metadata = await service.discover(issuerUrl)

      expect(metadata.authorizationEndpoint).to.equal('https://auth.example.com/oidc/authorize')
    })

    it('should expire cache after TTL', async () => {
      const shortTtl = 10 // 10ms
      service = new OidcDiscoveryService(shortTtl)

      nock(issuerUrl).get(wellKnownPath).times(2).reply(200, validDiscoveryResponse)

      // First call
      await service.discover(issuerUrl)

      // Wait for cache to expire
      await new Promise((resolve) => {
        setTimeout(resolve, shortTtl + 5)
      })

      // Second call - should fetch again
      const metadata = await service.discover(issuerUrl)

      expect(metadata.authorizationEndpoint).to.equal('https://auth.example.com/oidc/authorize')
    })
  })

  describe('retry logic', () => {
    it('should not retry on HTTP errors', async () => {
      service = new OidcDiscoveryService(3_600_000, 5000, 3, 100)

      nock(issuerUrl).get(wellKnownPath).reply(404, {error: 'Not found'})

      try {
        await service.discover(issuerUrl)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(DiscoveryError)
        expect(error).to.not.be.instanceOf(DiscoveryNetworkError)
      }
    })
  })

  describe('timeout handling', () => {
    it('should timeout if request takes too long', async () => {
      service = new OidcDiscoveryService(3_600_000, 25, 1, 5) // 25ms timeout

      nock(issuerUrl).get(wellKnownPath).delay(100).reply(200, validDiscoveryResponse)

      try {
        await service.discover(issuerUrl)
        expect.fail('Should have thrown a timeout error')
      } catch (error) {
        expect(error).to.be.instanceOf(DiscoveryTimeoutError)
        const timeoutError = error as DiscoveryTimeoutError
        expect(timeoutError.issuerUrl).to.equal(issuerUrl)
      }
    })
  })

  describe('error handling', () => {
    it('should throw DiscoveryError on invalid discovery document (missing endpoints)', async () => {
      const invalidResponse = {
        issuer: 'https://auth.example.com/oidc',
        // Missing authorization_endpoint and token_endpoint
      }

      nock(issuerUrl).get(wellKnownPath).reply(200, invalidResponse)

      try {
        await service.discover(issuerUrl)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(DiscoveryError)
        expect((error as Error).message).to.include('missing required endpoints')
      }
    })

    it('should throw DiscoveryError on HTTP 500', async () => {
      nock(issuerUrl).get(wellKnownPath).reply(500, {error: 'Internal server error'})

      try {
        await service.discover(issuerUrl)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(DiscoveryError)
        expect((error as Error).message).to.include('HTTP 500')
      }
    })

    it('should throw DiscoveryError on invalid JSON', async () => {
      nock(issuerUrl).get(wellKnownPath).reply(200, 'not valid json')

      try {
        await service.discover(issuerUrl)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
      }
    })
  })
})
