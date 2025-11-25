import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'

import Main from '../../src/commands/main.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'

class TestableMain extends Main {
  public logMessages: string[] = []
  private readonly mockProjectConfigStore: IProjectConfigStore
  private readonly mockTokenStore: ITokenStore

  public constructor(
    mockTokenStore: ITokenStore,
    mockProjectConfigStore: IProjectConfigStore,
    config: Config,
  ) {
    super([], config)
    this.mockTokenStore = mockTokenStore
    this.mockProjectConfigStore = mockProjectConfigStore
  }

  protected createServices(): {projectConfigStore: IProjectConfigStore; tokenStore: ITokenStore} {
    return {projectConfigStore: this.mockProjectConfigStore, tokenStore: this.mockTokenStore}
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
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
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
    projectConfigStore = {
      exists: sinon.stub(),
      read: sinon.stub(),
      write: sinon.stub(),
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('Logged in state', () => {
    it('should display logged in message and config info when valid token exists and config exists', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      projectConfigStore.exists.resolves(true)

      const command = new TestableMain(tokenStore, projectConfigStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(projectConfigStore.exists.calledOnce).to.be.true
      expect(command.logMessages).to.have.lengthOf(5)
      expect(command.logMessages[0]).to.equal(`Logged in as ${mockToken.userEmail}`)
      expect(command.logMessages[1]).to.equal('Project configuration found in the current directory:')
      expect(command.logMessages[2]).to.equal(process.cwd())
      expect(command.logMessages[3]).to.equal("You can always run 'brv init' to re-initialize ByteRover for this project.")
      expect(command.logMessages[4]).to.equal("Then run 'brv' again.")
    })

    it('should display logged in message and config warning when valid token exists but config is missing', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      projectConfigStore.exists.resolves(false)

      const command = new TestableMain(tokenStore, projectConfigStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(projectConfigStore.exists.calledOnce).to.be.true
      expect(command.logMessages).to.have.lengthOf(5)
      expect(command.logMessages[0]).to.equal(`Logged in as ${mockToken.userEmail}`)
      expect(command.logMessages[1]).to.equal('No project configuration found in the current directory.')
      expect(command.logMessages[2]).to.equal('Please ensure you are in your desired codebase directory.')
      expect(command.logMessages[3]).to.equal("Run 'brv init' to initialize ByteRover for this project.")
      expect(command.logMessages[4]).to.equal("Then run 'brv' again.")
    })
  })

  describe('Not logged in state', () => {
    it('should display not logged in message when no token exists', async () => {
      tokenStore.load.resolves()

      const command = new TestableMain(tokenStore, projectConfigStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(projectConfigStore.exists.called).to.be.false
      expect(command.logMessages).to.have.lengthOf(3)
      expect(command.logMessages[0]).to.equal('You are not currently logged in.')
      expect(command.logMessages[1]).to.equal("Run 'brv login' to authenticate.")
      expect(command.logMessages[2]).to.equal("Then run 'brv' again.")
    })
  })

  describe('Expired token state', () => {
    it('should display expired message when token is expired', async () => {
      const expiredToken = createExpiredToken()
      tokenStore.load.resolves(expiredToken)

      const command = new TestableMain(tokenStore, projectConfigStore, config)
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(projectConfigStore.exists.called).to.be.false
      expect(command.logMessages).to.have.lengthOf(3)
      expect(command.logMessages[0]).to.equal('Session expired.')
      expect(command.logMessages[1]).to.equal("Run 'brv login' to authenticate.")
      expect(command.logMessages[2]).to.equal("Then run 'brv' again.")
    })
  })
})
