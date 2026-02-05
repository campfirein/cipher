import type {IIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-idle-timeout-policy.js'

import {SERVER_IDLE_TIMEOUT_MS} from '../../constants.js'

export interface IdleTimeoutPolicyOptions {
  readonly log: (message: string) => void
  readonly onIdle: () => void
  readonly timeoutMs?: number
}

/**
 * Tracks client connections to auto-shutdown the daemon
 * after a period of inactivity.
 *
 * Fires `onIdle` when:
 * - 0 clients connected
 * - AND this has been the case for >= timeoutMs
 *
 * Uses event-driven direct timer: schedules exactly at `timeoutMs`
 * when clientCount drops to 0. No polling — fires precisely on time.
 */
export class IdleTimeoutPolicy implements IIdleTimeoutPolicy {
  private clientCount = 0
  private isRunning = false
  private lastActivityAt = Date.now()
  private readonly log: (message: string) => void
  private readonly onIdle: () => void
  private timeoutId: ReturnType<typeof setTimeout> | undefined
  private readonly timeoutMs: number

  constructor(options: IdleTimeoutPolicyOptions) {
    this.log = options.log
    this.onIdle = options.onIdle
    this.timeoutMs = options.timeoutMs ?? SERVER_IDLE_TIMEOUT_MS
  }

  getIdleStatus(): undefined | {clientCount: number; idleMs: number; remainingMs: number} {
    if (this.clientCount > 0) return undefined

    const idleMs = Date.now() - this.lastActivityAt
    const remainingMs = Math.max(0, this.timeoutMs - idleMs)

    return {clientCount: this.clientCount, idleMs, remainingMs}
  }

  onClientConnected(): void {
    this.clientCount++
    this.lastActivityAt = Date.now()
    this.reschedule()
  }

  onClientDisconnected(): void {
    this.clientCount = Math.max(0, this.clientCount - 1)
    this.lastActivityAt = Date.now()
    this.reschedule()
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.lastActivityAt = Date.now()
    this.log('Idle timeout policy started')
    this.reschedule()
  }

  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }

    this.log('Idle timeout policy stopped')
  }

  private fireIdle(): void {
    if (!this.isRunning || this.clientCount > 0) return

    this.log(`Idle for ${Math.round(this.timeoutMs / 1000)}s with no clients`)

    try {
      this.onIdle()
    } catch (error) {
      this.log(`onIdle callback failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Safety net: re-schedule in case onIdle's shutdown fails.
    // If onIdle() triggered shutdown → stop() was called → isRunning is false.
    // Only re-schedule if still running (i.e. shutdown didn't happen).
    if (this.isRunning) {
      this.timeoutId = setTimeout(() => this.fireIdle(), this.timeoutMs)
    }
  }

  private reschedule(): void {
    if (!this.isRunning) return

    // Clear existing timer
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }

    // Schedule shutdown timer only when no clients are connected
    if (this.clientCount === 0) {
      this.timeoutId = setTimeout(() => this.fireIdle(), this.timeoutMs)
    }
  }
}
