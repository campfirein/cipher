import type {Config} from '@oclif/core'
import type {SinonStubbedInstance} from 'sinon'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IAuthService} from '../../src/core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../../src/core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../../src/core/interfaces/i-callback-handler.js'
import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'
import type {IUserService} from '../../src/core/interfaces/i-user-service.js'
import type {ILoginUseCase} from '../../src/core/interfaces/usecase/i-login-use-case.js'

import Login from '../../src/commands/login.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {OAuthTokenData} from '../../src/core/domain/entities/oauth-token-data.js'
import {User} from '../../src/core/domain/entities/user.js'
import {LoginUseCase} from '../../src/infra/usecase/login-use-case.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

// ==================== TestableLoginCommand ====================

class TestableLoginCommand extends Login {
  constructor(
    private readonly useCase: ILoginUseCase,
    config: Config,
  ) {
    super([], config)
  }

  protected async createUseCase(): Promise<ILoginUseCase> {
    return this.useCase
  }
}

// ==================== Tests ====================

describe('login command', () => {
  let authService: SinonStubbedInstance<IAuthService>
  let browserLauncher: SinonStubbedInstance<IBrowserLauncher>
  let callbackHandler: SinonStubbedInstance<ICallbackHandler>
  let config: Config
  let errorMessages: string[]
  let logMessages: string[]
  let terminal: ITerminal
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let trackingService: SinonStubbedInstance<ITrackingService>
  let userService: SinonStubbedInstance<IUserService>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    logMessages = []
    errorMessages = []

    terminal = createMockTerminal({
      error: (msg) => errorMessages.push(msg),
      log: (msg) => msg !== undefined && logMessages.push(msg),
    })

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

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    userService = {
      getCurrentUser: stub(),
    }
  })

  afterEach(() => {
    restore()
  })

  function createTestUseCase(): LoginUseCase {
    return new LoginUseCase({
      authService,
      browserLauncher,
      callbackHandler,
      terminal,
      tokenStore,
      trackingService,
      userService,
    })
  }

  function createTestCommand(useCase: ILoginUseCase): TestableLoginCommand {
    return new TestableLoginCommand(useCase, config)
  }

  describe('Successful login flow', () => {
    it('should complete successful login with user fetch and display success message', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const tokenData = new OAuthTokenData(
        'access-token',
        new Date(Date.now() + 3600 * 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )
      const user = new User('user@example.com', 'user-id-123', 'Test User')

      // Mock OAuth flow
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(tokenData)
      userService.getCurrentUser.resolves(user)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      // Verify complete flow
      expect(callbackHandler.start.calledOnce).to.be.true
      expect(authService.initiateAuthorization.calledOnce).to.be.true
      expect(browserLauncher.open.calledWith(authUrl)).to.be.true
      expect(callbackHandler.waitForCallback.calledWith(state, 5 * 60 * 1000)).to.be.true
      expect(authService.exchangeCodeForToken.calledOnce).to.be.true

      // Verify user was fetched with correct credentials
      expect(userService.getCurrentUser.calledOnce).to.be.true
      expect(userService.getCurrentUser.calledWith('access-token', 'session-key')).to.be.true

      // Verify complete token with user info was saved
      expect(tokenStore.save.calledOnce).to.be.true
      const savedToken = tokenStore.save.firstCall.args[0] as AuthToken
      expect(savedToken.accessToken).to.equal('access-token')
      expect(savedToken.refreshToken).to.equal('refresh-token')
      expect(savedToken.sessionKey).to.equal('session-key')
      expect(savedToken.userId).to.equal('user-id-123')
      expect(savedToken.userEmail).to.equal('user@example.com')

      expect(callbackHandler.stop.calledOnce).to.be.true
    })

    it('should fail login when user fetch fails', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const tokenData = new OAuthTokenData(
        'access-token',
        new Date(Date.now() + 3600 * 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )

      // Mock OAuth flow with user fetch failure
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(tokenData)
      userService.getCurrentUser.rejects(new Error('Failed to fetch user information'))
      callbackHandler.stop.resolves()

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Failed to fetch user information')
      // Verify token was NOT saved when user fetch fails
      expect(tokenStore.save.called).to.be.false
      // Verify cleanup still happened
      expect(callbackHandler.stop.calledOnce).to.be.true
    })

    it('should display authUrl when browser fails to open', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const tokenData = new OAuthTokenData(
        'access-token',
        new Date(Date.now() + 3600 * 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )
      const user = new User('user@example.com', 'user-id-456', 'Test User')

      // Mock OAuth flow with browser failure
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.rejects(new Error('Browser not found'))
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(tokenData)
      userService.getCurrentUser.resolves(user)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      // Should still succeed (token saved with user info)
      expect(tokenStore.save.calledOnce).to.be.true
      const savedToken = tokenStore.save.firstCall.args[0] as AuthToken
      expect(savedToken.userEmail).to.equal('user@example.com')
      expect(callbackHandler.stop.calledOnce).to.be.true

      // Browser launcher should have been called and failed
      expect(browserLauncher.open.calledOnce).to.be.true
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

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Authentication timeout')
      // Verify cleanup happened
      expect(callbackHandler.stop.calledOnce).to.be.true
      expect(tokenStore.save.called).to.be.false
      // User fetch should not be called when callback times out
      expect(userService.getCurrentUser.called).to.be.false
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

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Invalid authorization code')
      // Verify cleanup happened
      expect(callbackHandler.stop.calledOnce).to.be.true
      expect(tokenStore.save.called).to.be.false
      // User fetch should not be called when token exchange fails
      expect(userService.getCurrentUser.called).to.be.false
    })

    it('should handle server start failure and cleanup', async () => {
      // Mock server start failure
      callbackHandler.start.rejects(new Error('Port already in use'))
      callbackHandler.stop.resolves()

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      expect(errorMessages).to.have.lengthOf(1)
      expect(errorMessages[0]).to.include('Port already in use')
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
      const tokenData = new OAuthTokenData(
        'access-token',
        new Date(Date.now() + 3600 * 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )
      const user = new User('user@example.com', 'user-id-789', 'Test User')
      const expectedRedirectUri = `http://localhost:${port}/callback`

      // Mock OAuth flow
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(tokenData)
      userService.getCurrentUser.resolves(user)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

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
      const tokenData = new OAuthTokenData(
        'access-token',
        new Date(Date.now() + 3600 * 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )
      const user = new User('user@example.com', 'user-id-999', 'Test User')

      // Mock OAuth flow
      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(tokenData)
      userService.getCurrentUser.resolves(user)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const useCase = createTestUseCase()
      const command = createTestCommand(useCase)

      await command.run()

      // Verify state from context was used to wait for callback
      expect(callbackHandler.waitForCallback.calledOnce).to.be.true
      const callbackArgs = callbackHandler.waitForCallback.firstCall.args
      expect(callbackArgs[0]).to.equal(state)
    })
  })
})
