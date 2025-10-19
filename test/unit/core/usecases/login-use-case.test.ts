import {expect} from 'chai'
import sinon, {stub} from 'sinon'

import type {IAuthService} from '../../../../src/core/interfaces/i-auth-service'
import type {IBrowserLauncher} from '../../../../src/core/interfaces/i-browser-launcher'
import type {ITokenStore} from '../../../../src/core/interfaces/i-token-store'

import {AuthToken} from '../../../../src/core/domain/entities/auth-token'
import {LoginUseCase} from '../../../../src/core/usecases/login-use-case'

describe('LoginUseCase', () => {
  let authService: sinon.SinonStubbedInstance<IAuthService>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let browserLauncher: sinon.SinonStubbedInstance<IBrowserLauncher>
  let useCase: LoginUseCase

  beforeEach(() => {
    authService = {
      buildAuthorizationUrl: stub(),
      exchangeCodeForToken: stub(),
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

    useCase = new LoginUseCase(authService, browserLauncher, tokenStore)
  })

  describe('execute', () => {
    it('should complete successful login flow', async () => {
      const authUrl = 'https://auth.example.com?code=123'
      const token = new AuthToken('access', 'refresh', new Date(Date.now() + 3600 * 1000), 'Bearer')

      authService.buildAuthorizationUrl.returns(authUrl)
      browserLauncher.open.resolves()
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()

      // eslint-disable-next-line unicorn/consistent-function-scoping
      const mockCallback = async (): Promise<{code: string; state: string}> => ({code: 'auth-code', state: 'state-123'})

      const result = await useCase.execute(mockCallback)

      expect(result.success).to.be.true
      expect(result.token).to.equal(token)
      expect(browserLauncher.open.calledWith(authUrl)).to.be.true
      expect(tokenStore.save.calledWith(token)).to.be.true
    })

    // TODO: Add other 2 test cases.
  })
})
