import {expect} from 'chai'
import * as sinon from 'sinon'

import type {E2eConfig} from './env-guard.js'

import {getE2eConfig, requireE2eEnv} from './env-guard.js'

describe('E2E env-guard', () => {
  const URL_VARS = {
    BRV_COGIT_BASE_URL: 'https://cogit.test',
    BRV_GIT_REMOTE_BASE_URL: 'https://git.test',
    BRV_IAM_BASE_URL: 'https://iam.test',
    BRV_LLM_BASE_URL: 'https://llm.test',
    BRV_WEB_APP_URL: 'https://app.test',
  }

  const ALL_KEYS = ['BRV_E2E_API_KEY', ...Object.keys(URL_VARS)]
  const savedEnvVars: Record<string, string | undefined> = {}

  // Snapshot env vars before the suite so we can restore them after.
  // This prevents our cleanup from clobbering values that were already
  // present in the runner's environment (e.g. BRV_E2E_API_KEY in CI).
  before(() => {
    for (const key of ALL_KEYS) {
      savedEnvVars[key] = process.env[key]
    }
  })

  // Restore the original env vars so other test files see the same
  // environment they would have seen without this suite running.
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
    for (const key of ALL_KEYS) {
      delete process.env[key]
    }

    process.env.BRV_E2E_API_KEY = 'test-api-key'
    for (const [key, value] of Object.entries(URL_VARS)) {
      process.env[key] = value
    }
  })

  afterEach(() => {
    for (const key of ALL_KEYS) {
      delete process.env[key]
    }
  })

  describe('requireE2eEnv', () => {
    let consoleStub: sinon.SinonStub

    beforeEach(() => {
      consoleStub = sinon.stub(console, 'log')
    })

    afterEach(() => {
      consoleStub.restore()
    })

    it('should call this.skip() when BRV_E2E_API_KEY is not set', () => {
      delete process.env.BRV_E2E_API_KEY
      const skip = sinon.stub<[], never>()

      requireE2eEnv.call({skip})

      expect(skip.calledOnce).to.be.true
    })

    it('should not call this.skip() when BRV_E2E_API_KEY is set', () => {
      const skip = sinon.stub<[], never>()

      requireE2eEnv.call({skip})

      expect(skip.called).to.be.false
    })
  })

  describe('getE2eConfig', () => {
    describe('happy path', () => {
      it('should return all fields from env vars', () => {
        const config: E2eConfig = getE2eConfig()

        expect(config.apiKey).to.equal('test-api-key')
        expect(config.iamBaseUrl).to.equal('https://iam.test')
        expect(config.cogitBaseUrl).to.equal('https://cogit.test')
        expect(config.llmBaseUrl).to.equal('https://llm.test')
        expect(config.gitRemoteBaseUrl).to.equal('https://git.test')
        expect(config.webAppUrl).to.equal('https://app.test')
      })

      it('should return all fields as non-empty strings', () => {
        const config: E2eConfig = getE2eConfig()

        for (const [key, value] of Object.entries(config)) {
          expect(value, `${key} should be a non-empty string`).to.be.a('string').and.not.empty
        }
      })
    })

    describe('missing required variables', () => {
      it('should throw when BRV_E2E_API_KEY is missing', () => {
        delete process.env.BRV_E2E_API_KEY

        expect(() => getE2eConfig()).to.throw('BRV_E2E_API_KEY is required')
      })

      for (const envVar of Object.keys(URL_VARS)) {
        it(`should throw when ${envVar} is missing`, () => {
          delete process.env[envVar]

          expect(() => getE2eConfig()).to.throw(`Missing required environment variable: ${envVar}`)
        })
      }
    })

    describe('root-domain validation', () => {
      it('should throw when BRV_IAM_BASE_URL contains a path component', () => {
        process.env.BRV_IAM_BASE_URL = 'https://iam.test/api/v1'

        expect(() => getE2eConfig()).to.throw('BRV_IAM_BASE_URL must not include a path component')
      })

      it('should throw when BRV_COGIT_BASE_URL contains a path component', () => {
        process.env.BRV_COGIT_BASE_URL = 'https://cogit.test/api/v1'

        expect(() => getE2eConfig()).to.throw('BRV_COGIT_BASE_URL must not include a path component')
      })

      it('should allow paths on BRV_GIT_REMOTE_BASE_URL', () => {
        process.env.BRV_GIT_REMOTE_BASE_URL = 'https://git.test/some/path'

        const config: E2eConfig = getE2eConfig()

        expect(config.gitRemoteBaseUrl).to.equal('https://git.test/some/path')
      })

      it('should allow paths on BRV_WEB_APP_URL', () => {
        process.env.BRV_WEB_APP_URL = 'https://app.test/some/path'

        const config: E2eConfig = getE2eConfig()

        expect(config.webAppUrl).to.equal('https://app.test/some/path')
      })
    })

    describe('normalization', () => {
      it('should strip trailing slashes from all URL fields', () => {
        process.env.BRV_IAM_BASE_URL = 'https://iam.test/'
        process.env.BRV_COGIT_BASE_URL = 'https://cogit.test/'
        process.env.BRV_LLM_BASE_URL = 'https://llm.test/'
        process.env.BRV_GIT_REMOTE_BASE_URL = 'https://git.test/'
        process.env.BRV_WEB_APP_URL = 'https://app.test/'

        const config: E2eConfig = getE2eConfig()

        expect(config.iamBaseUrl).to.equal('https://iam.test')
        expect(config.cogitBaseUrl).to.equal('https://cogit.test')
        expect(config.llmBaseUrl).to.equal('https://llm.test')
        expect(config.gitRemoteBaseUrl).to.equal('https://git.test')
        expect(config.webAppUrl).to.equal('https://app.test')
      })

      it('should strip multiple consecutive trailing slashes', () => {
        process.env.BRV_IAM_BASE_URL = 'https://iam.test///'

        const config: E2eConfig = getE2eConfig()

        expect(config.iamBaseUrl).to.equal('https://iam.test')
      })

      it('should trim whitespace from env var values', () => {
        process.env.BRV_IAM_BASE_URL = '  https://iam.test  '
        process.env.BRV_COGIT_BASE_URL = '  https://cogit.test  '

        const config: E2eConfig = getE2eConfig()

        expect(config.iamBaseUrl).to.equal('https://iam.test')
        expect(config.cogitBaseUrl).to.equal('https://cogit.test')
      })
    })

    describe('variable name alignment', () => {
      it('should read from BRV_IAM_BASE_URL, not BRV_API_BASE_URL', () => {
        try {
          process.env.BRV_IAM_BASE_URL = 'https://iam.correct'
          process.env.BRV_API_BASE_URL = 'https://iam.wrong'

          const config: E2eConfig = getE2eConfig()

          expect(config.iamBaseUrl).to.equal('https://iam.correct')
        } finally {
          delete process.env.BRV_API_BASE_URL
        }
      })

      it('should read from BRV_COGIT_BASE_URL, not BRV_COGIT_API_BASE_URL', () => {
        try {
          process.env.BRV_COGIT_BASE_URL = 'https://cogit.correct'
          process.env.BRV_COGIT_API_BASE_URL = 'https://cogit.wrong'

          const config: E2eConfig = getE2eConfig()

          expect(config.cogitBaseUrl).to.equal('https://cogit.correct')
        } finally {
          delete process.env.BRV_COGIT_API_BASE_URL
        }
      })

      it('should read from BRV_LLM_BASE_URL, not BRV_LLM_API_BASE_URL', () => {
        try {
          process.env.BRV_LLM_BASE_URL = 'https://llm.correct'
          process.env.BRV_LLM_API_BASE_URL = 'https://llm.wrong'

          const config: E2eConfig = getE2eConfig()

          expect(config.llmBaseUrl).to.equal('https://llm.correct')
        } finally {
          delete process.env.BRV_LLM_API_BASE_URL
        }
      })
    })
  })
})
