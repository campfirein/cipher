import {expect} from 'chai'

describe('Environment Configuration', () => {
  let originalEnv: string | undefined

  before(() => {
    // Save original environment
    originalEnv = process.env.BR_BUILD_ENV
  })

  after(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.BR_BUILD_ENV = originalEnv
    } else {
      delete process.env.BR_BUILD_ENV
    }
  })

  describe('ENVIRONMENT', () => {
    it('should default to development when BR_BUILD_ENV is not set', async () => {
      delete process.env.BR_BUILD_ENV

      // Reimport to get fresh value
      const {ENVIRONMENT} = await import('../../../src/config/environment.js')

      expect(ENVIRONMENT).to.equal('development')
    })
  })

  describe('ENV_CONFIG', () => {
    it('should have development configuration', async () => {
      const {ENV_CONFIG} = await import('../../../src/config/environment.js')

      expect(ENV_CONFIG.development).to.deep.include({
        clientId: 'byterover-cli-client',
        issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
      })
      expect(ENV_CONFIG.development.scopes).to.include('read')
      expect(ENV_CONFIG.development.scopes).to.include('write')
      expect(ENV_CONFIG.development.scopes).to.include('debug')
    })

    it('should have production configuration', async () => {
      const {ENV_CONFIG} = await import('../../../src/config/environment.js')

      expect(ENV_CONFIG.production).to.deep.include({
        clientId: 'byterover-cli-prod',
        issuerUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc',
      })
      expect(ENV_CONFIG.production.scopes).to.include('read')
      expect(ENV_CONFIG.production.scopes).to.include('write')
      expect(ENV_CONFIG.production.scopes).to.not.include('debug')
    })
  })

  describe('getCurrentConfig', () => {
    it('should return development config when ENVIRONMENT is development', async () => {
      delete process.env.BR_BUILD_ENV

      const {getCurrentConfig} = await import('../../../src/config/environment.js')
      const config = getCurrentConfig()

      expect(config.clientId).to.equal('byterover-cli-client')
      expect(config.issuerUrl).to.equal('https://dev-beta-iam.byterover.dev/api/v1/oidc')
    })
  })
})
