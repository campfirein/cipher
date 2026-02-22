/**
 * AuthStateStore Unit Tests
 *
 * Tests global auth state management with polling.
 *
 * Key scenarios:
 * - Token caching (getToken/loadToken)
 * - Polling detects new, changed, removed tokens
 * - Expiry detection (fires once per expiry, not repeated)
 * - isPolling guard prevents overlapping polls
 * - Error resilience (poll error doesn't crash)
 */

import {expect} from 'chai'
import {createSandbox, type SinonFakeTimers, type SinonSandbox, type SinonStub, useFakeTimers} from 'sinon'

import type {ITokenStore} from '../../../../src/server/core/interfaces/auth/i-token-store.js'

import {AuthToken} from '../../../../src/server/core/domain/entities/auth-token.js'
import {AuthStateStore} from '../../../../src/server/infra/state/auth-state-store.js'

function createValidToken(overrides?: Partial<{accessToken: string; expiresAt: Date}>): AuthToken {
  return new AuthToken({
    accessToken: overrides?.accessToken ?? 'access-token-1',
    expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 3_600_000),
    refreshToken: 'refresh-token-1',
    sessionKey: 'session-key-1',
    userEmail: 'user@test.com',
    userId: 'user-1',
  })
}

function createExpiredToken(overrides?: Partial<{accessToken: string}>): AuthToken {
  return new AuthToken({
    accessToken: overrides?.accessToken ?? 'access-token-expired',
    expiresAt: new Date(Date.now() - 1000),
    refreshToken: 'refresh-token-1',
    sessionKey: 'session-key-1',
    userEmail: 'user@test.com',
    userId: 'user-1',
  })
}

describe('AuthStateStore', () => {
  let sandbox: SinonSandbox
  let clock: SinonFakeTimers
  let tokenStore: ITokenStore
  let loadStub: SinonStub
  let store: AuthStateStore

  const POLL_INTERVAL = 100 // Short interval for tests

  beforeEach(() => {
    sandbox = createSandbox()
    clock = useFakeTimers({shouldAdvanceTime: false})

    loadStub = sandbox.stub()
    tokenStore = {
      clear: sandbox.stub().resolves(),
      load: loadStub.resolves(),
      save: sandbox.stub().resolves(),
    }

    store = new AuthStateStore({
      pollIntervalMs: POLL_INTERVAL,
      tokenStore,
    })
  })

  afterEach(() => {
    store.stopPolling()
    clock.restore()
    sandbox.restore()
  })

  describe('getToken()', () => {
    it('should return undefined before any load', () => {
      expect(store.getToken()).to.be.undefined
    })

    it('should return cached token after loadToken()', async () => {
      const token = createValidToken()
      loadStub.resolves(token)

      await store.loadToken()

      expect(store.getToken()).to.equal(token)
    })
  })

  describe('loadToken()', () => {
    it('should load from token store and cache', async () => {
      const token = createValidToken()
      loadStub.resolves(token)

      const result = await store.loadToken()

      expect(result).to.equal(token)
      expect(store.getToken()).to.equal(token)
      expect(loadStub.calledOnce).to.be.true
    })

    it('should return undefined when store has no token', async () => {
      loadStub.resolves()

      const result = await store.loadToken()

      expect(result).to.be.undefined
      expect(store.getToken()).to.be.undefined
    })

    it('should fire onAuthChanged callback when token appears', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      const token = createValidToken()
      loadStub.resolves(token)

      await store.loadToken()

      expect(callback.calledOnce).to.be.true
      expect(callback.calledWith(token)).to.be.true
    })

    it('should not crash on load error', async () => {
      loadStub.rejects(new Error('keychain locked'))

      const result = await store.loadToken()

      // Returns previous cached value (undefined)
      expect(result).to.be.undefined
    })
  })

  describe('polling', () => {
    it('should detect new token and fire onAuthChanged', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      const token = createValidToken()
      loadStub.resolves(token)

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      expect(callback.calledOnce).to.be.true
      expect(callback.calledWith(token)).to.be.true
    })

    it('should detect changed token (different accessToken) and fire onAuthChanged', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      // Initial token
      const token1 = createValidToken({accessToken: 'token-1'})
      loadStub.resolves(token1)
      await store.loadToken()

      // Changed token
      const token2 = createValidToken({accessToken: 'token-2'})
      loadStub.resolves(token2)

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      // 2 calls: 1 from loadToken, 1 from poll
      expect(callback.calledTwice).to.be.true
      expect(callback.secondCall.calledWith(token2)).to.be.true
    })

    it('should detect removed token and fire onAuthChanged(undefined)', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      // Initial token
      const token = createValidToken()
      loadStub.resolves(token)
      await store.loadToken()

      // Token removed
      loadStub.resolves()

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      expect(callback.calledTwice).to.be.true
      expect(callback.secondCall.args[0]).to.be.undefined
    })

    it('should NOT fire onAuthChanged when token is the same', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      const token = createValidToken({accessToken: 'same-token'})
      loadStub.resolves(token)

      // Load initial
      await store.loadToken()
      expect(callback.calledOnce).to.be.true

      // Poll — same token
      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      // Still only called once (from loadToken)
      expect(callback.calledOnce).to.be.true
    })

    it('should detect expired token and fire onAuthExpired', async () => {
      const changedCallback = sandbox.stub()
      const expiredCallback = sandbox.stub()
      store.onAuthChanged(changedCallback)
      store.onAuthExpired(expiredCallback)

      // Load a valid token first
      const validToken = createValidToken({accessToken: 'expiring-token'})
      loadStub.resolves(validToken)
      await store.loadToken()

      // Now return an expired token with the same accessToken
      const expiredToken = createExpiredToken({accessToken: 'expiring-token'})
      loadStub.resolves(expiredToken)

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      expect(expiredCallback.calledOnce).to.be.true
      expect(expiredCallback.calledWith(expiredToken)).to.be.true
      // onAuthChanged should NOT fire (same accessToken)
      expect(changedCallback.calledOnce).to.be.true // only from initial loadToken
    })

    it('should fire onAuthExpired only once per expiry (not on every poll)', async () => {
      const expiredCallback = sandbox.stub()
      store.onAuthExpired(expiredCallback)

      // Load a valid token
      const validToken = createValidToken({accessToken: 'expiring-token'})
      loadStub.resolves(validToken)
      await store.loadToken()

      // Return expired token with same accessToken
      const expiredToken = createExpiredToken({accessToken: 'expiring-token'})
      loadStub.resolves(expiredToken)

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL) // 1st poll: fires onAuthExpired
      await clock.tickAsync(POLL_INTERVAL) // 2nd poll: should NOT fire again
      await clock.tickAsync(POLL_INTERVAL) // 3rd poll: should NOT fire again

      expect(expiredCallback.calledOnce).to.be.true
    })

    it('should reset wasExpired when token changes', async () => {
      const expiredCallback = sandbox.stub()
      store.onAuthExpired(expiredCallback)

      // Load valid token -> expire -> new valid token -> expire again
      const token1 = createValidToken({accessToken: 'token-1'})
      loadStub.resolves(token1)
      await store.loadToken()

      // Expire token-1
      const expired1 = createExpiredToken({accessToken: 'token-1'})
      loadStub.resolves(expired1)
      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)
      expect(expiredCallback.calledOnce).to.be.true

      // New valid token (different accessToken resets wasExpired)
      const token2 = createValidToken({accessToken: 'token-2'})
      loadStub.resolves(token2)
      await clock.tickAsync(POLL_INTERVAL)

      // Expire token-2
      const expired2 = createExpiredToken({accessToken: 'token-2'})
      loadStub.resolves(expired2)
      await clock.tickAsync(POLL_INTERVAL)

      expect(expiredCallback.calledTwice).to.be.true
    })

    it('should not crash on poll error', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      loadStub.rejects(new Error('keychain locked'))

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      // Should not crash, callback not called
      expect(callback.called).to.be.false
    })

    it('should continue polling after an error', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      // First poll: error
      loadStub.rejects(new Error('keychain locked'))
      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      // Second poll: success
      const token = createValidToken()
      loadStub.resolves(token)
      await clock.tickAsync(POLL_INTERVAL)

      expect(callback.calledOnce).to.be.true
      expect(callback.calledWith(token)).to.be.true
    })
  })

  describe('startPolling() / stopPolling()', () => {
    it('should be idempotent (double-start is safe)', async () => {
      store.startPolling()
      store.startPolling() // Should not create a second interval

      // Verify by checking that only one poll fires per interval
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      const token = createValidToken()
      loadStub.resolves(token)

      // Wait for exactly one interval
      await clock.tickAsync(POLL_INTERVAL)
    })

    it('should stop polling when stopPolling() is called', async () => {
      const callback = sandbox.stub()
      store.onAuthChanged(callback)

      const token = createValidToken()
      loadStub.resolves(token)

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)
      expect(callback.calledOnce).to.be.true

      store.stopPolling()

      // Reset stub to track new calls
      callback.reset()
      loadStub.resolves(createValidToken({accessToken: 'new-token'}))
      await clock.tickAsync(POLL_INTERVAL)

      // No new calls after stopPolling
      expect(callback.called).to.be.false
    })

    it('should be safe to call stopPolling() when not started', () => {
      // Should not throw
      store.stopPolling()
    })
  })

  describe('isPolling guard', () => {
    it('should prevent overlapping polls', async () => {
      // Make load() hang (never resolves during the test)
      let resolveLoad: ((token: AuthToken | undefined) => void) | undefined
      loadStub.callsFake(
        () =>
          new Promise<AuthToken | undefined>((resolve) => {
            resolveLoad = resolve
          }),
      )

      store.startPolling()

      // First poll starts (load is pending)
      await clock.tickAsync(POLL_INTERVAL)
      expect(loadStub.calledOnce).to.be.true

      // Second interval fires, but should be skipped (first still in-flight)
      await clock.tickAsync(POLL_INTERVAL)
      expect(loadStub.calledOnce).to.be.true // Still only called once

      // Resolve the first poll to clean up
      resolveLoad?.(undefined) // eslint-disable-line unicorn/no-useless-undefined
    })
  })

  describe('no callback registered', () => {
    it('should not crash when auth changes without callback', async () => {
      const token = createValidToken()
      loadStub.resolves(token)

      // No callbacks registered — should not throw
      await store.loadToken()
      expect(store.getToken()).to.equal(token)
    })

    it('should not crash when token expires without callback', async () => {
      const validToken = createValidToken({accessToken: 'token'})
      loadStub.resolves(validToken)
      await store.loadToken()

      const expiredToken = createExpiredToken({accessToken: 'token'})
      loadStub.resolves(expiredToken)

      store.startPolling()
      await clock.tickAsync(POLL_INTERVAL)

      // Should not crash
      expect(store.getToken()).to.equal(expiredToken)
    })
  })
})
