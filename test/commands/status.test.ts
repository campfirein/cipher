import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IPlaybookStore} from '../../src/core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Status from '../../src/commands/status.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {BrConfig} from '../../src/core/domain/entities/br-config.js'
import {Playbook} from '../../src/core/domain/entities/playbook.js'

/**
 * Testable Status command that accepts mocked services
 */
class TestableStatus extends Status {
  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockPlaybookStore: IPlaybookStore,
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockTrackingService: ITrackingService,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      playbookStore: this.mockPlaybookStore,
      projectConfigStore: this.mockConfigStore,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    // Throw error to maintain behavior but suppress output
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

describe('Status Command', () => {
  let config: Config
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let validToken: AuthToken
  let testConfig: BrConfig

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    playbookStore = {
      clear: stub(),
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    validToken = new AuthToken({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshToken: 'refresh-token',
      sessionKey: 'session-key',
      tokenType: 'Bearer',
      userEmail: 'user@example.com',
      userId: 'user-123',
    })

    testConfig = new BrConfig(new Date().toISOString(), 'space-1', 'backend-api', 'team-1', 'acme-corp')
  })

  afterEach(() => {
    restore()
  })

  describe('run()', () => {
    it('should display status when not logged in', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves()
      configStore.exists.resolves(false)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
    })

    it('should display status when token is expired', async () => {
      const expiredToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user-expired',
      })

      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(expiredToken)
      configStore.exists.resolves(false)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
    })

    it('should display user email from token when logged in with valid token', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(false)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      // Verify token was loaded (main behavior check)
      expect(tokenStore.load.calledOnce).to.be.true
    })

    it('should display not initialized when project is not initialized', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(false)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.called).to.be.false
    })

    it('should display connected space when project is initialized', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should handle token store errors gracefully', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.rejects(new Error('Keychain access denied'))
      configStore.exists.resolves(false)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      // Should not throw
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
    })

    it('should handle config store errors gracefully', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.rejects(new Error('File system error'))

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      // Should not throw
      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should show all sections even if config section fails', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.rejects(new Error('File read error'))

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      // Should not throw and should show auth section
      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should handle invalid config file gracefully', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves()

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      // Should not throw
      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should handle all success states correctly', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      // Verify all services were called correctly
      expect(tokenStore.load.calledOnce).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })

    it('should not throw when logged in but project not initialized', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves(validToken)
      configStore.exists.resolves(false)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should not throw when not logged in but project initialized', async () => {
      playbookStore.load.resolves(new Playbook())
      tokenStore.load.resolves()
      configStore.exists.resolves(true)
      configStore.read.resolves(testConfig)

      const command = new TestableStatus(playbookStore, configStore, tokenStore, trackingService, config)

      await command.run()

      expect(tokenStore.load.calledOnce).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
      expect(configStore.read.calledOnce).to.be.true
    })
  })
})
