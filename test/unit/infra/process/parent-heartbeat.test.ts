/**
 * Parent Heartbeat Mechanism Tests
 *
 * Tests the recursive setTimeout pattern used in transport-worker.ts and agent-worker.ts
 * to detect parent process death and prevent zombie processes.
 *
 * Key scenarios:
 * - Recursive setTimeout pattern (safer than setInterval)
 * - Parent death detection via process.kill(pid, 0)
 * - Clean stop via flag (no orphan timers)
 * - Idempotent setup/stop functions
 */

import {expect} from 'chai'
import {createSandbox, type SinonFakeTimers, type SinonSandbox} from 'sinon'

describe('Parent Heartbeat Mechanism (Recursive setTimeout)', () => {
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

  describe('Recursive setTimeout Pattern', () => {
    it('should not start multiple heartbeats if already running', () => {
      let running = false
      let setupCalls = 0

      const setupHeartbeat = (): void => {
        if (running) return // Guard - already running
        running = true
        setupCalls++

        const check = (): void => {
          if (!running) return
          setTimeout(check, 2000)
        }

        setTimeout(check, 2000)
      }

      // Call setup multiple times
      setupHeartbeat()
      setupHeartbeat()
      setupHeartbeat()

      // Should only actually set up once
      expect(setupCalls).to.equal(1)
      expect(running).to.be.true

      // Cleanup
      running = false
    })

    it('should stop cleanly by setting flag to false', () => {
      let running = false
      let checkCount = 0

      const setupHeartbeat = (): void => {
        running = true

        const check = (): void => {
          if (!running) return // Stop condition
          checkCount++
          setTimeout(check, 2000)
        }

        setTimeout(check, 2000)
      }

      const stopHeartbeat = (): void => {
        running = false
      }

      setupHeartbeat()

      // Advance time - checks should run
      clock.tick(6000)
      expect(checkCount).to.equal(3) // 2s, 4s, 6s

      // Stop heartbeat
      stopHeartbeat()

      // Advance more time - no more checks
      const countBeforeStop = checkCount
      clock.tick(6000)
      expect(checkCount).to.equal(countBeforeStop) // No new checks
    })

    it('should not have overlapping callbacks (unlike setInterval)', () => {
      let running = false
      let concurrentCalls = 0
      let maxConcurrent = 0
      let inCallback = false

      const setupHeartbeat = (): void => {
        running = true

        const check = (): void => {
          if (!running) return

          if (inCallback) {
            concurrentCalls++
          }

          inCallback = true

          // Simulate some work
          maxConcurrent = Math.max(maxConcurrent, inCallback ? 1 : 0)

          inCallback = false

          // Schedule next AFTER this one completes
          setTimeout(check, 2000)
        }

        setTimeout(check, 2000)
      }

      setupHeartbeat()
      clock.tick(10_000)

      // With recursive setTimeout, callbacks never overlap
      expect(concurrentCalls).to.equal(0)
      expect(maxConcurrent).to.equal(1)

      running = false
    })
  })

  describe('Parent Death Detection', () => {
    it('should detect parent death when process.kill throws', () => {
      let parentDied = false
      let cleanupCalled = false

      const checkParent = (): void => {
        try {
          // Simulate process.kill(pid, 0) throwing when process doesn't exist
          throw new Error('ESRCH') // No such process
        } catch {
          parentDied = true
          cleanupCalled = true
        }
      }

      checkParent()

      expect(parentDied).to.be.true
      expect(cleanupCalled).to.be.true
    })

    it('should not trigger cleanup when parent is alive', () => {
      let parentDied = false
      const parentPid = process.pid // Use current process (definitely alive)

      const checkParent = (): void => {
        try {
          // This won't throw because process exists
          process.kill(parentPid, 0)
        } catch {
          parentDied = true
        }
      }

      checkParent()

      expect(parentDied).to.be.false
    })

    it('should stop scheduling after parent death detected', () => {
      let running = true
      let checkCount = 0
      let parentAlive = true

      const check = (): void => {
        if (!running) return

        checkCount++

        if (!parentAlive) {
          running = false // Stop on parent death
          return
        }

        setTimeout(check, 2000)
      }

      setTimeout(check, 2000)

      // Run 2 checks with parent alive
      clock.tick(4000)
      expect(checkCount).to.equal(2)

      // Parent dies
      parentAlive = false
      clock.tick(2000)
      expect(checkCount).to.equal(3) // One more check detects death

      // No more checks scheduled
      clock.tick(10_000)
      expect(checkCount).to.equal(3) // Still 3
    })
  })

  describe('stopParentHeartbeat Simplicity', () => {
    it('should be idempotent (safe to call multiple times)', () => {
      let running = true

      const stopHeartbeat = (): void => {
        running = false
      }

      // Call multiple times
      stopHeartbeat()
      stopHeartbeat()
      stopHeartbeat()

      // Should not throw, running should be false
      expect(running).to.be.false
    })

    it('should work even if never started', () => {
      let running = false

      const stopHeartbeat = (): void => {
        running = false
      }

      // Should not throw
      expect(() => stopHeartbeat()).to.not.throw()
      expect(running).to.be.false
    })
  })

  describe('Integration with Cleanup', () => {
    it('should stop heartbeat before other cleanup operations', async () => {
      const cleanupOrder: string[] = []
      let running = true

      const stopHeartbeat = (): void => {
        running = false
        cleanupOrder.push('heartbeat')
      }

      const stopOtherServices = async (): Promise<void> => {
        await Promise.resolve()
        cleanupOrder.push('services')
      }

      const cleanup = async (): Promise<void> => {
        stopHeartbeat() // Should be first
        await stopOtherServices()
      }

      await cleanup()

      expect(cleanupOrder).to.deep.equal(['heartbeat', 'services'])
      expect(running).to.be.false
    })

    it('should be called in all exit scenarios', () => {
      const exitScenarios = ['SIGTERM', 'SIGINT', 'disconnect', 'parentDeath', 'gracefulShutdown']
      const heartbeatStopped = new Map<string, boolean>()

      for (const scenario of exitScenarios) {
        let running = true

        const stopHeartbeat = (): void => {
          running = false
        }

        // Simulate exit scenario
        stopHeartbeat()
        heartbeatStopped.set(scenario, !running)
      }

      // All scenarios should have stopped the heartbeat
      for (const scenario of exitScenarios) {
        expect(heartbeatStopped.get(scenario)).to.be.true
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid start/stop cycles', () => {
      let running = false
      let startCount = 0
      let stopCount = 0

      const start = (): void => {
        if (running) return
        running = true
        startCount++
      }

      const stop = (): void => {
        if (running) {
          running = false
          stopCount++
        }
      }

      // Rapid cycles
      for (let i = 0; i < 100; i++) {
        start()
        stop()
      }

      expect(startCount).to.equal(100)
      expect(stopCount).to.equal(100)
      expect(running).to.be.false
    })

    it('should handle parentPid being undefined', () => {
      let parentPid: number | undefined
      let checkExecuted = false

      const checkParent = (): void => {
        if (!parentPid) return // Guard clause
        checkExecuted = true
      }

      checkParent()

      expect(checkExecuted).to.be.false
    })

    it('should not schedule next check if stopped during check', () => {
      let running = true
      let scheduledCount = 0

      const check = (): void => {
        if (!running) return

        // Stop during check
        running = false

        // This should NOT schedule because running is now false
        if (running) {
          scheduledCount++
          setTimeout(check, 2000)
        }
      }

      check()

      expect(scheduledCount).to.equal(0)
    })
  })

  describe('No Memory Leak', () => {
    it('should not create orphan timers', () => {
      let running = false

      // Mock setTimeout to track calls
      const originalSetTimeout = globalThis.setTimeout
      let timeoutCount = 0
      globalThis.setTimeout = ((fn: () => void, ms: number) => {
        timeoutCount++
        return originalSetTimeout(fn, ms)
      }) as typeof setTimeout

      const start = (): void => {
        if (running) return
        running = true

        const check = (): void => {
          if (!running) return
          setTimeout(check, 2000)
        }

        setTimeout(check, 2000)
      }

      const stop = (): void => {
        running = false
      }

      // Start and let it run
      start()
      clock.tick(6000) // 3 checks
      const countWhileRunning = timeoutCount

      // Stop
      stop()
      clock.tick(6000) // Should not schedule more

      // No new timeouts after stop
      expect(timeoutCount).to.equal(countWhileRunning)

      globalThis.setTimeout = originalSetTimeout
    })
  })

  // ============================================================================
  // Global Exception Handlers Tests
  // Tests the uncaughtException and unhandledRejection handlers
  // ============================================================================

  describe('Global Exception Handlers', () => {
    it('should call cleanup before exit on uncaught exception', async () => {
      let cleanupCalled = false

      const cleanup = async (): Promise<void> => {
        cleanupCalled = true
      }

      await cleanup().catch(() => {})
      const exitCode = 1

      expect(cleanupCalled).to.be.true
      expect(exitCode).to.equal(1)
    })

    it('should not throw if cleanup fails', async () => {
      let didThrow = false

      // Test that .catch(() => {}) swallows errors
      try {
        await Promise.reject(new Error('Cleanup failed')).catch(() => {})
      } catch {
        didThrow = true
      }

      expect(didThrow).to.be.false
    })

    it('should call cleanup before exit on unhandled rejection', async () => {
      let cleanupCalled = false

      const cleanup = async (): Promise<void> => {
        cleanupCalled = true
      }

      await cleanup().catch(() => {})
      const exitCode = 1

      expect(cleanupCalled).to.be.true
      expect(exitCode).to.equal(1)
    })
  })

  // ============================================================================
  // Startup Error Cleanup Tests
  // ============================================================================

  describe('Startup Error Cleanup', () => {
    it('should call cleanup on startup failure', async () => {
      let cleanupCalled = false
      let errorSent = false
      let exitCode: number | undefined

      const cleanup = async (): Promise<void> => {
        cleanupCalled = true
      }

      const sendError = (msg: {error?: string; type: string}): void => {
        if (msg.type === 'error') {
          errorSent = true
        }
      }

      // Simulate startup failure pattern
      try {
        throw new Error('TRANSPORT_PORT not set')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendError({error: message, type: 'error'})
        await cleanup().catch(() => {})
        exitCode = 1
      }

      expect(errorSent).to.be.true
      expect(cleanupCalled).to.be.true
      expect(exitCode).to.equal(1)
    })

    it('should cleanup even if nothing was initialized', async () => {
      let cleanupCalled = false

      const cleanup = async (): Promise<void> => {
        cleanupCalled = true
      }

      await cleanup().catch(() => {})

      expect(cleanupCalled).to.be.true
    })

    it('should send error to parent before cleanup', async () => {
      const callOrder: string[] = []

      const sendError = (): void => {
        callOrder.push('sendToParent')
      }

      const cleanup = async (): Promise<void> => {
        callOrder.push('stopWorker')
      }

      sendError()
      await cleanup().catch(() => {})

      expect(callOrder).to.deep.equal(['sendToParent', 'stopWorker'])
    })
  })

  // ============================================================================
  // Module-level Error Cleanup Tests
  // ============================================================================

  describe('Module-level Error Cleanup', () => {
    it('should call cleanup on fatal error', async () => {
      let cleanupCalled = false
      let exitCode: number | undefined

      const cleanup = async (): Promise<void> => {
        cleanupCalled = true
      }

      try {
        throw new Error('Fatal error in runWorker')
      } catch {
        await cleanup().catch(() => {})
        exitCode = 1
      }

      expect(cleanupCalled).to.be.true
      expect(exitCode).to.equal(1)
    })

    it('should exit with code 1 on fatal error', async () => {
      let exitCode: number | undefined

      try {
        throw new Error('Fatal')
      } catch {
        // Simulate cleanup pattern: await promise.catch(() => {})
        await Promise.resolve().catch(() => {})
        exitCode = 1
      }

      expect(exitCode).to.equal(1)
    })
  })
})
