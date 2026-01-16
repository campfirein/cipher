/**
 * Agent Worker Timeout Tests
 *
 * Tests the 5-minute task timeout mechanism in agent-worker.ts that:
 * - Calls cipherAgent.cancel() when timeout fires (instead of orphaning)
 * - Sends timeout-specific error to transport
 * - Clears timeout when task completes normally
 * - Distinguishes timeout errors from other errors
 *
 * Uses state machine simulation pattern (same as agent-worker-credentials-polling.test.ts)
 * to test the logic without complex dependencies.
 */

import {expect} from 'chai'
import {createSandbox, type SinonFakeTimers, type SinonSandbox} from 'sinon'

// ============================================================================
// Constants (mirrors agent-worker.ts)
// ============================================================================

const TASK_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// ============================================================================
// Types
// ============================================================================

interface TaskExecute {
  clientCwd?: string
  content: string
  files?: string[]
  taskId: string
  type: 'curate' | 'query'
}

interface MockCipherAgent {
  cancel: () => Promise<void>
}

interface MockTransportClient {
  request: (event: string, data: unknown) => Promise<void>
}

// ============================================================================
// State Machine Simulation (mirrors agent-worker.ts timeout logic)
// ============================================================================

/**
 * Simulates agent-worker timeout logic for testability.
 * Mirrors real implementation without complex dependencies.
 */
class TimeoutStateMachine {
  // Track calls
  cancelCalled = false
  // Mock dependencies
  cipherAgent: MockCipherAgent | undefined
taskErrorData: undefined | {error: unknown; taskId: string}
  taskErrorSent = false
  transportClient: MockTransportClient | undefined
private taskReject: ((error: Error) => void) | undefined
  // Task execution control
  private taskResolve: (() => void) | undefined

  constructor() {
    this.cipherAgent = {
      cancel: async () => {
        this.cancelCalled = true
        // Simulate cancel causing task to fail
        if (this.taskReject) {
          this.taskReject(new Error('Stream did not complete'))
        }
      },
    }

    this.transportClient = {
      request: async (event: string, data: unknown) => {
        if (event === 'task:error') {
          this.taskErrorSent = true
          this.taskErrorData = data as {error: unknown; taskId: string}
        }
      },
    }
  }

  /**
   * Complete the task successfully (for normal completion tests).
   */
  completeTask(): void {
    if (this.taskResolve) {
      this.taskResolve()
    }
  }

  /**
   * Simulates setupTaskExecutor's timeout logic.
   * Mirrors agent-worker.ts lines 379-412.
   */
  async executeWithTimeout(task: TaskExecute): Promise<void> {
    const {taskId} = task

    // Track timeout state for error handling
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      // Cancel via CipherAgent's existing cancel() method
      if (this.cipherAgent) {
        this.cipherAgent.cancel().catch(() => {
          // Log but don't rethrow - mirrors logTransportError pattern
        })
      }
    }, TASK_EXECUTION_TIMEOUT_MS)

    try {
      // Execute task - wait for external signal
      await this.waitForTaskCompletion()
    } catch (error) {
      // Handle timeout-triggered cancellation
      if (timedOut) {
        const errorData = {message: 'Task exceeded 5 minute timeout', name: 'Error'}
        await this.transportClient?.request('task:error', {error: errorData, taskId})
        return
      }

      // Handle other errors (not timeout)
      const errorData = {message: (error as Error).message, name: 'Error'}
      await this.transportClient?.request('task:error', {error: errorData, taskId})
    } finally {
      // Always clear timeout to prevent memory leak
      clearTimeout(timeoutId)
    }
  }

  /**
   * Fail the task with an error (for error handling tests).
   */
  failTask(error: Error): void {
    if (this.taskReject) {
      this.taskReject(error)
    }
  }

  /**
   * Wait for task completion signal.
   */
  private waitForTaskCompletion(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.taskResolve = resolve
      this.taskReject = reject
    })
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Agent Worker Timeout', () => {
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

  describe('5-minute task timeout', () => {
    it('should call cipherAgent.cancel() when timeout fires', async () => {
      const sm = new TimeoutStateMachine()

      const task: TaskExecute = {
        content: 'test content',
        taskId: 'test-task-1',
        type: 'curate',
      }

      // Start execution (don't await - we want to advance time before it completes)
      const executePromise = sm.executeWithTimeout(task)

      // Advance past timeout - this triggers cancel() which rejects the task
      await clock.tickAsync(TASK_EXECUTION_TIMEOUT_MS + 100)

      // Let promise settle
      await executePromise

      expect(sm.cancelCalled).to.be.true
    })

    it('should send timeout error to transport', async () => {
      const sm = new TimeoutStateMachine()

      const task: TaskExecute = {
        content: 'test content',
        taskId: 'test-task-2',
        type: 'curate',
      }

      const executePromise = sm.executeWithTimeout(task)
      // Advance past timeout - cancel() is called which rejects the task
      await clock.tickAsync(TASK_EXECUTION_TIMEOUT_MS + 100)
      await executePromise

      expect(sm.taskErrorSent).to.be.true
      expect(sm.taskErrorData?.taskId).to.equal('test-task-2')
      expect((sm.taskErrorData?.error as {message: string})?.message).to.equal('Task exceeded 5 minute timeout')
    })

    it('should NOT call cipherAgent.cancel() when task completes normally', async () => {
      const sm = new TimeoutStateMachine()

      const task: TaskExecute = {
        content: 'test content',
        taskId: 'test-task-3',
        type: 'query',
      }

      const executePromise = sm.executeWithTimeout(task)

      // Complete task before timeout
      await clock.tickAsync(100)
      sm.completeTask()

      await executePromise

      expect(sm.cancelCalled).to.be.false
    })

    it('should distinguish timeout error from other errors', async () => {
      const sm = new TimeoutStateMachine()

      const task: TaskExecute = {
        content: 'test content',
        taskId: 'test-task-4',
        type: 'curate',
      }

      const executePromise = sm.executeWithTimeout(task)

      // Fail task before timeout with a different error
      await clock.tickAsync(100)
      sm.failTask(new Error('Network failure'))

      await executePromise

      expect(sm.taskErrorSent).to.be.true
      // Error should be the original error, not timeout error
      expect((sm.taskErrorData?.error as {message: string})?.message).to.equal('Network failure')
      expect(sm.cancelCalled).to.be.false
    })

    it('should handle cipherAgent.cancel() errors gracefully', async () => {
      const sm = new TimeoutStateMachine()
      // Make cancel() throw an error but still reject the task
      let taskReject: ((error: Error) => void) | undefined
      sm.cipherAgent = {
        async cancel() {
          // Reject the task even though cancel throws
          if (taskReject) {
            taskReject(new Error('Stream did not complete'))
          }

          throw new Error('Cancel failed')
        },
      }

      const task: TaskExecute = {
        content: 'test content',
        taskId: 'test-task-5',
        type: 'curate',
      }

      // Hook into the state machine to get the reject function
      const originalExecute = sm.executeWithTimeout.bind(sm)
      sm.executeWithTimeout = async (t: TaskExecute) => {
        const promise = originalExecute(t)
        // @ts-expect-error - accessing private for test
        taskReject = sm.taskReject
        return promise
      }

      const executePromise = sm.executeWithTimeout(task)
      await clock.tickAsync(TASK_EXECUTION_TIMEOUT_MS + 100)
      await executePromise

      // Should still send timeout error even if cancel() threw
      expect(sm.taskErrorSent).to.be.true
    })

    it('should clear timeout when task completes to prevent memory leak', async () => {
      const sm = new TimeoutStateMachine()

      const clearTimeoutSpy = sandbox.spy(globalThis, 'clearTimeout')

      const task: TaskExecute = {
        content: 'test content',
        taskId: 'test-task-6',
        type: 'query',
      }

      const executePromise = sm.executeWithTimeout(task)

      // Complete task before timeout
      await clock.tickAsync(100)
      sm.completeTask()

      await executePromise

      expect(clearTimeoutSpy.called).to.be.true
    })
  })

  describe('Timeout constant', () => {
    it('should be 5 minutes (300000 ms)', () => {
      expect(TASK_EXECUTION_TIMEOUT_MS).to.equal(5 * 60 * 1000)
      expect(TASK_EXECUTION_TIMEOUT_MS).to.equal(300_000)
    })
  })
})
