import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {getAuthConfig} from '../../../src/config/auth.config.js'
import {IOidcDiscoveryService} from '../../../src/core/interfaces/i-oidc-discovery-service.js'

describe('Auth Configuration', () => {
  let discoveryService: IOidcDiscoveryService
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    // Save original environment
    originalEnv = {
      BR_AUTH_URL: process.env.BR_AUTH_URL,
      BR_CLIENT_ID: process.env.BR_CLIENT_ID,
      BR_CLIENT_SECRET: process.env.BR_CLIENT_SECRET,
      BR_ENV: process.env.BR_ENV,
      BR_SCOPES: process.env.BR_SCOPES,
      BR_TOKEN_URL: process.env.BR_TOKEN_URL,
    }

    // Clean environment
    delete process.env.BR_AUTH_URL
    delete process.env.BR_ENV
    delete process.env.BR_CLIENT_ID
    delete process.env.BR_CLIENT_SECRET
    delete process.env.BR_SCOPES
    delete process.env.BR_TOKEN_URL

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
    // Restore original environment
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    restore()
  })

  describe('successful discovery', () => {
    it('should use discovered endpoints', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.equal('https://discovered.example.com/authorize')
      expect(config.tokenUrl).to.equal('https://discovered.example.com/token')
    })

    it('should use build-time clientId', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.clientId).to.equal('byterover-cli-client')
    })

    it('should use build-time scopes', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.scopes).to.include('read')
      expect(config.scopes).to.include('write')
      expect(config.scopes).to.include('debug')
    })
  })

  describe('environment variable overrides', () => {
    it('should allow BR_AUTH_URL to override discovered authorization endpoint', async () => {
      process.env.BR_AUTH_URL = 'https://override.example.com/auth'

      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.equal('https://override.example.com/auth')
    })

    it('should allow BR_TOKEN_URL to override discovered token endpoint', async () => {
      process.env.BR_TOKEN_URL = 'https://override.example.com/token'

      const config = await getAuthConfig(discoveryService)

      expect(config.tokenUrl).to.equal('https://override.example.com/token')
    })

    it('should allow BR_CLIENT_ID to override build-time clientId', async () => {
      process.env.BR_CLIENT_ID = 'custom-client-id'

      const config = await getAuthConfig(discoveryService)

      expect(config.clientId).to.equal('custom-client-id')
    })

    it('should allow BR_SCOPES to override build-time scopes', async () => {
      process.env.BR_SCOPES = 'custom read'

      const config = await getAuthConfig(discoveryService)

      expect(config.scopes).to.deep.equal(['custom', 'read'])
    })

    it('should support BR_CLIENT_SECRET', async () => {
      process.env.BR_CLIENT_SECRET = 'super-secret'

      const config = await getAuthConfig(discoveryService)

      expect(config.clientSecret).to.equal('super-secret')
    })
  })

  describe('discovery failure fallback', () => {
    beforeEach(() => {
      // Mock discovery to fail
      discoveryService.discover = stub().rejects(new Error('Network error'))
    })

    it('should fallback to hardcoded URLs when discovery fails', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.equal('https://dev-beta-iam.byterover.dev/api/v1/oidc/authorize')
      expect(config.tokenUrl).to.equal('https://dev-beta-iam.byterover.dev/api/v1/oidc/token')
    })

    it('should use environment-specific fallback URLs for development', async () => {
      delete process.env.BR_ENV // Defaults to development

      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.include('dev-beta-iam')
      expect(config.tokenUrl).to.include('dev-beta-iam')
    })

    it('should allow env vars to override fallback URLs', async () => {
      process.env.BR_AUTH_URL = 'https://manual.example.com/auth'
      process.env.BR_TOKEN_URL = 'https://manual.example.com/token'

      const config = await getAuthConfig(discoveryService)

      expect(config.authorizationUrl).to.equal('https://manual.example.com/auth')
      expect(config.tokenUrl).to.equal('https://manual.example.com/token')
    })

    it('should still use build-time config for clientId and scopes', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.clientId).to.equal('byterover-cli-client')
      expect(config.scopes).to.include('read')
      expect(config.scopes).to.include('write')
    })
  })

  describe('redirectUri', () => {
    it('should initialize redirectUri as empty string', async () => {
      const config = await getAuthConfig(discoveryService)

      expect(config.redirectUri).to.equal('')
    })
  })
})
