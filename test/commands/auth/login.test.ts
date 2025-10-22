import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon from 'sinon'

import Login from '../../../src/commands/auth/login.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {LoginUseCase} from '../../../src/core/usecases/login-use-case.js'
import {CallbackHandler} from '../../../src/infra/http/callback-handler.js'

describe('auth:login command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config

  beforeEach(async () => {
    sandbox = sinon.createSandbox()
    config = await Config.load()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should display success message on successful login', async () => {
    const mockToken = new AuthToken('access-token', 'refresh-token', new Date(Date.now() + 3600 * 1000), 'Bearer')

    // Stub server and use case
    sandbox.stub(CallbackHandler.prototype, 'start').resolves(3000)
    sandbox.stub(CallbackHandler.prototype, 'stop').resolves()

    sandbox.stub(LoginUseCase.prototype, 'execute').resolves({
      success: true,
      token: mockToken,
    })

    const command = new Login([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    expect(logSpy.calledWith('Successfully authenticated!')).to.be.true
  })

  it('should display failure message when login fails', async () => {
    // Stub server and use case
    sandbox.stub(CallbackHandler.prototype, 'start').resolves(3000)
    sandbox.stub(CallbackHandler.prototype, 'stop').resolves()

    sandbox.stub(LoginUseCase.prototype, 'execute').resolves({
      error: 'Authentication timeout',
      success: false,
    })

    const command = new Login([], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Authentication timeout')
    }
  })

  it('should display authUrl when browser fails to open', async () => {
    const mockToken = new AuthToken('access-token', 'refresh-token', new Date(Date.now() + 3600 * 1000), 'Bearer')
    const authUrl = 'https://auth.example.com/authorize?state=abc123'

    // Stub server and use case
    sandbox.stub(CallbackHandler.prototype, 'start').resolves(3000)
    sandbox.stub(CallbackHandler.prototype, 'stop').resolves()

    sandbox.stub(LoginUseCase.prototype, 'execute').resolves({
      authUrl,
      success: true,
      token: mockToken,
    })

    const command = new Login([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    expect(logSpy.calledWith('Successfully authenticated!')).to.be.true
    // Check that authUrl is displayed when browser fails
    const calls = logSpy.getCalls().map((c) => c.args[0])
    const hasAuthUrl = calls.some((arg) => typeof arg === 'string' && arg.includes(authUrl))
    expect(hasAuthUrl).to.be.true
  })
})
