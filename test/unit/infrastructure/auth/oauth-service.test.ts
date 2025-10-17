import {expect} from 'chai'
import nock from 'nock'
import {restore} from 'sinon'

import {OAuthConfig} from '../../../../src/config/auth.config.js'
import {OAuthService} from '../../../../src/infra/auth/oauth-service.js'

describe('OAuthService', () => {
  let service: OAuthService
  let config: OAuthConfig

  beforeEach(() => {
    config = {
      authorizationUrl: 'https://auth.example.com/oauth/authorize',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['read', 'write'],
      tokenUrl: 'https://auth.example.com/oauth/token',
    }
    service = new OAuthService(config)
  })

  afterEach(() => {
    nock.cleanAll()
    restore()
  })

  describe('getAuthorizationUrl', () => {
    it('should build authorization URL with PKCE parameters', () => {
      const state = 'test-state'
      const codeVerifier = 'test-verifier'

      const url = service.getAuthorizationUrl(state, codeVerifier)

      expect(url).to.include('https://auth.example.com/oauth/authorize')
      expect(url).to.include('client_id=test-client-id')
      expect(url).to.include('response_type=code')
      expect(url).to.include('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback')
      expect(url).to.include('scope=read+write')
      expect(url).to.include('state=test-state')
      expect(url).to.include('code_challenge_method=S256')
      expect(url).to.include('code_challenge=')
    })
  })
})
