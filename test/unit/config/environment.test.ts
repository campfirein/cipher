import {expect} from 'chai'

describe('Environment Configuration', () => {
  const ENV_VARS = {
    BRV_API_BASE_URL: 'https://api.test',
    BRV_AUTHORIZATION_URL: 'https://auth.test/authorize',
    BRV_COGIT_API_BASE_URL: 'https://cogit.test',
    BRV_ISSUER_URL: 'https://issuer.test',
    BRV_LLM_API_BASE_URL: 'https://llm.test',
    BRV_MEMORA_API_BASE_URL: 'https://memora.test',
    BRV_TOKEN_URL: 'https://auth.test/token',
    BRV_WEB_APP_URL: 'https://app.test',
  }

  const ALL_KEYS = ['BRV_ENV', ...Object.keys(ENV_VARS)]
  const savedEnvVars: Record<string, string | undefined> = {}

  before(() => {
    for (const key of ALL_KEYS) {
      savedEnvVars[key] = process.env[key]
    }
  })

  after(() => {
    for (const key of ALL_KEYS) {
      if (savedEnvVars[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnvVars[key]
      }
    }
  })

  beforeEach(() => {
    // Set all required env vars for each test
    for (const [key, value] of Object.entries(ENV_VARS)) {
      process.env[key] = value
    }
  })

  afterEach(() => {
    delete process.env.BRV_ENV
    for (const key of Object.keys(ENV_VARS)) {
      delete process.env[key]
    }
  })

  describe('ENVIRONMENT', () => {
    it('should default to development when BRV_ENV is not set', async () => {
      delete process.env.BRV_ENV

      const {ENVIRONMENT} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)

      expect(ENVIRONMENT).to.equal('development')
    })

    it('should be production when BRV_ENV is production', async () => {
      process.env.BRV_ENV = 'production'

      const {ENVIRONMENT} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)

      expect(ENVIRONMENT).to.equal('production')
    })

    it('should default to development for invalid BRV_ENV values', async () => {
      process.env.BRV_ENV = 'staging'

      const {ENVIRONMENT} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)

      expect(ENVIRONMENT).to.equal('development')
    })
  })

  describe('getCurrentConfig', () => {
    it('should read all URL properties from process.env', async () => {
      delete process.env.BRV_ENV

      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.apiBaseUrl).to.equal('https://api.test')
      expect(config.authorizationUrl).to.equal('https://auth.test/authorize')
      expect(config.cogitApiBaseUrl).to.equal('https://cogit.test')
      expect(config.issuerUrl).to.equal('https://issuer.test')
      expect(config.llmApiBaseUrl).to.equal('https://llm.test')
      expect(config.memoraApiBaseUrl).to.equal('https://memora.test')
      expect(config.tokenUrl).to.equal('https://auth.test/token')
      expect(config.webAppUrl).to.equal('https://app.test')
    })

    it('should return clientId from source', async () => {
      delete process.env.BRV_ENV

      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.clientId).to.equal('byterover-cli-client')
    })

    it('should return hubRegistryUrl from source', async () => {
      delete process.env.BRV_ENV

      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.hubRegistryUrl).to.equal('https://hub.byterover.dev/r/registry.json')
    })

    it('should return development scopes when BRV_ENV is not set', async () => {
      delete process.env.BRV_ENV

      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.scopes).to.deep.equal(['read', 'write', 'debug'])
    })

    it('should return production scopes when BRV_ENV is production', async () => {
      process.env.BRV_ENV = 'production'

      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)
      const config = getCurrentConfig()

      expect(config.scopes).to.deep.equal(['read', 'write'])
    })

    it('should throw when a required env var is missing', async () => {
      delete process.env.BRV_ENV
      delete process.env.BRV_API_BASE_URL

      const {getCurrentConfig} = await import(`../../../src/server/config/environment.js?t=${Date.now()}`)

      expect(() => getCurrentConfig()).to.throw('Missing required environment variable: BRV_API_BASE_URL')
    })
  })
})
