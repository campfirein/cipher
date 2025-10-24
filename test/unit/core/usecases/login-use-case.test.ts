import {expect} from 'chai'
import sinon, {stub} from 'sinon'

import type {IAuthService} from '../../../../src/core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../../../../src/core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../../../../src/core/interfaces/i-callback-handler.js'
import type {ITokenStore} from '../../../../src/core/interfaces/i-token-store.js'

import {AuthToken} from '../../../../src/core/domain/entities/auth-token.js'
import {AuthenticationError} from '../../../../src/core/domain/errors/auth-error.js'
import {LoginUseCase} from '../../../../src/core/usecases/login-use-case.js'

describe('LoginUseCase', () => {
  let authService: sinon.SinonStubbedInstance<IAuthService>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let browserLauncher: sinon.SinonStubbedInstance<IBrowserLauncher>
  let callbackHandler: sinon.SinonStubbedInstance<ICallbackHandler>
  let useCase: LoginUseCase

  beforeEach(() => {
    authService = {
      exchangeCodeForToken: stub(),
      initiateAuthorization: stub(),
      refreshToken: stub(),
    }

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    browserLauncher = {
      open: stub(),
    }

    callbackHandler = {
      getPort: stub(),
      start: stub(),
      stop: stub(),
      waitForCallback: stub(),
    }

    useCase = new LoginUseCase(authService, browserLauncher, tokenStore, callbackHandler)
  })

  describe('execute', () => {
    it('should complete successful login flow with server lifecycle', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', '', 'Bearer')

      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const result = await useCase.execute()

      // Verify complete flow
      expect(callbackHandler.start.calledOnce).to.be.true
      expect(authService.initiateAuthorization.calledOnce).to.be.true
      expect(browserLauncher.open.calledWith(authUrl)).to.be.true
      expect(callbackHandler.waitForCallback.calledOnce).to.be.true
      expect(authService.exchangeCodeForToken.calledWith('auth-code')).to.be.true
      expect(tokenStore.save.calledWith(token)).to.be.true
      expect(callbackHandler.stop.calledOnce).to.be.true

      // Verify result
      expect(result.success).to.be.true
      expect(result.token).to.equal(token)
      expect(result.authUrl).to.be.undefined
    })

    it('should build redirectUri with correct port from callback handler', async () => {
      const port = 3456
      const state = 'state-123'
      const authContext = {authUrl: 'https://auth.example.com/authorize', state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', '', 'Bearer')
      const expectedRedirectUri = `http://localhost:${port}/callback`

      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      await useCase.execute()

      // Verify redirectUri was passed to initiateAuthorization
      expect(authService.initiateAuthorization.calledOnce).to.be.true
      const initiateArgs = authService.initiateAuthorization.firstCall.args
      expect(initiateArgs[0]).to.equal(expectedRedirectUri)

      // Verify same redirectUri was passed to exchangeCodeForToken
      expect(authService.exchangeCodeForToken.calledOnce).to.be.true
      const exchangeArgs = authService.exchangeCodeForToken.firstCall.args
      expect(exchangeArgs[2]).to.equal(expectedRedirectUri)
    })

    it('should return authUrl when browser fails to open', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', '', 'Bearer')

      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.rejects(new Error('Browser not found'))
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      const result = await useCase.execute()

      // Should still succeed but return authUrl for manual copy
      expect(result.success).to.be.true
      expect(result.token).to.equal(token)
      expect(result.authUrl).to.equal(authUrl)
      expect(callbackHandler.stop.calledOnce).to.be.true
    })

    it('should handle callback timeout error and cleanup', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}

      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.rejects(new AuthenticationError('Authentication timeout'))
      callbackHandler.stop.resolves()

      const result = await useCase.execute()

      // Should fail gracefully and cleanup
      expect(result.success).to.be.false
      expect(result.error).to.include('Authentication timeout')
      expect(callbackHandler.stop.calledOnce).to.be.true
      expect(tokenStore.save.called).to.be.false
    })

    it('should handle token exchange failure and cleanup', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=abc123'
      const state = 'state-123'
      const authContext = {authUrl, state}

      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.rejects(new AuthenticationError('Invalid authorization code'))
      callbackHandler.stop.resolves()

      const result = await useCase.execute()

      // Should fail and cleanup
      expect(result.success).to.be.false
      expect(result.error).to.include('Invalid authorization code')
      expect(callbackHandler.stop.calledOnce).to.be.true
      expect(tokenStore.save.called).to.be.false
    })

    it('should cleanup server even when callback handler fails to start', async () => {
      callbackHandler.start.rejects(new Error('Port already in use'))
      callbackHandler.stop.resolves()

      const result = await useCase.execute()

      // Should fail and still attempt cleanup
      expect(result.success).to.be.false
      expect(result.error).to.include('Port already in use')
      expect(callbackHandler.stop.calledOnce).to.be.true
    })

    it('should use state from authorization context for callback validation', async () => {
      const port = 3000
      const authUrl = 'https://auth.example.com/authorize?state=generated-state'
      const state = 'generated-state'
      const authContext = {authUrl, state}
      const token = new AuthToken('access', new Date(Date.now() + 3600 * 1000), 'refresh', '', 'Bearer')

      callbackHandler.start.resolves(port)
      callbackHandler.getPort.returns(port)
      authService.initiateAuthorization.returns(authContext)
      browserLauncher.open.resolves()
      callbackHandler.waitForCallback.resolves({code: 'auth-code', state})
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()
      callbackHandler.stop.resolves()

      await useCase.execute()

      // Verify state from context was used to wait for callback
      expect(callbackHandler.waitForCallback.calledOnce).to.be.true
      const callbackArgs = callbackHandler.waitForCallback.firstCall.args
      expect(callbackArgs[0]).to.equal(state)
    })
  })
})
