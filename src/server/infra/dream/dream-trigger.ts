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

  async shouldDream(projectPath: string, force = false): Promise<DreamEligibility> {
    const minHours = this.options.minHours ?? DEFAULT_MIN_HOURS
    const minCurations = this.options.minCurations ?? DEFAULT_MIN_CURATIONS

    if (!force) {
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
    }

    // Gate 4: Lock (NEVER skipped, even with force)
    const lockResult = await this.deps.dreamLockService.tryAcquire()
    if (!lockResult.acquired) {
      return {eligible: false, reason: 'Lock held by another dream process'}
    }

    return {eligible: true, priorMtime: lockResult.priorMtime}
  }
}
