import type {IIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-idle-timeout-policy.js'

import {IDLE_CHECK_INTERVAL_MS, IDLE_TIMEOUT_MS} from '../../constants.js'

export interface IdleTimeoutPolicyOptions {
  readonly checkIntervalMs?: number
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
 * Uses recursive setTimeout (not setInterval) for safe cancellation.
 */
export class IdleTimeoutPolicy implements IIdleTimeoutPolicy {
  private readonly checkIntervalMs: number
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
    this.timeoutMs = options.timeoutMs ?? IDLE_TIMEOUT_MS
    this.checkIntervalMs = options.checkIntervalMs ?? IDLE_CHECK_INTERVAL_MS
  }

  onClientConnected(): void {
    this.clientCount++
    this.updateActivity()
  }

  onClientDisconnected(): void {
    this.clientCount = Math.max(0, this.clientCount - 1)
    this.updateActivity()
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.updateActivity()
    this.scheduleNext()
    this.log('Idle timeout policy started')
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

  private checkIdle(): void {
    if (!this.isRunning) return

    if (this.clientCount === 0 && Date.now() - this.lastActivityAt >= this.timeoutMs) {
      this.log(`Idle for ${Math.round(this.timeoutMs / 1000)}s with no clients`)
      try {
        this.onIdle()
      } catch (error) {
        this.log(`onIdle callback failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      // Safety net: re-schedule at full timeout delay in case onIdle()'s
      // shutdown fails. Normal shutdown calls stop() which clears this timer.
      this.timeoutId = setTimeout(() => this.checkIdle(), this.timeoutMs)
      return
    }

    this.scheduleNext()
  }

  private scheduleNext(): void {
    if (!this.isRunning) return
    this.timeoutId = setTimeout(() => this.checkIdle(), this.checkIntervalMs)
  }

  private updateActivity(): void {
    this.lastActivityAt = Date.now()
  }
}
