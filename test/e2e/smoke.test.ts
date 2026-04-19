import {expect} from 'chai'

import {getE2eConfig, requireE2eEnv} from './helpers/index.js'

describe('E2E Smoke Test', () => {
  before(requireE2eEnv)

  it('should return a valid E2E config with all required fields', () => {
    const config = getE2eConfig()

    expect(config).to.have.property('apiKey').that.is.a('string').and.is.not.empty
    expect(config).to.have.property('iamBaseUrl').that.is.a('string').and.is.not.empty
    expect(config).to.have.property('cogitBaseUrl').that.is.a('string').and.is.not.empty
    expect(config).to.have.property('llmBaseUrl').that.is.a('string').and.is.not.empty
    expect(config).to.have.property('gitRemoteBaseUrl').that.is.a('string').and.is.not.empty
    expect(config).to.have.property('webAppUrl').that.is.a('string').and.is.not.empty
  })
})
