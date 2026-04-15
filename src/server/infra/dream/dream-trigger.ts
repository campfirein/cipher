import type {DreamLockService} from './dream-lock-service.js'
import type {DreamStateService} from './dream-state-service.js'

type DreamTriggerDeps = {
  dreamLockService: Pick<DreamLockService, 'tryAcquire'>
  dreamStateService: Pick<DreamStateService, 'read'>
  getQueueLength: (projectPath: string) => number
}

type DreamTriggerOptions = {
  minCurations?: number
  minHours?: number
}

export type DreamEligibility =
  | {eligible: false; reason: string}
  | {eligible: true; priorMtime: number}

type PreCheckResult =
  | {eligible: false; reason: string}
  | {eligible: true}

const DEFAULT_MIN_HOURS = 12
const DEFAULT_MIN_CURATIONS = 3

/**
 * Four-gate trigger for dream eligibility.
 *
 * Gates 1-3 (time, activity, queue) are skipped with force=true.
 * Gate 4 (lock) always runs — prevents concurrent dreams.
 */
export class DreamTrigger {
  private readonly deps: DreamTriggerDeps
  private readonly options: DreamTriggerOptions

  constructor(deps: DreamTriggerDeps, options: DreamTriggerOptions = {}) {
    this.deps = deps
    this.options = options
  }

  /**
   * Lightweight eligibility pre-check (gates 1-3 only, no lock).
   *
   * Used by the daemon to decide whether to dispatch a dream task
   * without acquiring the PID-based lock (which must be acquired
   * by the agent process that actually runs the dream).
   */
  async checkEligibility(projectPath: string): Promise<PreCheckResult> {
    return this.checkGates1to3(projectPath)
  }

  async tryStartDream(projectPath: string, force = false): Promise<DreamEligibility> {
    if (!force) {
      const preCheck = await this.checkGates1to3(projectPath)
      if (!preCheck.eligible) return preCheck
    }

    // Gate 4: Lock (NEVER skipped, even with force)
    const lockResult = await this.deps.dreamLockService.tryAcquire()
    if (!lockResult.acquired) {
      return {eligible: false, reason: 'Lock held by another dream process'}
    }

    return {eligible: true, priorMtime: lockResult.priorMtime}
  }

  private async checkGates1to3(projectPath: string): Promise<PreCheckResult> {
    const minHours = this.options.minHours ?? DEFAULT_MIN_HOURS
    const minCurations = this.options.minCurations ?? DEFAULT_MIN_CURATIONS

    // Gates 1+2: time and activity (share one file read)
    const state = await this.deps.dreamStateService.read()

    // Gate 1: Time
    if (state.lastDreamAt !== null) {
      const hoursSince = (Date.now() - new Date(state.lastDreamAt).getTime()) / (1000 * 60 * 60)
      if (hoursSince < minHours) {
        return {eligible: false, reason: `Too recent (${hoursSince.toFixed(1)}h < ${minHours}h)`}
      }
    }

    // Gate 2: Activity
    if (state.curationsSinceDream < minCurations) {
      return {
        eligible: false,
        reason: `Not enough activity (${state.curationsSinceDream} < ${minCurations} curations)`,
      }
    }

    // Gate 3: Queue
    const queueLength = this.deps.getQueueLength(projectPath)
    if (queueLength > 0) {
      return {eligible: false, reason: `Queue not empty (${queueLength} tasks pending)`}
    }

    return {eligible: true}
  }
}
