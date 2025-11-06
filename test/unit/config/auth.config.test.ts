import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import {getAuthConfig} from '../../../src/config/auth.config.js'
import {IOidcDiscoveryService} from '../../../src/core/interfaces/i-oidc-discovery-service.js'

describe('Auth Configuration', () => {
  let discoveryService: IOidcDiscoveryService
  let originalEnv: string | undefined
  let consoleWarnStub: sinon.SinonStub

  beforeEach(() => {
    // Save original environment
    originalEnv = process.env.BR_ENV

    // Clean environment
    delete process.env.BR_ENV

    // Stub console.warn to suppress output
    consoleWarnStub = stub(console, 'warn')

    // Create mock discovery service
    discoveryService = {
      discover: stub().resolves({
        authorizationEndpoint: 'https://discovered.example.com/authorize',
        issuer: 'https://discovered.example.com',
        scopesSupported: ['read', 'write', 'admin'],
        tokenEndpoint: 'https://discovered.example.com/token',
      }),
    }
  })

  afterEach(() => {
    // Restore console.warn stub
    consoleWarnStub.restore()

    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env.BR_ENV
    } else {
      process.env.BR_ENV = originalEnv
    }

    restore()
  })

  describe('successful discovery', () => {
    it('should use discovered endpoints', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.equal('https://discovered.example.com/authorize')
      expect(config.tokenUrl).to.equal('https://discovered.example.com/token')
    })

    it('should use environment-specific clientId', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.clientId).to.equal('byterover-cli-client')
    })

    it('should use environment-specific scopes', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.scopes).to.include('read')
      expect(config.scopes).to.include('write')
      expect(config.scopes).to.include('debug')
    })

    it('should not set clientSecret for public client', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.clientSecret).to.be.undefined
    })
  })

  describe('discovery failure fallback', () => {
    beforeEach(() => {
      // Mock discovery to fail
      discoveryService.discover = stub().rejects(new Error('Network error'))
    })

    it('should fallback to hardcoded environment-specific URLs when discovery fails', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.equal('https://dev-beta-iam.byterover.dev/api/v1/oidc/authorize')
      expect(config.tokenUrl).to.equal('https://dev-beta-iam.byterover.dev/api/v1/oidc/token')
    })

    it('should use development fallback URLs by default', async () => {
      delete process.env.BR_ENV // Defaults to development

      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.include('dev-beta-iam')
      expect(config.tokenUrl).to.include('dev-beta-iam')
    })

    it('should still use environment-specific clientId and scopes in fallback', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.clientId).to.equal('byterover-cli-client')
      expect(config.scopes).to.include('read')
      expect(config.scopes).to.include('write')
      expect(config.scopes).to.include('debug')
    })
  })

  describe('redirectUri', () => {
    it('should not set redirectUri (determined at runtime)', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.redirectUri).to.be.undefined
    })
  })
})
