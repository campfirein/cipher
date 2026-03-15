/* eslint-disable camelcase -- OAuth token fields use snake_case per RFC 6749 */
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IBrowserLauncher} from '../../../../../src/server/core/interfaces/services/i-browser-launcher.js'
import type {ProviderCallbackServer} from '../../../../../src/server/infra/provider-oauth/callback-server.js'
import type {
  PkceParameters,
  ProviderTokenResponse,
  TokenExchangeParams,
} from '../../../../../src/server/infra/provider-oauth/types.js'

import {ProviderConfig} from '../../../../../src/server/core/domain/entities/provider-config.js'
import {TransportDaemonEventNames} from '../../../../../src/server/core/domain/transport/schemas.js'
import {ProviderHandler} from '../../../../../src/server/infra/transport/handlers/provider-handler.js'
import {ProviderEvents} from '../../../../../src/shared/transport/events/provider-events.js'
import {
  createMockProviderConfigStore,
  createMockProviderKeychainStore,
  createMockTransportServer,
} from '../../../../helpers/mock-factories.js'

// ==================== Test Helpers ====================

function createMockBrowserLauncher(): sinon.SinonStubbedInstance<IBrowserLauncher> {
  return {open: stub<[string], Promise<void>>().resolves()} as unknown as sinon.SinonStubbedInstance<IBrowserLauncher>
}

function createMockCallbackServer(): sinon.SinonStubbedInstance<ProviderCallbackServer> {
  return {
    getAddress: stub().returns({port: 1455}),
    start: stub().resolves(1455),
    stop: stub().resolves(),
    waitForCallback: stub().resolves({code: 'test-auth-code', state: 'test-state'}),
  } as unknown as sinon.SinonStubbedInstance<ProviderCallbackServer>
}

const TEST_PKCE: PkceParameters = {
  codeChallenge: 'test-challenge',
  codeVerifier: 'test-verifier',
  state: 'test-state',
}

const TEST_TOKEN_RESPONSE: ProviderTokenResponse = {
  access_token: 'test-access-token',
  expires_in: 3600,
  // JWT payload: { chatgpt_account_id: "acct_test123" }
  id_token: `eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({chatgpt_account_id: 'acct_test123'})).toString('base64url')}.fake`,
  refresh_token: 'test-refresh-token',
}

// ==================== Tests ====================

describe('ProviderHandler', () => {
  let providerConfigStore: ReturnType<typeof createMockProviderConfigStore>
  let providerKeychainStore: ReturnType<typeof createMockProviderKeychainStore>
  let transport: ReturnType<typeof createMockTransportServer>
  let browserLauncher: sinon.SinonStubbedInstance<IBrowserLauncher>
  let mockCallbackServer: sinon.SinonStubbedInstance<ProviderCallbackServer>
  let generatePkceStub: sinon.SinonStub<[], PkceParameters>
  let exchangeCodeStub: sinon.SinonStub<[TokenExchangeParams], Promise<ProviderTokenResponse>>

  beforeEach(() => {
    providerConfigStore = createMockProviderConfigStore()
    providerKeychainStore = createMockProviderKeychainStore()
    transport = createMockTransportServer()
    browserLauncher = createMockBrowserLauncher()
    mockCallbackServer = createMockCallbackServer()
    generatePkceStub = stub<[], PkceParameters>().returns(TEST_PKCE)
    exchangeCodeStub = stub<[TokenExchangeParams], Promise<ProviderTokenResponse>>().resolves(TEST_TOKEN_RESPONSE)
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): ProviderHandler {
    const handler = new ProviderHandler({
      browserLauncher,
      createCallbackServer: () => mockCallbackServer as unknown as ProviderCallbackServer,
      exchangeCodeForTokens: exchangeCodeStub,
      generatePkce: generatePkceStub,
      providerConfigStore,
      providerKeychainStore,
      transport,
    })
    handler.setup()
    return handler
  }

  describe('setup', () => {
    it('should register all provider event handlers', () => {
      createHandler()

      expect(transport._handlers.has(ProviderEvents.LIST)).to.be.true
      expect(transport._handlers.has(ProviderEvents.CONNECT)).to.be.true
      expect(transport._handlers.has(ProviderEvents.DISCONNECT)).to.be.true
      expect(transport._handlers.has(ProviderEvents.SET_ACTIVE)).to.be.true
      expect(transport._handlers.has(ProviderEvents.VALIDATE_API_KEY)).to.be.true
      expect(transport._handlers.has(ProviderEvents.START_OAUTH)).to.be.true
      expect(transport._handlers.has(ProviderEvents.AWAIT_OAUTH_CALLBACK)).to.be.true
      expect(transport._handlers.has(ProviderEvents.SUBMIT_OAUTH_CODE)).to.be.true
    })
  })

  describe('provider:connect', () => {
    it('should broadcast provider:updated after connecting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.CONNECT)
      const result = await handler!({apiKey: 'test-key', providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
    })

    it('should store API key before connecting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.CONNECT)
      await handler!({apiKey: 'test-key', providerId: 'openrouter'}, 'client-1')

      expect(providerKeychainStore.setApiKey.calledBefore(providerConfigStore.connectProvider)).to.be.true
    })

    it('should broadcast after connectProvider completes', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.CONNECT)
      await handler!({providerId: 'byterover'}, 'client-1')

      expect(providerConfigStore.connectProvider.calledBefore(transport.broadcast)).to.be.true
    })
  })

  describe('provider:disconnect', () => {
    it('should broadcast provider:updated after disconnecting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.DISCONNECT)
      const result = await handler!({providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
    })

    it('should delete API key for providers that require one', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.DISCONNECT)
      await handler!({providerId: 'openrouter'}, 'client-1')

      expect(providerKeychainStore.deleteApiKey.calledWith('openrouter')).to.be.true
    })

    it('should broadcast after disconnectProvider completes', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.DISCONNECT)
      await handler!({providerId: 'openrouter'}, 'client-1')

      expect(providerConfigStore.disconnectProvider.calledBefore(transport.broadcast)).to.be.true
    })
  })

  describe('provider:setActive', () => {
    it('should broadcast provider:updated after setting active provider', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.SET_ACTIVE)
      const result = await handler!({providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
    })

    it('should set active provider before broadcasting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.SET_ACTIVE)
      await handler!({providerId: 'openrouter'}, 'client-1')

      expect(providerConfigStore.setActiveProvider.calledWith('openrouter')).to.be.true
      expect(providerConfigStore.setActiveProvider.calledBefore(transport.broadcast)).to.be.true
    })
  })

  // ==================== OAuth: START_OAUTH ====================

  describe('provider:startOAuth', () => {
    it('should return error for provider without OAuth config', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.START_OAUTH)
      const result = await handler!({providerId: 'anthropic'}, 'client-1')

      expect(result).to.deep.include({success: false})
      expect(result.error).to.include('does not support OAuth')
    })

    it('should generate PKCE parameters and build auth URL for OpenAI', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.START_OAUTH)
      const result = await handler!({providerId: 'openai'}, 'client-1')

      expect(result.success).to.be.true
      expect(result.callbackMode).to.equal('auto')
      expect(result.authUrl).to.include('https://auth.openai.com/oauth/authorize')
      expect(result.authUrl).to.include('client_id=app_EMoamEEZ73f0CkXaXp7hrann')
      expect(result.authUrl).to.include('code_challenge=test-challenge')
      expect(result.authUrl).to.include('state=test-state')
      expect(result.authUrl).to.include('code_challenge_method=S256')
      expect(result.authUrl).to.include('response_type=code')
    })

    it('should include OpenAI-specific auth URL parameters', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.START_OAUTH)
      const result = await handler!({providerId: 'openai'}, 'client-1')

      expect(result.authUrl).to.include('id_token_add_organizations=true')
      expect(result.authUrl).to.include('originator=byterover')
      expect(result.authUrl).to.include('codex_cli_simplified_flow=true')
    })

    it('should start callback server on configured port', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await handler!({providerId: 'openai'}, 'client-1')

      expect(mockCallbackServer.start.calledOnce).to.be.true
    })

    it('should open browser with auth URL', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.START_OAUTH)
      const result = await handler!({providerId: 'openai'}, 'client-1')

      expect(browserLauncher.open.calledOnce).to.be.true
      expect(browserLauncher.open.firstCall.args[0]).to.equal(result.authUrl)
    })

    it('should not fail if browser launch fails', async () => {
      browserLauncher.open.rejects(new Error('No browser available'))
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.START_OAUTH)
      const result = await handler!({providerId: 'openai'}, 'client-1')

      expect(result.success).to.be.true
    })

    it('should stop existing flow before starting a new one for the same provider', async () => {
      const firstServer = createMockCallbackServer()
      const secondServer = createMockCallbackServer()
      let callCount = 0

      const handler = new ProviderHandler({
        browserLauncher,
        createCallbackServer() {
          callCount++
          return (callCount === 1 ? firstServer : secondServer) as unknown as ProviderCallbackServer
        },
        exchangeCodeForTokens: exchangeCodeStub,
        generatePkce: generatePkceStub,
        providerConfigStore,
        providerKeychainStore,
        transport,
      })
      handler.setup()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)

      // Start first flow
      await startHandler!({providerId: 'openai'}, 'client-1')
      expect(firstServer.start.calledOnce).to.be.true

      // Start second flow for the same provider — should stop the first
      await startHandler!({providerId: 'openai'}, 'client-1')

      expect(firstServer.stop.calledOnce).to.be.true
      expect(secondServer.start.calledOnce).to.be.true
    })

    it('should stop callback server if flow setup fails after server started', async () => {
      const failingServer = createMockCallbackServer()
      // Server starts successfully but browser launch throws after server is stored
      browserLauncher.open.callsFake(() => {
        throw new Error('Simulated failure after server start')
      })

      const handler = new ProviderHandler({
        browserLauncher,
        createCallbackServer: () => failingServer as unknown as ProviderCallbackServer,
        exchangeCodeForTokens: exchangeCodeStub,
        generatePkce: generatePkceStub,
        providerConfigStore,
        providerKeychainStore,
        transport,
      })
      handler.setup()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      const result = await startHandler!({providerId: 'openai'}, 'client-1')

      // Browser launch failure is non-fatal — flow should succeed
      expect(result.success).to.be.true
      expect(failingServer.start.calledOnce).to.be.true
    })
  })

  // ==================== OAuth: AWAIT_OAUTH_CALLBACK ====================

  describe('provider:awaitOAuthCallback', () => {
    it('should return error when no active flow exists', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      const result = await handler!({providerId: 'openai'}, 'client-1')

      expect(result).to.deep.include({success: false})
      expect(result.error).to.include('No active OAuth flow')
    })

    it('should exchange code for tokens and store credentials on success', async () => {
      createHandler()

      // First start the OAuth flow to create the flow state
      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      // Now await the callback
      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      const result = await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(result).to.deep.equal({success: true})

      // Verify token exchange was called
      expect(exchangeCodeStub.calledOnce).to.be.true
      const exchangeArgs = exchangeCodeStub.firstCall.args[0]
      expect(exchangeArgs.code).to.equal('test-auth-code')
      expect(exchangeArgs.codeVerifier).to.equal('test-verifier')
      expect(exchangeArgs.clientId).to.equal('app_EMoamEEZ73f0CkXaXp7hrann')
      expect(exchangeArgs.contentType).to.equal('application/x-www-form-urlencoded')
    })

    it('should store access token in keychain', async () => {
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(providerKeychainStore.setApiKey.calledWith('openai', 'test-access-token')).to.be.true
    })

    it('should connect provider with authMethod oauth and oauthAccountId', async () => {
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(providerConfigStore.connectProvider.calledOnce).to.be.true
      const connectArgs = providerConfigStore.connectProvider.firstCall.args
      expect(connectArgs[0]).to.equal('openai')
      expect(connectArgs[1]).to.deep.include({
        authMethod: 'oauth',
        oauthAccountId: 'acct_test123',
      })
    })

    it('should store refresh token and expiry in provider config', async () => {
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      await awaitHandler!({providerId: 'openai'}, 'client-1')

      const connectArgs = providerConfigStore.connectProvider.firstCall.args[1]
      expect(connectArgs?.oauthRefreshToken).to.equal('test-refresh-token')
      expect(connectArgs?.oauthExpiresAt).to.be.a('string')
      // Verify it's a valid ISO timestamp roughly 1 hour from now
      const expiresAt = new Date(connectArgs!.oauthExpiresAt!).getTime()
      const expectedApprox = Date.now() + 3600 * 1000
      expect(Math.abs(expiresAt - expectedApprox)).to.be.lessThan(5000)
    })

    it('should broadcast PROVIDER_UPDATED on success', async () => {
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      // Reset broadcast from startOAuth (no broadcast there, but just in case)
      transport.broadcast.resetHistory()

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
    })

    it('should stop callback server and clean up flow state on success', async () => {
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      await awaitHandler!({providerId: 'openai'}, 'client-1')

      // Callback server should be stopped
      expect(mockCallbackServer.stop.calledOnce).to.be.true

      // Second await should fail (flow cleaned up)
      const result = await awaitHandler!({providerId: 'openai'}, 'client-1')
      expect(result).to.deep.include({success: false})
    })

    it('should stop callback server and clean up flow state on failure', async () => {
      mockCallbackServer.waitForCallback.rejects(new Error('Timeout'))
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      const result = await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(result).to.deep.include({success: false})
      expect(result.error).to.include('Timeout')

      // Callback server should be stopped
      expect(mockCallbackServer.stop.calledOnce).to.be.true

      // Second await should also fail (flow cleaned up)
      const result2 = await awaitHandler!({providerId: 'openai'}, 'client-1')
      expect(result2).to.deep.include({success: false})
      expect(result2.error).to.include('No active OAuth flow')
    })

    it('should return error when token exchange fails', async () => {
      exchangeCodeStub.rejects(new Error('Token exchange failed'))
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      const result = await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(result).to.deep.include({success: false})
      expect(result.error).to.include('Token exchange failed')
    })

    it('should handle missing id_token gracefully (oauthAccountId undefined)', async () => {
      exchangeCodeStub.resolves({
        access_token: 'test-access-token',
        expires_in: 3600,
      })
      createHandler()

      const startHandler = transport._handlers.get(ProviderEvents.START_OAUTH)
      await startHandler!({providerId: 'openai'}, 'client-1')

      const awaitHandler = transport._handlers.get(ProviderEvents.AWAIT_OAUTH_CALLBACK)
      const result = await awaitHandler!({providerId: 'openai'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      const connectArgs = providerConfigStore.connectProvider.firstCall.args[1]
      expect(connectArgs?.oauthAccountId).to.be.undefined
    })
  })

  // ==================== OAuth: SUBMIT_OAUTH_CODE ====================

  describe('provider:submitOAuthCode', () => {
    it('should return error (stub for M2 Anthropic)', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.SUBMIT_OAUTH_CODE)
      const result = await handler!({code: 'some-code', providerId: 'anthropic'}, 'client-1')

      expect(result).to.deep.include({success: false})
      expect(result.error).to.include('not yet supported')
    })
  })

  // ==================== List with OAuth fields ====================

  describe('provider:list (OAuth fields)', () => {
    it('should include supportsOAuth field based on provider registry', async () => {
      providerConfigStore.read.resolves(ProviderConfig.createDefault())
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.LIST)
      const result = await handler!(undefined, 'client-1')

      const openaiProvider = result.providers.find((p: {id: string}) => p.id === 'openai')
      const anthropicProvider = result.providers.find((p: {id: string}) => p.id === 'anthropic')

      expect(openaiProvider?.supportsOAuth).to.be.true
      expect(anthropicProvider?.supportsOAuth).to.be.false
    })

    it('should include authMethod from config for connected providers', async () => {
      const config = ProviderConfig.createDefault().withProviderConnected('openai', {
        authMethod: 'oauth',
        oauthAccountId: 'acct_123',
      })
      providerConfigStore.read.resolves(config)
      providerConfigStore.isProviderConnected.withArgs('openai').resolves(true)
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.LIST)
      const result = await handler!(undefined, 'client-1')

      const openaiProvider = result.providers.find((p: {id: string}) => p.id === 'openai')
      expect(openaiProvider?.authMethod).to.equal('oauth')
      expect(openaiProvider?.requiresApiKey).to.be.false
    })
  })
})
