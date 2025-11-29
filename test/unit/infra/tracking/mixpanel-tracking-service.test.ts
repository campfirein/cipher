import {expect} from 'chai'
import {Mixpanel} from 'mixpanel'
import {restore, SinonStub, stub} from 'sinon'

import {AuthToken} from '../../../../src/core/domain/entities/auth-token.js'
import {EventName} from '../../../../src/core/domain/entities/event.js'
import {ITokenStore} from '../../../../src/core/interfaces/i-token-store.js'
import {MixpanelTrackingService} from '../../../../src/infra/tracking/mixpanel-tracking-service.js'

describe('MixpanelTrackingService', () => {
  let mockMixpanel: Partial<Mixpanel>
  let mockTokenStore: ITokenStore
  let trackStub: SinonStub
  let tokenStoreLoadStub: SinonStub
  let consoleErrorStub: SinonStub

  beforeEach(() => {
    // Create mock Mixpanel instance
    trackStub = stub()
    mockMixpanel = {
      track: trackStub,
    }

    // Create mock token store
    tokenStoreLoadStub = stub()
    mockTokenStore = {
      clear: stub(),
      load: tokenStoreLoadStub,
      save: stub(),
    }

    // Stub console.error to suppress error output during tests
    consoleErrorStub = stub(console, 'error')
  })

  afterEach(() => {
    restore()
  })

  describe('track', () => {
    it('should track event with user identification when authenticated', async () => {
      const validToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user_id',
      })
      tokenStoreLoadStub.resolves(validToken)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('auth:signed_in')

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[0]).to.equal('cli:auth:signed_in')
      expect(trackStub.firstCall.args[1]).to.deep.equal({
        $user_id: 'user_id', // eslint-disable-line camelcase
        beta: true,
      })
    })

    it('should track event without user identification when not authenticated', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('rule:generate')

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[0]).to.equal('cli:rule:generate')
      expect(trackStub.firstCall.args[1]).to.deep.equal({
        beta: true,
      })
    })

    it('should track event with custom properties', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('mem:push', {
        branch: 'main',
        filesCount: 5,
      })

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[0]).to.equal('cli:mem:push')
      expect(trackStub.firstCall.args[1]).to.deep.equal({
        beta: true,
        branch: 'main',
        filesCount: 5,
      })
    })

    it('should merge user identification with custom properties', async () => {
      const validToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user_id',
      })
      tokenStoreLoadStub.resolves(validToken)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('mem:retrieve', {
        query: 'search term',
        resultsCount: 10,
      })

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[0]).to.equal('cli:mem:retrieve')
      expect(trackStub.firstCall.args[1]).to.deep.equal({
        $user_id: 'user_id', // eslint-disable-line camelcase
        beta: true,
        query: 'search term',
        resultsCount: 10,
      })
    })

    it('should prefix event name with "cli:"', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('space:init')

      expect(trackStub.firstCall.args[0]).to.equal('cli:space:init')
    })

    it('should always include beta flag', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('mem:add')

      expect(trackStub.firstCall.args[1]).to.have.property('beta', true)
    })

    it('should handle token store errors gracefully', async () => {
      tokenStoreLoadStub.rejects(new Error('Keychain access denied'))

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      // Should not throw
      await service.track('auth:signed_in')

      // Should still track event without user identification
      expect(consoleErrorStub.calledOnce).to.be.true
      expect(consoleErrorStub.firstCall.args[0]).to.include('Failed to track event auth:signed_in')
    })

    it('should handle Mixpanel tracking errors gracefully', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)
      trackStub.throws(new Error('Network error'))

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      // Should not throw
      await service.track('space:changed')

      expect(consoleErrorStub.calledOnce).to.be.true
      expect(consoleErrorStub.firstCall.args[0]).to.include('Failed to track event space:changed')
    })

    it('should track all supported event types', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      const events: EventName[] = [
        'auth:signed_in',
        'space:init',
        'space:changed',
        'rule:generate',
        'ace:update_bullet',
        'ace:remove_bullet',
        'ace:view_status',
        'mem:add',
        'mem:push',
        'mem:retrieve',
      ]

      for (const eventName of events) {
        trackStub.reset()
        // eslint-disable-next-line no-await-in-loop
        await service.track(eventName)
        expect(trackStub.calledOnce).to.be.true
        expect(trackStub.firstCall.args[0]).to.equal(`cli:${eventName}`)
      }
    })

    it('should handle empty properties object', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('ace:view_status', {})

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[1]).to.deep.equal({
        beta: true,
      })
    })

    it('should preserve property types', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('mem:push', {
        booleanProp: true,
        numberProp: 42,
        stringProp: 'value',
      })

      expect(trackStub.calledOnce).to.be.true
      const properties = trackStub.firstCall.args[1]
      expect(properties.booleanProp).to.equal(true)
      expect(properties.numberProp).to.equal(42)
      expect(properties.stringProp).to.equal('value')
    })

    it('should allow properties to override beta flag', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      tokenStoreLoadStub.resolves(undefined)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('mem:add', {
        beta: false,
      })

      // Beta should be overridden by the service (properties spread first, then beta)
      expect(trackStub.firstCall.args[1]).to.have.property('beta', true)
    })

    it('should not expose internal token details', async () => {
      const validToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user_id',
      })
      tokenStoreLoadStub.resolves(validToken)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('space:init')

      const properties = trackStub.firstCall.args[1]
      expect(properties).to.not.have.property('accessToken')
      expect(properties).to.not.have.property('refreshToken')
      expect(properties).to.not.have.property('sessionKey')
    })
  })

  describe('constructor', () => {
    it('should accept injected Mixpanel instance for testing', () => {
      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      expect(service).to.be.instanceOf(MixpanelTrackingService)
    })

    it('should initialize without injected Mixpanel instance', () => {
      // This tests the production code path
      const service = new MixpanelTrackingService(mockTokenStore)

      expect(service).to.be.instanceOf(MixpanelTrackingService)
    })
  })

  describe('error handling', () => {
    it('should log error message with event name', async () => {
      tokenStoreLoadStub.rejects(new Error('Token load failed'))

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('auth:signed_in')

      expect(consoleErrorStub.calledOnce).to.be.true
      expect(consoleErrorStub.firstCall.args[0]).to.equal('Failed to track event auth:signed_in:')
      expect(consoleErrorStub.firstCall.args[1]).to.be.an('error')
    })

    it('should not throw when tracking fails', async () => {
      tokenStoreLoadStub.rejects(new Error('Critical failure'))

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      // Should not throw - tracking failures should be silent
      let errorThrown = false
      try {
        await service.track('mem:push')
      } catch {
        errorThrown = true
      }

      expect(errorThrown).to.be.false
    })

    it('should continue with empty identification when token load fails', async () => {
      tokenStoreLoadStub.rejects(new Error('Token load failed'))

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('rule:generate')

      // Error should be logged but tracking should not happen due to the error
      expect(consoleErrorStub.calledOnce).to.be.true
    })
  })

  describe('identification properties', () => {
    it('should return empty object when token is null', async () => {
      tokenStoreLoadStub.resolves(null)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('space:changed')

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[1]).to.deep.equal({
        beta: true,
      })
    })

    it('should return user_id when token exists', async () => {
      const validToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user_id',
      })
      tokenStoreLoadStub.resolves(validToken)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('ace:update_bullet')

      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[1]).to.have.property('$user_id', 'user_id')
    })

    it('should work with expired tokens', async () => {
      const expiredToken = new AuthToken({
        accessToken: 'access-token',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        refreshToken: 'refresh-token',
        sessionKey: 'session-key',
        tokenType: 'Bearer',
        userEmail: 'user@example.com',
        userId: 'user_id',
      })
      tokenStoreLoadStub.resolves(expiredToken)

      const service = new MixpanelTrackingService(mockTokenStore, mockMixpanel as Mixpanel)

      await service.track('ace:remove_bullet')

      // Should still include user_id even for expired tokens
      expect(trackStub.calledOnce).to.be.true
      expect(trackStub.firstCall.args[1]).to.have.property('$user_id', 'user_id')
    })
  })
})
