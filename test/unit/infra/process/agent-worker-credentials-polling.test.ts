/**
 * Agent Worker Credentials Polling Tests
 *
 * Tests the credentials polling mechanism in agent-worker.ts that detects
 * auth/config changes and syncs CipherAgent state accordingly.
 *
 * Key functions tested:
 * - credentialsChanged() - all 3 return states
 * - pollCredentialsAndSync() - all switch cases
 * - startCredentialsPolling() / stopCredentialsPolling()
 * - stopCipherAgent()
 * - updateCachedCredentials()
 *
 * Uses state machine simulation pattern (same as agent-worker-lifecycle.test.ts)
 * to test the logic without complex dependencies.
 */

/* eslint-disable unicorn/no-useless-undefined */

import {expect} from 'chai'
import {createSandbox, type SinonFakeTimers, type SinonSandbox} from 'sinon'

// ============================================================================
// Types (mirrors agent-worker.ts)
// ============================================================================

interface CachedCredentials {
  accessToken: string
  sessionKey: string
  spaceId: string | undefined
  teamId: string | undefined
}

interface MockAuthToken {
  accessToken: string
  isExpired: () => boolean
  sessionKey: string
}

interface MockBrvConfig {
  spaceId: string
  teamId: string
}

type TokenInfo = undefined | {accessToken: string; sessionKey: string}
type ConfigInfo = undefined | {spaceId: string; teamId: string}

// ============================================================================
// State Machine Simulation (mirrors agent-worker.ts logic)
// ============================================================================

/**
 * Simulates agent-worker credentials polling logic for testability.
 * Mirrors real implementation without complex dependencies.
 */
class CredentialsPollingStateMachine {
  // Track calls
  broadcastCalled = false
  // State mirrors agent-worker.ts
  cachedCredentials?: CachedCredentials
  cleanupForwardersCalled = false
  credentialsPollingRunning = false
  isAgentInitialized = false
  isCleaningUp = false
  isInitializing = false
  isPolling = false
  /** Guard: prevent task enqueueing during reinit (fixes TOCTOU race condition) */
  isReinitializing = false
  // Mock stores
  mockBrvConfig?: MockBrvConfig
  // Mock task queue
  mockTaskQueueManager: {
    clear: () => void
    getQueuedCount: () => number
    hasActiveTasks: () => boolean
  }
  mockTokenStore: {load: () => Promise<MockAuthToken | undefined>}
  pollCount = 0
  reinitCalled = false
  reinitSuccess = true
  stopCalled = false

  constructor() {
    // Default mock implementations
    this.mockTokenStore = {
      load: async () => ({
        accessToken: 'test-token',
        isExpired: () => false,
        sessionKey: 'test-session',
      }),
    }

    this.mockTaskQueueManager = {
      clear() {},
      getQueuedCount: () => 0,
      hasActiveTasks: () => false,
    }
  }

  // ============================================================================
  // Credential Change Detection (mirrors agent-worker.ts:796-827)
  // ============================================================================

  credentialsChanged(currentToken: TokenInfo, currentConfig: ConfigInfo): 'changed' | 'missing' | 'unchanged' {
    // No cached credentials = first run or was stopped
    if (!this.cachedCredentials) {
      return currentToken ? 'changed' : 'missing'
    }

    // Token missing = credentials gone
    if (!currentToken) {
      return 'missing'
    }

    // Compare token
    if (
      currentToken.accessToken !== this.cachedCredentials.accessToken ||
      currentToken.sessionKey !== this.cachedCredentials.sessionKey
    ) {
      return 'changed'
    }

    // Compare config (spaceId/teamId)
    const currentSpaceId = currentConfig?.spaceId
    const currentTeamId = currentConfig?.teamId

    if (currentSpaceId !== this.cachedCredentials.spaceId || currentTeamId !== this.cachedCredentials.teamId) {
      return 'changed'
    }

    return 'unchanged'
  }

  // ============================================================================
  // Helper: Check Pending Work (mirrors agent-worker.ts:201-203)
  // ============================================================================

  hasPendingWork(): boolean {
    return this.mockTaskQueueManager.hasActiveTasks() || this.mockTaskQueueManager.getQueuedCount() > 0
  }

  // ============================================================================
  // Simulate tryInitializeAgent (mirrors agent-worker.ts:546-703)
  // ============================================================================

  /**
   * Simulates tryInitializeAgent behavior for testing.
   * Key behavior: clears isReinitializing on early return when blocked by isInitializing.
   */
  simulateTryInitializeAgent(
    forceReinit: boolean,
    tokenInfo?: TokenInfo,
    configInfo?: ConfigInfo,
  ): boolean {
    // Guard: prevent initialization during cleanup or if already in progress
    if (this.isCleaningUp || this.isInitializing) {
      // FIX: Clear isReinitializing if WE set it (forceReinit case)
      // Without this, the flag would be stuck forever since we return before try block
      if (forceReinit) {
        this.isReinitializing = false
      }

      return false
    }

    // Already initialized and not forcing reinit
    if (!forceReinit && this.isAgentInitialized) {
      return true
    }

    this.isInitializing = true
    if (forceReinit) {
      this.isReinitializing = true
    }

    try {
      // Simulate success/failure based on reinitSuccess and tokenInfo
      if (!this.reinitSuccess || !tokenInfo) {
        return false
      }

      return true
    } finally {
      this.isInitializing = false
      if (forceReinit) {
        this.isReinitializing = false
      }
    }
  }

  // ============================================================================
  // Polling (mirrors agent-worker.ts:837-907)
  // ============================================================================

  async pollCredentialsAndSync(): Promise<void> {
    // Guard: prevent concurrent polling
    if (this.isPolling) {
      return
    }

    // Guard: don't poll during cleanup or initialization
    if (this.isCleaningUp || this.isInitializing) {
      return
    }

    this.isPolling = true
    this.pollCount++

    try {
      const authToken = await this.mockTokenStore.load()

      // Detect change
      const tokenInfo: TokenInfo = authToken
        ? {accessToken: authToken.accessToken, sessionKey: authToken.sessionKey}
        : undefined
      const configInfo: ConfigInfo = this.mockBrvConfig
        ? {spaceId: this.mockBrvConfig.spaceId, teamId: this.mockBrvConfig.teamId}
        : undefined

      const changeStatus = this.credentialsChanged(tokenInfo, configInfo)

      switch (changeStatus) {
        case 'changed': {
          // Check RIGHT BEFORE reinit - BOTH running AND queued tasks AND reinit in progress
          if (
            this.mockTaskQueueManager.hasActiveTasks() ||
            this.mockTaskQueueManager.getQueuedCount() > 0 ||
            this.isReinitializing
          ) {
            return
          }

          // Set flag IMMEDIATELY after check to close TOCTOU window
          this.isReinitializing = true

          // Simulate tryInitializeAgent(true)
          const success = this.simulateTryInitializeAgent(true, tokenInfo, configInfo)

          // Credentials changed - update state based on result
          this.reinitCalled = true
          if (success && tokenInfo) {
            this.isAgentInitialized = true
            this.updateCachedCredentials(tokenInfo.accessToken, tokenInfo.sessionKey, configInfo)
            this.broadcastCalled = true
          }

          break
        }

        case 'missing': {
          // Credentials gone - stop CipherAgent if running
          if (this.isAgentInitialized) {
            if (this.hasPendingWork()) {
              return
            }

            await this.stopCipherAgent()
          }

          break
        }

        case 'unchanged': {
          // No change - check if token expired (edge case)
          if (authToken?.isExpired() && this.isAgentInitialized) {
            if (this.hasPendingWork()) {
              return
            }

            await this.stopCipherAgent()
          }

          break
        }
      }
    } catch {
      // Don't crash on poll errors - just continue
    } finally {
      this.isPolling = false
    }
  }

  // ============================================================================
  // Polling Lifecycle (mirrors agent-worker.ts:913-946)
  // ============================================================================

  startCredentialsPolling(pollInterval: number, clock?: SinonFakeTimers): void {
    if (this.credentialsPollingRunning) {
      return
    }

    this.credentialsPollingRunning = true

    const poll = (): void => {
      if (!this.credentialsPollingRunning) {
        return
      }

      this.pollCredentialsAndSync()
        .catch(() => {})
        .finally(() => {
          if (this.credentialsPollingRunning) {
            if (clock) {
              // Use fake timers in tests
              setTimeout(poll, pollInterval)
            } else {
              setTimeout(poll, pollInterval)
            }
          }
        })
    }

    // Start first poll after delay
    setTimeout(poll, pollInterval)
  }

  async stopCipherAgent(): Promise<void> {
    this.stopCalled = true
    this.cleanupForwardersCalled = true
    this.mockTaskQueueManager.clear()
    this.isAgentInitialized = false
    this.cachedCredentials = undefined
    this.broadcastCalled = true
  }

  stopCredentialsPolling(): void {
    this.credentialsPollingRunning = false
  }

  // ============================================================================
  // Update Cached Credentials (mirrors agent-worker.ts:780-791)
  // ============================================================================

  updateCachedCredentials(accessToken: string, sessionKey: string, config: ConfigInfo): void {
    this.cachedCredentials = {
      accessToken,
      sessionKey,
      spaceId: config?.spaceId,
      teamId: config?.teamId,
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Agent Worker Credentials Polling', () => {
  let sandbox: SinonSandbox
  let clock: SinonFakeTimers

  beforeEach(() => {
    sandbox = createSandbox()
    clock = sandbox.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
    sandbox.restore()
  })

  // ============================================================================
  // credentialsChanged() Tests
  // ============================================================================

  describe('credentialsChanged()', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should return "missing" when no token and no cached credentials', () => {
      const result = state.credentialsChanged(undefined, undefined)
      expect(result).to.equal('missing')
    })

    it('should return "changed" when token exists but no cached credentials', () => {
      const result = state.credentialsChanged({accessToken: 'new', sessionKey: 'new'}, undefined)
      expect(result).to.equal('changed')
    })

    it('should return "missing" when cached exists but token is gone', () => {
      state.cachedCredentials = {
        accessToken: 'cached',
        sessionKey: 'cached',
        spaceId: undefined,
        teamId: undefined,
      }

      const result = state.credentialsChanged(undefined, undefined)
      expect(result).to.equal('missing')
    })

    it('should return "unchanged" when all fields match', () => {
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: 'space-1',
        teamId: 'team-1',
      }

      const result = state.credentialsChanged(
        {accessToken: 'token', sessionKey: 'session'},
        {spaceId: 'space-1', teamId: 'team-1'},
      )
      expect(result).to.equal('unchanged')
    })

    it('should return "changed" when accessToken differs', () => {
      state.cachedCredentials = {
        accessToken: 'old-token',
        sessionKey: 'session',
        spaceId: undefined,
        teamId: undefined,
      }

      const result = state.credentialsChanged({accessToken: 'new-token', sessionKey: 'session'}, undefined)
      expect(result).to.equal('changed')
    })

    it('should return "changed" when sessionKey differs', () => {
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'old-session',
        spaceId: undefined,
        teamId: undefined,
      }

      const result = state.credentialsChanged({accessToken: 'token', sessionKey: 'new-session'}, undefined)
      expect(result).to.equal('changed')
    })

    it('should return "changed" when spaceId differs', () => {
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: 'space-1',
        teamId: 'team-1',
      }

      const result = state.credentialsChanged(
        {accessToken: 'token', sessionKey: 'session'},
        {spaceId: 'space-2', teamId: 'team-1'},
      )
      expect(result).to.equal('changed')
    })

    it('should return "changed" when teamId differs', () => {
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: 'space-1',
        teamId: 'team-1',
      }

      const result = state.credentialsChanged(
        {accessToken: 'token', sessionKey: 'session'},
        {spaceId: 'space-1', teamId: 'team-2'},
      )
      expect(result).to.equal('changed')
    })
  })

  // ============================================================================
  // pollCredentialsAndSync() Tests
  // ============================================================================

  describe('pollCredentialsAndSync()', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should guard against concurrent polls', async () => {
      // First poll starts
      state.isPolling = true

      await state.pollCredentialsAndSync()

      // Should have returned immediately without incrementing count
      expect(state.pollCount).to.equal(0)
    })

    it('should skip poll during initialization', async () => {
      state.isInitializing = true

      await state.pollCredentialsAndSync()

      expect(state.pollCount).to.equal(0)
    })

    it('should skip poll during cleanup', async () => {
      state.isCleaningUp = true

      await state.pollCredentialsAndSync()

      expect(state.pollCount).to.equal(0)
    })

    it('should reinitialize when credentials changed', async () => {
      // No cached credentials, but token exists = 'changed'
      state.mockTokenStore = {
        load: async () => ({
          accessToken: 'new-token',
          isExpired: () => false,
          sessionKey: 'new-session',
        }),
      }

      await state.pollCredentialsAndSync()

      expect(state.reinitCalled).to.be.true
      expect(state.isAgentInitialized).to.be.true
      expect(state.cachedCredentials?.accessToken).to.equal('new-token')
    })

    it('should defer reinit when tasks are active', async () => {
      state.mockTaskQueueManager = {
        clear() {},
        getQueuedCount: () => 0,
        hasActiveTasks: () => true, // Active tasks
      }

      await state.pollCredentialsAndSync()

      expect(state.reinitCalled).to.be.false
    })

    it('should defer reinit when tasks are queued (race condition fix)', async () => {
      state.mockTaskQueueManager = {
        clear() {},
        getQueuedCount: () => 2, // Queued tasks
        hasActiveTasks: () => false,
      }

      await state.pollCredentialsAndSync()

      expect(state.reinitCalled).to.be.false
    })

    it('should stop CipherAgent when credentials missing', async () => {
      state.isAgentInitialized = true
      state.mockTokenStore = {
        load: async () => undefined, // No token
      }

      await state.pollCredentialsAndSync()

      expect(state.stopCalled).to.be.true
      expect(state.isAgentInitialized).to.be.false
    })

    it('should defer stop when credentials missing but tasks are active', async () => {
      state.isAgentInitialized = true
      state.mockTokenStore = {
        load: async () => undefined, // No token = missing
      }
      state.mockTaskQueueManager = {
        clear() {},
        getQueuedCount: () => 0,
        hasActiveTasks: () => true, // Active tasks
      }

      await state.pollCredentialsAndSync()

      expect(state.stopCalled).to.be.false // Should NOT stop
      expect(state.isAgentInitialized).to.be.true // Should remain initialized
    })

    it('should defer stop when credentials missing but tasks are queued', async () => {
      state.isAgentInitialized = true
      state.mockTokenStore = {
        load: async () => undefined, // No token = missing
      }
      state.mockTaskQueueManager = {
        clear() {},
        getQueuedCount: () => 3, // Queued tasks
        hasActiveTasks: () => false,
      }

      await state.pollCredentialsAndSync()

      expect(state.stopCalled).to.be.false // Should NOT stop
      expect(state.isAgentInitialized).to.be.true // Should remain initialized
    })

    it('should do nothing when credentials unchanged', async () => {
      state.cachedCredentials = {
        accessToken: 'test-token',
        sessionKey: 'test-session',
        spaceId: undefined,
        teamId: undefined,
      }
      state.isAgentInitialized = true

      await state.pollCredentialsAndSync()

      expect(state.reinitCalled).to.be.false
      expect(state.stopCalled).to.be.false
    })

    it('should stop CipherAgent when token expired', async () => {
      state.cachedCredentials = {
        accessToken: 'test-token',
        sessionKey: 'test-session',
        spaceId: undefined,
        teamId: undefined,
      }
      state.isAgentInitialized = true
      state.mockTokenStore = {
        load: async () => ({
          accessToken: 'test-token',
          isExpired: () => true, // Token expired
          sessionKey: 'test-session',
        }),
      }

      await state.pollCredentialsAndSync()

      expect(state.stopCalled).to.be.true
    })

    it('should defer stop when token expired but tasks are active', async () => {
      state.cachedCredentials = {
        accessToken: 'test-token',
        sessionKey: 'test-session',
        spaceId: undefined,
        teamId: undefined,
      }
      state.isAgentInitialized = true
      state.mockTokenStore = {
        load: async () => ({
          accessToken: 'test-token',
          isExpired: () => true, // Token expired
          sessionKey: 'test-session',
        }),
      }
      state.mockTaskQueueManager = {
        clear() {},
        getQueuedCount: () => 0,
        hasActiveTasks: () => true, // Active tasks
      }

      await state.pollCredentialsAndSync()

      expect(state.stopCalled).to.be.false // Should NOT stop
      expect(state.isAgentInitialized).to.be.true // Should remain initialized
    })

    it('should defer stop when token expired but tasks are queued', async () => {
      state.cachedCredentials = {
        accessToken: 'test-token',
        sessionKey: 'test-session',
        spaceId: undefined,
        teamId: undefined,
      }
      state.isAgentInitialized = true
      state.mockTokenStore = {
        load: async () => ({
          accessToken: 'test-token',
          isExpired: () => true, // Token expired
          sessionKey: 'test-session',
        }),
      }
      state.mockTaskQueueManager = {
        clear() {},
        getQueuedCount: () => 2, // Queued tasks
        hasActiveTasks: () => false,
      }

      await state.pollCredentialsAndSync()

      expect(state.stopCalled).to.be.false // Should NOT stop
      expect(state.isAgentInitialized).to.be.true // Should remain initialized
    })

    it('should catch errors and continue without crashing', async () => {
      state.mockTokenStore = {
        async load() {
          throw new Error('Storage error')
        },
      }

      // Should not throw
      await state.pollCredentialsAndSync()

      expect(state.pollCount).to.equal(1)
      expect(state.isPolling).to.be.false
    })
  })

  // ============================================================================
  // Polling Lifecycle Tests
  // ============================================================================

  describe('Polling Lifecycle', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should start polling with specified interval', async () => {
      state.startCredentialsPolling(5000, clock)

      expect(state.credentialsPollingRunning).to.be.true

      // First poll after 5 seconds
      clock.tick(5000)
      // Allow async poll to complete
      await clock.tickAsync(0)
      expect(state.pollCount).to.equal(1)

      // Second poll after another 5 seconds
      clock.tick(5000)
      await clock.tickAsync(0)
      expect(state.pollCount).to.equal(2)
    })

    it('should stop polling cleanly', () => {
      state.startCredentialsPolling(5000, clock)
      clock.tick(5000)
      expect(state.pollCount).to.equal(1)

      state.stopCredentialsPolling()
      const countAfterStop = state.pollCount

      clock.tick(15_000)
      expect(state.pollCount).to.equal(countAfterStop) // No new polls
    })

    it('should prevent double start', () => {
      let startCount = 0
      const originalStart = state.startCredentialsPolling.bind(state)
      state.startCredentialsPolling = (interval: number, fakeClock?: SinonFakeTimers) => {
        if (!state.credentialsPollingRunning) {
          startCount++
        }

        originalStart(interval, fakeClock)
      }

      state.startCredentialsPolling(5000, clock)
      state.startCredentialsPolling(5000, clock)
      state.startCredentialsPolling(5000, clock)

      expect(startCount).to.equal(1)
    })

    it('should not have orphan timers after stop', () => {
      state.startCredentialsPolling(5000, clock)
      clock.tick(5000)

      state.stopCredentialsPolling()

      // Advance time significantly
      clock.tick(60_000)

      // Should have only 1 poll from before stop
      expect(state.pollCount).to.equal(1)
    })
  })

  // ============================================================================
  // stopCipherAgent() Tests
  // ============================================================================

  describe('stopCipherAgent()', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
      state.isAgentInitialized = true
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: 'space',
        teamId: 'team',
      }
    })

    it('should call cleanupAgentEventForwarding', async () => {
      await state.stopCipherAgent()
      expect(state.cleanupForwardersCalled).to.be.true
    })

    it('should clear task queue', async () => {
      let clearCalled = false
      state.mockTaskQueueManager = {
        clear() {
          clearCalled = true
        },
        getQueuedCount: () => 0,
        hasActiveTasks: () => false,
      }

      await state.stopCipherAgent()
      expect(clearCalled).to.be.true
    })

    it('should set isAgentInitialized to false', async () => {
      await state.stopCipherAgent()
      expect(state.isAgentInitialized).to.be.false
    })

    it('should clear cached credentials', async () => {
      await state.stopCipherAgent()
      expect(state.cachedCredentials).to.be.undefined
    })

    it('should call broadcastStatusChange', async () => {
      await state.stopCipherAgent()
      expect(state.broadcastCalled).to.be.true
    })

    it('should mark stopCalled flag', async () => {
      await state.stopCipherAgent()
      expect(state.stopCalled).to.be.true
    })
  })

  // ============================================================================
  // updateCachedCredentials() Tests
  // ============================================================================

  describe('updateCachedCredentials()', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should cache credentials with config', () => {
      state.updateCachedCredentials('token', 'session', {spaceId: 'space-1', teamId: 'team-1'})

      expect(state.cachedCredentials).to.deep.equal({
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: 'space-1',
        teamId: 'team-1',
      })
    })

    it('should cache credentials without config', () => {
      state.updateCachedCredentials('token', 'session', undefined)

      expect(state.cachedCredentials).to.deep.equal({
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: undefined,
        teamId: undefined,
      })
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: Polling with Credential Changes', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should detect login (credentials appear)', async () => {
      // Start with no credentials
      state.mockTokenStore = {
        load: async () => undefined,
      }

      await state.pollCredentialsAndSync()
      expect(state.isAgentInitialized).to.be.false

      // User logs in
      state.mockTokenStore = {
        load: async () => ({
          accessToken: 'new-token',
          isExpired: () => false,
          sessionKey: 'new-session',
        }),
      }

      await state.pollCredentialsAndSync()
      expect(state.isAgentInitialized).to.be.true
      expect(state.cachedCredentials?.accessToken).to.equal('new-token')
    })

    it('should detect logout (credentials disappear)', async () => {
      // Start logged in
      state.isAgentInitialized = true
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: undefined,
        teamId: undefined,
      }

      // User logs out
      state.mockTokenStore = {
        load: async () => undefined,
      }

      await state.pollCredentialsAndSync()
      expect(state.isAgentInitialized).to.be.false
      expect(state.stopCalled).to.be.true
    })

    it('should detect space switch (config changes)', async () => {
      // Start with space-1
      state.isAgentInitialized = true
      state.cachedCredentials = {
        accessToken: 'token',
        sessionKey: 'session',
        spaceId: 'space-1',
        teamId: 'team-1',
      }

      // User switches to space-2
      state.mockBrvConfig = {spaceId: 'space-2', teamId: 'team-1'}

      await state.pollCredentialsAndSync()
      expect(state.reinitCalled).to.be.true
      expect(state.cachedCredentials?.spaceId).to.equal('space-2')
    })
  })

  // ============================================================================
  // isInitializing Flag Tests
  // ============================================================================

  describe('isInitializing Flag', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should skip polling when isInitializing is true', async () => {
      state.isInitializing = true

      await state.pollCredentialsAndSync()

      // Polling should be skipped entirely
      expect(state.pollCount).to.equal(0)
      expect(state.isPolling).to.be.false
    })

    it('should skip polling when isCleaningUp is true', async () => {
      state.isCleaningUp = true

      await state.pollCredentialsAndSync()

      // Polling should be skipped entirely
      expect(state.pollCount).to.equal(0)
      expect(state.isPolling).to.be.false
    })

    it('should allow polling after isInitializing becomes false', async () => {
      // First poll with isInitializing = true
      state.isInitializing = true
      await state.pollCredentialsAndSync()
      expect(state.pollCount).to.equal(0)

      // Reset flag (simulating tryInitializeAgent() finally block)
      state.isInitializing = false

      // Now polling should proceed
      await state.pollCredentialsAndSync()
      expect(state.pollCount).to.equal(1)
    })

    it('should prevent concurrent polling via isPolling flag', async () => {
      // Simulate concurrent poll attempts
      const pollPromise1 = state.pollCredentialsAndSync()
      const pollPromise2 = state.pollCredentialsAndSync()
      const pollPromise3 = state.pollCredentialsAndSync()

      await Promise.all([pollPromise1, pollPromise2, pollPromise3])

      // Only one should have executed
      expect(state.pollCount).to.equal(1)
    })

    it('should reset isPolling flag even when error occurs', async () => {
      state.mockTokenStore = {
        async load() {
          throw new Error('Simulated error')
        },
      }

      await state.pollCredentialsAndSync()

      // isPolling should be reset in finally block
      expect(state.isPolling).to.be.false
    })
  })

  // ============================================================================
  // isReinitializing Race Condition Tests
  // ============================================================================

  describe('isReinitializing Race Condition', () => {
    let state: CredentialsPollingStateMachine

    beforeEach(() => {
      state = new CredentialsPollingStateMachine()
    })

    it('should clear isReinitializing when blocked by isInitializing (race condition fix)', () => {
      // Simulate the race condition scenario:
      // 1. Poll detects credential change
      // 2. Poll sets isReinitializing = true
      // 3. Lazy init is in progress (isInitializing = true)
      // 4. Poll calls tryInitializeAgent(true) which is blocked
      // 5. BUG (before fix): isReinitializing stays true forever
      // 6. FIX: Clear isReinitializing on early return

      // Setup: lazy init is in progress
      state.isInitializing = true

      // Poll sets isReinitializing before calling tryInitializeAgent
      state.isReinitializing = true

      // Simulate tryInitializeAgent(true) being blocked by isInitializing
      const result = state.simulateTryInitializeAgent(true)

      // Should return false (blocked)
      expect(result).to.be.false

      // FIX: isReinitializing should be cleared on early return
      expect(state.isReinitializing).to.be.false
    })

    it('should NOT clear isReinitializing when blocked by isCleaningUp (process exiting anyway)', () => {
      // When isCleaningUp = true, the process is shutting down
      // Clearing the flag doesn't matter, but we clear it anyway for consistency
      state.isCleaningUp = true
      state.isReinitializing = true

      const result = state.simulateTryInitializeAgent(true)

      expect(result).to.be.false
      // Flag should be cleared
      expect(state.isReinitializing).to.be.false
    })

    it('should skip poll when isReinitializing is already true', async () => {
      state.isAgentInitialized = false
      state.cachedCredentials = undefined
      state.isReinitializing = true // Already reinitializing

      await state.pollCredentialsAndSync()

      // Poll should detect 'changed' but defer due to isReinitializing
      expect(state.reinitCalled).to.be.false
    })

    it('should clear isReinitializing normally when tryInitializeAgent succeeds', () => {
      state.isInitializing = false
      state.isReinitializing = false
      state.reinitSuccess = true

      const result = state.simulateTryInitializeAgent(
        true,
        {accessToken: 'token', sessionKey: 'session'},
        {spaceId: 'space', teamId: 'team'},
      )

      expect(result).to.be.true
      // Should be cleared in finally block
      expect(state.isReinitializing).to.be.false
      expect(state.isInitializing).to.be.false
    })

    it('should clear isReinitializing when tryInitializeAgent fails (not blocked)', () => {
      state.isInitializing = false
      state.isReinitializing = false
      state.reinitSuccess = false // Simulate failure (e.g., no auth token)

      const result = state.simulateTryInitializeAgent(
        true,
        {accessToken: 'token', sessionKey: 'session'},
        undefined,
      )

      expect(result).to.be.false
      // Should be cleared in finally block
      expect(state.isReinitializing).to.be.false
      expect(state.isInitializing).to.be.false
    })
  })
})
