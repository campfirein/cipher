/**
 * Agent Worker Lifecycle Tests
 *
 * Tests for agent initialization, reinitialization, cleanup, and process lifecycle patterns.
 * These tests validate the patterns used in agent-worker.ts without depending on actual
 * process spawning.
 *
 * Key scenarios:
 * - Initialization state management
 * - Config change detection
 * - Concurrent initialization prevention (guard pattern)
 * - Double cleanup prevention (guard pattern)
 * - IPC message handling patterns
 * - Signal handler cleanup
 */

/* eslint-disable no-await-in-loop, no-promise-executor-return, no-unmodified-loop-condition */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {AgentIPCResponse, IPCCommand} from '../../../../src/infra/process/ipc-types.js'

describe('Agent Worker Lifecycle', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('Initialization State Machine', () => {
    /**
     * Simulates the agent initialization state machine from agent-worker.ts
     */
    class InitializationStateMachine {
      public initializationError: Error | undefined
      public isAgentInitialized = false
      private initCount = 0
      private isInitializing = false
      private mockAuthToken: undefined | {accessToken: string; sessionKey: string}
      private mockBrvConfig: undefined | {spaceId: string; teamId: string}
      private shouldThrowOnStart: Error | undefined

      constructor() {
        // Default to having auth token
        this.mockAuthToken = {accessToken: 'test-token', sessionKey: 'test-session'}
      }

      clearAuth(): void {
        this.mockAuthToken = undefined
      }

      getInitCount(): number {
        return this.initCount
      }

      getIsInitializing(): boolean {
        return this.isInitializing
      }

      setConfig(config: undefined | {spaceId: string; teamId: string}): void {
        this.mockBrvConfig = config
      }

      setThrowOnStart(error: Error | undefined): void {
        this.shouldThrowOnStart = error
      }

      async tryInitializeAgent(forceReinit = false): Promise<boolean> {
        // Guard: prevent concurrent initialization
        if (this.isInitializing) {
          return false
        }

        // Already initialized and not forcing reinit
        if (!forceReinit && this.isAgentInitialized) {
          return true
        }

        this.isInitializing = true

        try {
          // If forcing reinit, cleanup first
          if (forceReinit && this.isAgentInitialized) {
            this.isAgentInitialized = false
          }

          // Simulate auth check
          if (!this.mockAuthToken) {
            this.initializationError = new Error('NotAuthenticatedError')
            return false
          }

          // Simulate agent.start() throwing (e.g., SQLite module mismatch)
          if (this.shouldThrowOnStart) {
            throw this.shouldThrowOnStart
          }

          // Simulate agent creation
          this.initCount++

          this.isAgentInitialized = true
          this.initializationError = undefined
          return true
        } catch (error) {
          // NEW: Catch errors and return false instead of throwing
          // This matches the fix in agent-worker.ts
          this.initializationError = error instanceof Error ? error : new Error(String(error))
          return false
        } finally {
          this.isInitializing = false
        }
      }
    }

    it('should transition from uninitialized to initialized on first call', async () => {
      const state = new InitializationStateMachine()

      expect(state.isAgentInitialized).to.be.false

      const result = await state.tryInitializeAgent()

      expect(result).to.be.true
      expect(state.isAgentInitialized).to.be.true
      expect(state.getInitCount()).to.equal(1)
    })

    it('should not reinitialize if already initialized', async () => {
      const state = new InitializationStateMachine()

      await state.tryInitializeAgent()
      expect(state.getInitCount()).to.equal(1)

      // Second call without forceReinit
      await state.tryInitializeAgent()
      expect(state.getInitCount()).to.equal(1) // Still 1
    })

    it('should reinitialize when forceReinit is true', async () => {
      const state = new InitializationStateMachine()

      await state.tryInitializeAgent()
      expect(state.getInitCount()).to.equal(1)

      // Force reinit
      await state.tryInitializeAgent(true)
      expect(state.getInitCount()).to.equal(2)
    })

    it('should fail initialization without auth token', async () => {
      const state = new InitializationStateMachine()
      state.clearAuth()

      const result = await state.tryInitializeAgent()

      expect(result).to.be.false
      expect(state.isAgentInitialized).to.be.false
      expect(state.initializationError?.message).to.equal('NotAuthenticatedError')
    })

    // NOTE: Config change detection tests removed - use explicit agent:restart event instead

    describe('Error Handling on Init Failure (ENG-805 fix)', () => {
      it('should return false when agent.start() throws (instead of crashing)', async () => {
        const state = new InitializationStateMachine()
        const sqliteError = new Error('SQLite module version mismatch: NODE_MODULE_VERSION 127 vs 141')
        state.setThrowOnStart(sqliteError)

        // This should NOT throw - it should return false
        const result = await state.tryInitializeAgent()

        expect(result).to.be.false
        expect(state.isAgentInitialized).to.be.false
      })

      it('should set initializationError when agent.start() throws', async () => {
        const state = new InitializationStateMachine()
        const blobError = new Error('Blob storage initialization error: SQLite native module failed')
        state.setThrowOnStart(blobError)

        await state.tryInitializeAgent()

        expect(state.initializationError).to.not.be.undefined
        expect(state.initializationError?.message).to.equal(blobError.message)
      })

      it('should reset isInitializing flag even when error occurs', async () => {
        const state = new InitializationStateMachine()
        state.setThrowOnStart(new Error('Any initialization error'))

        await state.tryInitializeAgent()

        // isInitializing should be reset to false in finally block
        expect(state.getIsInitializing()).to.be.false
      })

      it('should allow retry after initialization error', async () => {
        const state = new InitializationStateMachine()

        // First attempt fails
        state.setThrowOnStart(new Error('Temporary error'))
        const result1 = await state.tryInitializeAgent()
        expect(result1).to.be.false
        expect(state.initializationError?.message).to.equal('Temporary error')

        // Fix the issue and retry
        state.setThrowOnStart(undefined) // Clear the error condition
        const result2 = await state.tryInitializeAgent()
        expect(result2).to.be.true
        expect(state.isAgentInitialized).to.be.true
        expect(state.initializationError).to.be.undefined
      })

      it('should handle non-Error thrown objects', async () => {
        const state = new InitializationStateMachine()
        // Test with a string thrown (edge case)
        state.setThrowOnStart({message: 'String error thrown'} as Error)

        const result = await state.tryInitializeAgent()

        expect(result).to.be.false
        expect(state.initializationError).to.be.instanceOf(Error)
      })
    })
  })

  describe('Concurrent Initialization Guard', () => {
    it('should prevent concurrent initialization calls', async () => {
      let isInitializing = false
      let initCount = 0
      let concurrentAttempts = 0

      const tryInitialize = async (): Promise<boolean> => {
        if (isInitializing) {
          concurrentAttempts++
          return false
        }

        isInitializing = true
        try {
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 10))
          initCount++
          return true
        } finally {
          isInitializing = false
        }
      }

      // Launch 5 concurrent initialization attempts
      const promises = [
        tryInitialize(),
        tryInitialize(),
        tryInitialize(),
        tryInitialize(),
        tryInitialize(),
      ]

      const results = await Promise.all(promises)

      // Only one should succeed
      const successes = results.filter(Boolean).length
      expect(successes).to.equal(1)
      expect(initCount).to.equal(1)
      expect(concurrentAttempts).to.equal(4) // 4 were blocked
    })

    it('should allow sequential initialization after previous completes', async () => {
      let isInitializing = false
      let initCount = 0

      const tryInitialize = async (): Promise<boolean> => {
        if (isInitializing) {
          return false
        }

        isInitializing = true
        try {
          await new Promise((resolve) => setTimeout(resolve, 5))
          initCount++
          return true
        } finally {
          isInitializing = false
        }
      }

      // Sequential calls should all succeed
      const result1 = await tryInitialize()
      const result2 = await tryInitialize()
      const result3 = await tryInitialize()

      expect(result1).to.be.true
      expect(result2).to.be.true
      expect(result3).to.be.true
      expect(initCount).to.equal(3)
    })
  })

  describe('Double Cleanup Prevention', () => {
    it('should prevent double cleanup', async () => {
      let isCleaningUp = false
      let cleanupCount = 0
      let doubleCleanupAttempts = 0

      const cleanup = async (): Promise<void> => {
        if (isCleaningUp) {
          doubleCleanupAttempts++
          return
        }

        isCleaningUp = true
        try {
          await new Promise((resolve) => setTimeout(resolve, 10))
          cleanupCount++
        } finally {
          isCleaningUp = false
        }
      }

      // Launch concurrent cleanup attempts
      await Promise.all([cleanup(), cleanup(), cleanup()])

      expect(cleanupCount).to.equal(1)
      expect(doubleCleanupAttempts).to.equal(2)
    })

    it('should allow cleanup after previous cleanup completes', async () => {
      let isCleaningUp = false
      let cleanupCount = 0

      const cleanup = async (): Promise<void> => {
        if (isCleaningUp) return

        isCleaningUp = true
        try {
          await new Promise((resolve) => setTimeout(resolve, 5))
          cleanupCount++
        } finally {
          isCleaningUp = false
        }
      }

      await cleanup()
      await cleanup()
      await cleanup()

      expect(cleanupCount).to.equal(3)
    })
  })

  describe('IPC Message Handling', () => {
    it('should respond to ping with pong', () => {
      const responses: AgentIPCResponse[] = []

      const handleIPC = (msg: IPCCommand): void => {
        if (msg.type === 'ping') {
          responses.push({type: 'pong'})
        }
      }

      handleIPC({type: 'ping'})
      handleIPC({type: 'ping'})

      expect(responses).to.have.length(2)
      expect(responses[0]).to.deep.equal({type: 'pong'})
      expect(responses[1]).to.deep.equal({type: 'pong'})
    })

    it('should trigger cleanup on shutdown', async () => {
      let cleanupCalled = false
      let stoppedSent = false

      const handleIPC = async (msg: IPCCommand): Promise<void> => {
        if (msg.type === 'shutdown') {
          // Simulate cleanup
          cleanupCalled = true
          // Simulate sending stopped response
          stoppedSent = true
        }
      }

      await handleIPC({type: 'shutdown'})

      expect(cleanupCalled).to.be.true
      expect(stoppedSent).to.be.true
    })

    it('should handle unknown message types gracefully', () => {
      let errorThrown = false

      const handleIPC = (msg: IPCCommand): void => {
        try {
          if (msg.type === 'ping') {
            // Handle ping
          } else if (msg.type === 'shutdown') {
            // Handle shutdown
          }
          // Unknown types are silently ignored (no else clause)
        } catch {
          errorThrown = true
        }
      }

      // Cast to simulate unknown message type
      handleIPC({type: 'unknown'} as unknown as IPCCommand)

      expect(errorThrown).to.be.false
    })
  })

  // NOTE: Config Change Detection tests removed - use explicit agent:restart event instead

  describe('Task Queue Integration', () => {
    it('should enqueue tasks before executor is set', () => {
      const queue: Array<{content: string; taskId: string}> = []
      const executorSet = false

      const enqueue = (task: {content: string; taskId: string}): boolean => {
        queue.push(task)
        if (executorSet) {
          // Process immediately
        }

        return true
      }

      // Enqueue before executor
      enqueue({content: 'Task 1', taskId: '1'})
      enqueue({content: 'Task 2', taskId: '2'})

      expect(queue).to.have.length(2)
    })

    it('should process queued tasks when executor is set', async () => {
      const queue: Array<{content: string; taskId: string}> = []
      const processed: string[] = []
      let executor: ((task: {content: string; taskId: string}) => Promise<void>) | undefined

      const enqueue = (task: {content: string; taskId: string}): void => {
        queue.push(task)
      }

      const setExecutor = (exec: (task: {content: string; taskId: string}) => Promise<void>): void => {
        executor = exec
        // Drain queue
        while (queue.length > 0) {
          const task = queue.shift()!
          executor(task)
        }
      }

      // Enqueue before executor
      enqueue({content: 'Task 1', taskId: '1'})
      enqueue({content: 'Task 2', taskId: '2'})

      // Set executor
      setExecutor(async (task) => {
        processed.push(task.taskId)
      })

      // Wait for processing
      await new Promise((resolve) => setImmediate(resolve))

      expect(processed).to.deep.equal(['1', '2'])
    })
  })

  describe('Signal Handlers', () => {
    it('should trigger cleanup on SIGTERM', () => {
      let cleanupCalled = false

      const cleanup = (): void => {
        cleanupCalled = true
      }

      // Simulate signal handler setup pattern
      const handlers = new Map<string, () => void>()
      handlers.set('SIGTERM', cleanup)

      // Simulate signal
      handlers.get('SIGTERM')?.()

      expect(cleanupCalled).to.be.true
    })

    it('should trigger cleanup on SIGINT', () => {
      let cleanupCalled = false

      const cleanup = (): void => {
        cleanupCalled = true
      }

      const handlers = new Map<string, () => void>()
      handlers.set('SIGINT', cleanup)

      handlers.get('SIGINT')?.()

      expect(cleanupCalled).to.be.true
    })

    it('should use process.once pattern to prevent multiple cleanups', () => {
      let cleanupCount = 0

      const cleanup = (): void => {
        cleanupCount++
      }

      // Simulate process.once pattern
      let sigintHandled = false
      const handleSigint = (): void => {
        if (sigintHandled) return
        sigintHandled = true
        cleanup()
      }

      // Multiple signals should only trigger cleanup once
      handleSigint()
      handleSigint()
      handleSigint()

      expect(cleanupCount).to.equal(1)
    })
  })

  describe('Transport Connection State', () => {
    it('should handle connection → registration flow', async () => {
      const states: string[] = []

      const connect = async (): Promise<void> => {
        states.push('connecting')
        await new Promise((resolve) => setTimeout(resolve, 5))
        states.push('connected')
      }

      const register = async (): Promise<void> => {
        states.push('registering')
        await new Promise((resolve) => setTimeout(resolve, 5))
        states.push('registered')
      }

      await connect()
      await register()

      expect(states).to.deep.equal(['connecting', 'connected', 'registering', 'registered'])
    })

    it('should handle reconnection', async () => {
      let connectionAttempts = 0
      let isConnected = false

      const connect = async (): Promise<boolean> => {
        connectionAttempts++
        // Simulate success on 3rd attempt
        if (connectionAttempts >= 3) {
          isConnected = true
          return true
        }

        return false
      }

      // Retry loop pattern
      while (!isConnected && connectionAttempts < 5) {
        await connect()
      }

      expect(isConnected).to.be.true
      expect(connectionAttempts).to.equal(3)
    })
  })

  describe('Error Recovery', () => {
    it('should allow retry after initialization failure', async () => {
      let authAvailable = false
      let initCount = 0

      const tryInitialize = async (): Promise<boolean> => {
        initCount++
        if (!authAvailable) {
          return false
        }

        return true
      }

      // First attempt fails
      let result = await tryInitialize()
      expect(result).to.be.false
      expect(initCount).to.equal(1)

      // Auth becomes available
      authAvailable = true

      // Second attempt succeeds
      result = await tryInitialize()
      expect(result).to.be.true
      expect(initCount).to.equal(2)
    })

    it('should preserve error state on initialization failure', async () => {
      let initializationError: Error | undefined

      const tryInitialize = async (hasAuth: boolean): Promise<boolean> => {
        if (!hasAuth) {
          initializationError = new Error('NotAuthenticatedError')
          return false
        }

        initializationError = undefined
        return true
      }

      await tryInitialize(false)
      expect(initializationError?.message).to.equal('NotAuthenticatedError')

      await tryInitialize(true)
      expect(initializationError).to.be.undefined
    })
  })

  describe('Stress Tests', () => {
    it('should handle 100 rapid init/cleanup cycles', async () => {
      let isInitialized = false
      let isInitializing = false
      let isCleaningUp = false
      let cycleCount = 0

      const init = async (): Promise<boolean> => {
        if (isInitializing || isCleaningUp) return false
        isInitializing = true
        try {
          await new Promise((resolve) => setImmediate(resolve))
          isInitialized = true
          return true
        } finally {
          isInitializing = false
        }
      }

      const cleanup = async (): Promise<void> => {
        if (isCleaningUp || isInitializing) return
        isCleaningUp = true
        try {
          await new Promise((resolve) => setImmediate(resolve))
          isInitialized = false
        } finally {
          isCleaningUp = false
        }
      }

      for (let i = 0; i < 100; i++) {
        const initResult = await init()
        if (initResult) {
          cycleCount++
          await cleanup()
        }
      }

      expect(cycleCount).to.equal(100)
      expect(isInitialized).to.be.false
      expect(isInitializing).to.be.false
      expect(isCleaningUp).to.be.false
    })

    it('should handle mixed concurrent operations without race conditions', async () => {
      let state = 'idle'
      const stateLog: string[] = []

      const setState = (newState: string): boolean => {
        // Only allow valid transitions
        const validTransitions: Record<string, string[]> = {
          cleanup: ['idle'],
          idle: ['initializing', 'cleanup'],
          initialized: ['cleanup'],
          initializing: ['initialized', 'idle'],
        }

        if (!validTransitions[state]?.includes(newState)) {
          return false
        }

        state = newState
        stateLog.push(state)
        return true
      }

      // Simulate concurrent operations
      const ops = [
        () => setState('initializing'),
        () => setState('initialized'),
        () => setState('cleanup'),
        () => setState('idle'),
        () => setState('initializing'),
        () => setState('initialized'),
      ]

      for (const op of ops) {
        op()
      }

      // State should be in a valid final state
      expect(['idle', 'initialized']).to.include(state)
    })
  })
})
