import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'

import Main from '../../src/commands/main.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'

class TestableMain extends Main {
  public logMessages: string[] = []
  private readonly mockTokenStore: ITokenStore

  public constructor(mockTokenStore: ITokenStore, config: Config) {
    super([], config)
    this.mockTokenStore = mockTokenStore
  }

  protected createServices(): {tokenStore: ITokenStore} {
    return {tokenStore: this.mockTokenStore}
  }

  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(message?: string): void {
    if (message) {
      this.logMessages.push(message)
    }
  }

  public warn(input: Error | string): Error | string {
    return input
  }
}

const createMockToken = (): AuthToken =>
  new AuthToken({
    accessToken: 'test-access-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: 'test-refresh-token',
    sessionKey: 'test-session-key',
    tokenType: 'Bearer',
    userEmail: 'test@example.com',
    userId: 'user-123',
  })

const createExpiredToken = (): AuthToken =>
  new AuthToken({
    accessToken: 'test-access-token',
    expiresAt: new Date(Date.now() - 1000),
    refreshToken: 'test-refresh-token',
    sessionKey: 'test-session-key',
    tokenType: 'Bearer',
    userEmail: 'test@example.com',
    userId: 'user-123',
  })

describe('main command', () => {
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let config: Config

  before(async () => {
    config = await Config.load(import.meta.url)
  })

  beforeEach(() => {
    tokenStore = {
      clear: sinon.stub(),
      load: sinon.stub(),
      save: sinon.stub(),
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('Logged in state', () => {
    it('should display logged in message with user email when valid token exists', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)

      const command = new TestableMain(tokenStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(command.logMessages).to.have.lengthOf(1)
      expect(command.logMessages[0]).to.equal(`Logged in as ${mockToken.userEmail}`)
    })
  })

  describe('Not logged in state', () => {
    it('should display not logged in message when no token exists', async () => {
      tokenStore.load.resolves()

      const command = new TestableMain(tokenStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(command.logMessages).to.have.lengthOf(2)
      expect(command.logMessages[0]).to.equal('You are not currently logged in.')
      expect(command.logMessages[1]).to.equal("Run 'brv login' to authenticate.")
    })
  })

  describe('Expired token state', () => {
    it('should display expired message when token is expired', async () => {
      const expiredToken = createExpiredToken()
      tokenStore.load.resolves(expiredToken)

      const command = new TestableMain(tokenStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(command.logMessages).to.have.lengthOf(2)
      expect(command.logMessages[0]).to.equal('Session expired.')
      expect(command.logMessages[1]).to.equal("Run 'brv login' to authenticate.")
    })
  })
})
