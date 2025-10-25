import type {Config} from '@oclif/core'
import type {SinonStubbedInstance} from 'sinon'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, spy, stub} from 'sinon'

import type {IAuthService} from '../../../src/core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../../../src/core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../../../src/core/interfaces/i-callback-handler.js'
import type {IOidcDiscoveryService} from '../../../src/core/interfaces/i-oidc-discovery-service.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import Login from '../../../src/commands/auth/login.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'

/**
 * Testable Login command that accepts mocked services
 */
class TestableLogin extends Login {
  // eslint-disable-next-line max-params
  constructor(
    private readonly mockAuthService: IAuthService,
    private readonly mockBrowserLauncher: IBrowserLauncher,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockCallbackHandler: ICallbackHandler,
    private readonly mockDiscoveryService: IOidcDiscoveryService,
    config: Config,
  ) {
    super([], config)
  }

  protected async createAuthService(_discoveryService: IOidcDiscoveryService): Promise<IAuthService> {
    return this.mockAuthService
  }

  protected createServices() {
    return {
      browserLauncher: this.mockBrowserLauncher,
      callbackHandler: this.mockCallbackHandler,
      discoveryService: this.mockDiscoveryService,
      tokenStore: this.mockTokenStore,
    }
  }
}

describe('auth:login command', () => {
  let authService: SinonStubbedInstance<IAuthService>
  let browserLauncher: SinonStubbedInstance<IBrowserLauncher>
  let callbackHandler: SinonStubbedInstance<ICallbackHandler>
  let config: Config
  let discoveryService: SinonStubbedInstance<IOidcDiscoveryService>
  let tokenStore: SinonStubbedInstance<ITokenStore>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    authService = {
      exchangeCodeForToken: stub(),
      initiateAuthorization: stub(),
      refreshToken: stub(),
    }

    browserLauncher = {
      open: stub(),
    }

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    callbackHandler = {
      getPort: stub(),
      start: stub(),
      stop: stub(),
      waitForCallback: stub(),
    }

    discoveryService = {
      discover: stub(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('Successful login flow', () => {
    it('should complete successful login and display success message', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', 'session-key', 'Bearer')

      // Mock OAuth flow
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      await command.run()

      // Verify complete flow
      expect(callbackHandler.start.calledOnce).to.be.true
      expect(authService.initiateAuthorization.calledOnce).to.be.true
      expect(browserLauncher.open.calledWith(authUrl)).to.be.true
      expect(callbackHandler.waitForCallback.calledWith(state, 5 * 60 * 1000)).to.be.true
      expect(authService.exchangeCodeForToken.calledOnce).to.be.true
      expect(tokenStore.save.calledWith(token)).to.be.true
      expect(callbackHandler.stop.calledOnce).to.be.true
    })

    it('should display authUrl when browser fails to open', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', 'session-key', 'Bearer')

      // Mock OAuth flow with browser failure
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.rejects(new Error('Browser not found'))
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      const logSpy = spy(command, 'log')

      await command.run()

      // Should still succeed
      expect(tokenStore.save.calledWith(token)).to.be.true
      expect(callbackHandler.stop.calledOnce).to.be.true

      // Should display authUrl for manual copy
      const logCalls = logSpy.getCalls().map((c) => c.args[0])
      expect(logCalls.some((arg) => typeof arg === 'string' && arg.includes('Browser failed to open'))).to.be.true
      expect(logCalls.some((arg) => typeof arg === 'string' && arg.includes(authUrl))).to.be.true
    })
  })

  describe('Error handling', () => {
    it('should handle callback timeout and cleanup server', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}

      // Mock OAuth flow with callback timeout
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.rejects(new Error('Authentication timeout'))
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Authentication timeout')
      }

      // Verify cleanup happened
      expect(callbackHandler.stop.calledOnce).to.be.true
      expect(tokenStore.save.called).to.be.false
    })

    it('should handle token exchange failure and cleanup server', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}

      // Mock OAuth flow with token exchange failure
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.rejects(new Error('Invalid authorization code'))
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid authorization code')
      }

      // Verify cleanup happened
      expect(callbackHandler.stop.calledOnce).to.be.true
      expect(tokenStore.save.called).to.be.false
    })

    it('should handle server start failure and cleanup', async () => {
      // Mock server start failure
      callbackHandler.start.rejects(new Error('Port already in use'))
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Port already in use')
      }

      // Verify cleanup still attempted
      expect(callbackHandler.stop.calledOnce).to.be.true
    })
  })

  describe('OAuth flow details', () => {
    it('should construct redirectUri with dynamic port from callback handler', async () => {
      const port = 3456
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', 'session-key', 'Bearer')
      const expectedRedirectUri = `http://localhost:${port}/callback`

      // Mock OAuth flow
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      await command.run()

      // Verify redirectUri was passed to initiateAuthorization
      expect(authService.initiateAuthorization.calledOnce).to.be.true
      const initiateArgs = authService.initiateAuthorization.firstCall.args
      expect(initiateArgs[0]).to.equal(expectedRedirectUri)

      // Verify same redirectUri was passed to exchangeCodeForToken
      expect(authService.exchangeCodeForToken.calledOnce).to.be.true
      const exchangeArgs = authService.exchangeCodeForToken.firstCall.args
      expect(exchangeArgs[2]).to.equal(expectedRedirectUri)
    })

    it('should use state from authorization context for callback validation', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=generated-state'
      const state = 'generated-state'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', 'session-key', 'Bearer')

      // Mock OAuth flow
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const command = new TestableLogin(
        authService,
        browserLauncher,
        tokenStore,
        callbackHandler,
        discoveryService,
        config,
      )

      await command.run()

      // Verify state from context was used to wait for callback
      expect(callbackHandler.waitForCallback.calledOnce).to.be.true
      const callbackArgs = callbackHandler.waitForCallback.firstCall.args
      expect(callbackArgs[0]).to.equal(state)
    })
  })
})
