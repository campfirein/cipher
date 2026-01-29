import {expect} from 'chai'

describe('Environment Configuration', () => {
  let originalEnv: string | undefined

  before(() => {
    // Save original environment
    originalEnv = process.env.BR_ENV
  })

  after(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.BR_ENV = originalEnv
    } else {
      delete process.env.BR_ENV
    }
  })

  describe('ENVIRONMENT', () => {
    it('should default to development when BR_ENV is not set', async () => {
      delete process.env.BR_ENV

      // Reimport to get fresh value
      const {ENVIRONMENT} = await import('../../../src/server/config/environment.js')

      expect(ENVIRONMENT).to.equal('development')
    })
  })

  describe('getCurrentConfig', () => {
    it('should return development config when BRV_ENV is not set', async () => {
      delete process.env.BRV_ENV

      // Use cache busting to force fresh module evaluation
      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.clientId).to.equal('byterover-cli-client')
      expect(config.issuerUrl).to.equal('https://dev-beta-iam.byterover.dev/api/v1/oidc')
      expect(config.scopes).to.include('read')
      expect(config.scopes).to.include('write')
      expect(config.scopes).to.include('debug')
    })

    it('should return production config when BRV_ENV is production', async () => {
      process.env.BRV_ENV = 'production'

      // Use cache busting to force fresh module evaluation
      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.clientId).to.equal('byterover-cli-client')
      expect(config.issuerUrl).to.equal('https://iam.byterover.dev/api/v1/oidc')
      expect(config.scopes).to.include('read')
      expect(config.scopes).to.include('write')
      expect(config.scopes).to.not.include('debug')
    })
  })
})
