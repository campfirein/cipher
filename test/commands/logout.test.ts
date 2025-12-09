import type {Config} from '@oclif/core'
import type {SinonStubbedInstance} from 'sinon'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IGlobalConfigStore} from '../../src/core/interfaces/i-global-config-store.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Logout from '../../src/commands/logout.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'

class TestableLogout extends Logout {
  private mockConfirmResult = true
  private readonly mockGlobalConfigStore: IGlobalConfigStore
  private readonly mockTokenStore: ITokenStore
  private readonly mockTrackingService: ITrackingService

  public constructor(
    args: string[],
    mockTokenStore: ITokenStore,
    mockTrackingService: ITrackingService,
    mockGlobalConfigStore: IGlobalConfigStore,
    config: Config,
  ) {
    super(args, config)
    this.mockGlobalConfigStore = mockGlobalConfigStore
    this.mockTokenStore = mockTokenStore
    this.mockTrackingService = mockTrackingService
  }

  protected async confirmLogout(_userEmail: string): Promise<boolean> {
    return this.mockConfirmResult
  }

  protected createServices(): {
    globalConfigStore: IGlobalConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    return {
      globalConfigStore: this.mockGlobalConfigStore,
      tokenStore: this.mockTokenStore,
      trackingService: this.mockTrackingService,
    }
  }

  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {}

  public setConfirmResult(result: boolean): void {
    this.mockConfirmResult = result
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

describe('logout command', () => {
  let globalConfigStore: SinonStubbedInstance<IGlobalConfigStore>
  let tokenStore: SinonStubbedInstance<ITokenStore>
  let trackingService: SinonStubbedInstance<ITrackingService>
  let config: Config

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    globalConfigStore = {
      getOrCreateDeviceId: stub<[], Promise<string>>().resolves('test-device-id'),
      read: stub(),
      regenerateDeviceId: stub<[], Promise<string>>().resolves('new-device-id'),
      write: stub(),
    }

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('Successful logout flow', () => {
    it('should logout successfully when user is authenticated and confirms', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()
      trackingService.track.resolves()

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      await command.run()

      // Verify complete flow
      expect(tokenStore.load.calledOnce).to.be.true
      expect(trackingService.track.calledOnce).to.be.true
      expect(trackingService.track.calledWith('auth:signed_out')).to.be.true
      expect(tokenStore.clear.calledOnce).to.be.true
    })

    it('should skip confirmation and logout when --yes flag is used', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()
      trackingService.track.resolves()

      const command = new TestableLogout(['--yes'], tokenStore, trackingService, globalConfigStore, config)

      // Confirmation should not be called, so we can't control it
      await command.run()

      // Verify logout succeeded without confirmation
      expect(tokenStore.clear.calledOnce).to.be.true
      expect(trackingService.track.calledWith('auth:signed_out')).to.be.true
    })

    it('should pass user email to confirmation when prompting', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()

      // Create a spy version to track calls
      let capturedEmail = ''
      class SpyLogout extends TestableLogout {
        protected async confirmLogout(userEmail: string): Promise<boolean> {
          capturedEmail = userEmail
          return true
        }
      }

      const command = new SpyLogout([], tokenStore, trackingService, globalConfigStore, config)
      await command.run()

      // Verify confirmation was called with correct email
      expect(capturedEmail).to.equal(mockToken.userEmail)
      expect(tokenStore.clear.calledOnce).to.be.true
    })
  })

  describe('Already logged out', () => {
    it('should display message when no token exists', async () => {
      tokenStore.load.resolves()

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)

      await command.run()

      // Verify no logout actions were taken
      expect(tokenStore.clear.called).to.be.false
      expect(trackingService.track.called).to.be.false
    })
  })

  describe('User cancels logout', () => {
    it('should not logout when user declines confirmation', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(false)

      await command.run()

      // Verify token was NOT cleared
      expect(tokenStore.clear.called).to.be.false
      expect(trackingService.track.called).to.be.false
    })
  })

  describe('Tracking event order', () => {
    it('should track sign_out event BEFORE clearing token', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      await command.run()

      // Verify tracking was called before clear
      expect(trackingService.track.calledBefore(tokenStore.clear)).to.be.true
      expect(trackingService.track.calledWith('auth:signed_out')).to.be.true
    })

    it('should continue logout even if tracking fails', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()
      trackingService.track.rejects(new Error('Tracking service unavailable'))

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      // Should not throw error
      await command.run()

      // Verify logout still completed
      expect(tokenStore.clear.calledOnce).to.be.true
    })
  })

  describe('Error handling', () => {
    it('should display clear error message for keychain access errors', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.rejects(new Error('Failed to access keychain'))

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Unable to access system keychain')
      }
    })

    it('should handle generic errors gracefully', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.rejects(new Error('Unexpected error'))

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Unexpected error')
      }
    })

    it('should handle token load errors', async () => {
      tokenStore.load.rejects(new Error('Failed to load token'))

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to load token')
      }

      // Verify clear was not attempted
      expect(tokenStore.clear.called).to.be.false
    })
  })

  describe('Flag behavior', () => {
    it('should support short flag -y for yes', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()

      // Create command with -y flag
      const command = new TestableLogout(['-y'], tokenStore, trackingService, globalConfigStore, config)
      await command.run()

      // Verify logout succeeded
      expect(tokenStore.clear.calledOnce).to.be.true
    })
  })

  describe('Device ID regeneration', () => {
    it('should regenerate device ID after successful logout', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()
      globalConfigStore.regenerateDeviceId.resolves('new-device-id')

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      await command.run()

      expect(globalConfigStore.regenerateDeviceId.calledOnce).to.be.true
    })

    it('should regenerate device ID AFTER tracking sign-out event', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      await command.run()

      expect(trackingService.track.calledBefore(globalConfigStore.regenerateDeviceId)).to.be.true
    })

    it('should regenerate device ID AFTER clearing token', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      await command.run()

      expect(tokenStore.clear.calledBefore(globalConfigStore.regenerateDeviceId)).to.be.true
    })

    it('should NOT regenerate device ID when user cancels logout', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(false)

      await command.run()

      expect(globalConfigStore.regenerateDeviceId.called).to.be.false
    })

    it('should NOT regenerate device ID when not logged in', async () => {
      tokenStore.load.resolves()

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)

      await command.run()

      expect(globalConfigStore.regenerateDeviceId.called).to.be.false
    })

    it('should continue logout even if device ID regeneration fails', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()
      globalConfigStore.regenerateDeviceId.rejects(new Error('Config store error'))

      const command = new TestableLogout([], tokenStore, trackingService, globalConfigStore, config)
      command.setConfirmResult(true)

      // Should not throw
      await command.run()

      // Verify logout still completed
      expect(tokenStore.clear.calledOnce).to.be.true
    })

    it('should regenerate device ID when using --yes flag', async () => {
      const mockToken = createMockToken()
      tokenStore.load.resolves(mockToken)
      tokenStore.clear.resolves()

      const command = new TestableLogout(['--yes'], tokenStore, trackingService, globalConfigStore, config)

      await command.run()

      expect(globalConfigStore.regenerateDeviceId.calledOnce).to.be.true
    })
  })
})
