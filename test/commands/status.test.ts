import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {IUserService} from '../../src/core/interfaces/i-user-service.js'

import Status from '../../src/commands/status.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrConfig} from '../../src/core/domain/entities/br-config.js'
import {User} from '../../src/core/domain/entities/user.js'

/**
 * Testable Status command that accepts mocked services
 */
class TestableStatus extends Status {
  constructor(
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockUserService: IUserService,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      projectConfigStore: this.mockConfigStore,
      tokenStore: this.mockTokenStore,
      userService: this.mockUserService,
    }
  }
}

describe('Status Command', () => {
  let config: Config
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let userService: sinon.SinonStubbedInstance<IUserService>
  let validToken: AuthToken
  let testUser: User
  let testConfig: BrConfig

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    userService = {
      getCurrentUser: stub(),
    }

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    validToken = new AuthToken(
      'access-token',
      new Date(Date.now() + 3600 * 1000),
      'refresh-token',
      'session-key',
      'Bearer',
    )

    testUser = new User('user@example.com', 'user-123', 'John Doe')

    testConfig = new BrConfig(
      new Date().toISOString(),
      'space-1',
      'backend-api',
      'team-1',
      'acme-corp',
    )
  })

  afterEach(() => {
    restore()
  })

  describe('run()', () => {
    it('should display status when not logged in', async () => {
      tokenStore.load.resolves()
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.called).to.be.false
    })

    it('should display status when token is expired', async () => {
      const expiredToken = new AuthToken(
        'access-token',
        new Date(Date.now() - 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )

      tokenStore.load.resolves(expiredToken)
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.called).to.be.false
    })

    it('should display user email when logged in with valid token', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.calledWith('access-token', 'session-key')).to.be.true
    })

    it('should display not initialized when project is not initialized', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.called).to.be.false
    })

    it('should display connected space when project is initialized', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should handle user service network errors gracefully', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.rejects(new Error('Network timeout'))
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      // Should not throw
      await command.run()

      expect(userService.getCurrentUser.calledOnce).to.be.true
    })

    it('should handle token store errors gracefully', async () => {
      tokenStore.load.rejects(new Error('Keychain access denied'))
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      // Should not throw
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.called).to.be.false
    })

    it('should handle config store errors gracefully', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.rejects(new Error('File system error'))

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      // Should not throw
      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should show all sections even if one section fails', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.rejects(new Error('API error'))
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      // Should not throw and should show all sections
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.calledOnce).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should handle invalid config file gracefully', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.resolves(true)
      configStore.read.resolves()

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      // Should not throw
      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should handle all success states correctly', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      // Verify all services were called correctly
      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.calledWith('access-token', 'session-key')).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should not throw when logged in but project not initialized', async () => {
      tokenStore.load.resolves(validToken)
      userService.getCurrentUser.resolves(testUser)
      configStore.exists.resolves(false)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.calledOnce).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should not throw when not logged in but project initialized', async () => {
      tokenStore.load.resolves()
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(configStore, tokenStore, userService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(userService.getCurrentUser.called).to.be.false
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })
  })
})
