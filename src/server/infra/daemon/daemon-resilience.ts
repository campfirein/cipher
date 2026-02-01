import type {IDaemonResilience} from '../../core/interfaces/daemon/i-daemon-resilience.js'

import {SLEEP_WAKE_CHECK_INTERVAL_MS, SLEEP_WAKE_THRESHOLD_MULTIPLIER} from '../../constants.js'

export interface DaemonResilienceOptions {
  readonly crashLog: (error: Error | string, context: string) => string
  readonly log: (message: string) => void
  readonly onWake: () => void
  readonly sleepWakeCheckIntervalMs?: number
}

/** No-op handler — ignore SIGHUP to survive terminal close */
function sighupHandler(): void {
  // Intentional no-op
}

/**
 * Installs global handlers for daemon resilience:
 * - uncaughtException → log + continue (daemon must NOT crash)
 * - unhandledRejection → log + continue
 * - SIGHUP → ignore (survive terminal close)
 * - Sleep/wake detection via heartbeat time gap
 *
 * Unlike transport-worker.ts which exits on uncaught exception
 * (workers get restarted by parent), the daemon IS the parent
 * and must keep running.
 */
export class DaemonResilience implements IDaemonResilience {
  private readonly crashLog: (error: Error | string, context: string) => string
  private installed = false
  private lastSleepWakeCheck = Date.now()
  private readonly log: (message: string) => void
  private readonly onWake: () => void
  private readonly sleepWakeCheckIntervalMs: number
  private sleepWakeTimerId: ReturnType<typeof setTimeout> | undefined
  // Arrow functions for stable references with process.on/removeListener
  private readonly uncaughtExceptionHandler = (error: Error): void => {
    try {
      this.crashLog(error, 'uncaughtException')
      this.log(`Uncaught exception caught (daemon continues): ${error.message}`)
    } catch {
      // Never crash the crash handler
    }
  }
  private readonly unhandledRejectionHandler = (reason: unknown): void => {
    try {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.crashLog(error, 'unhandledRejection')
      this.log(`Unhandled rejection caught (daemon continues): ${error.message}`)
    } catch {
      // Never crash the crash handler
    }
  }

  constructor(options: DaemonResilienceOptions) {
    this.crashLog = options.crashLog
    this.log = options.log
    this.onWake = options.onWake
    this.sleepWakeCheckIntervalMs = options.sleepWakeCheckIntervalMs ?? SLEEP_WAKE_CHECK_INTERVAL_MS
  }

  install(): void {
    if (this.installed) return
    this.installed = true

    process.on('uncaughtException', this.uncaughtExceptionHandler)
    process.on('unhandledRejection', this.unhandledRejectionHandler)
    process.on('SIGHUP', sighupHandler)

    this.startSleepWakeDetection()

    this.log('Daemon resilience installed')
  }

  uninstall(): void {
    if (!this.installed) return
    this.installed = false

    process.removeListener('uncaughtException', this.uncaughtExceptionHandler)
    process.removeListener('unhandledRejection', this.unhandledRejectionHandler)
    process.removeListener('SIGHUP', sighupHandler)

    this.stopSleepWakeDetection()

    this.log('Daemon resilience uninstalled')
  }

  private scheduleSleepWakeCheck(): void {
    this.sleepWakeTimerId = setTimeout(() => {
      if (!this.installed) return

      const now = Date.now()
      const elapsed = now - this.lastSleepWakeCheck
      const threshold = this.sleepWakeCheckIntervalMs * SLEEP_WAKE_THRESHOLD_MULTIPLIER

      if (elapsed > threshold) {
        this.log(`Sleep/wake detected (gap: ${Math.round(elapsed / 1000)}s)`)
        try {
          this.onWake()
        } catch (error) {
          this.log(`onWake error: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      this.lastSleepWakeCheck = now
      this.scheduleSleepWakeCheck()
    }, this.sleepWakeCheckIntervalMs)
  }

  private startSleepWakeDetection(): void {
    this.lastSleepWakeCheck = Date.now()
    this.scheduleSleepWakeCheck()
  }

  private stopSleepWakeDetection(): void {
    if (this.sleepWakeTimerId !== undefined) {
      clearTimeout(this.sleepWakeTimerId)
      this.sleepWakeTimerId = undefined
    }
  }
}
