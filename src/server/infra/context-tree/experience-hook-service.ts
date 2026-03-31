import {resolve} from 'node:path'

import type {ExperienceMeta, ExperienceSignalType} from '../../core/domain/experience/experience-types.js'
import type {IExperienceHookService} from '../../core/interfaces/experience/i-experience-hook-service.js'
import type {BackpressureGate} from './backpressure-gate.js'
import type {ExperienceSynthesisService} from './experience-synthesis-service.js'

import {EXPERIENCE_CONSOLIDATION_INTERVAL} from '../../constants.js'
import {signalTypeToSubfolder, STANDARD_SIGNAL_TYPES} from '../../core/domain/experience/experience-types.js'
import {type ExperiencePerformanceSignal, type ExperienceSignal, extractExperienceSignals} from './experience-extractor.js'
import {computeContentHash, ExperienceStore} from './experience-store.js'

type ExperienceHookServiceOptions = {
  baseDirectory: string
  gate?: BackpressureGate
  synthesisService?: ExperienceSynthesisService
}

/**
 * ExperienceHookService — default implementation of IExperienceHookService.
 *
 * Responsibilities:
 * - Extract experience signals from curation responses
 * - Create individual entry files for each signal (dedup via contentHash)
 * - Route performance signals to JSONL append log
 * - Increment the curation counter on every hook call
 * - Trigger synthesis on cadence/gate boundaries
 *
 * Fail-open: all errors inside process() are swallowed so that experience
 * write failures never surface to the curation caller.
 */
export class ExperienceHookService implements IExperienceHookService {
  /**
   * Project-scoped serialization queues.
   * Keyed by resolved absolute project path so that all instances for the same
   * project share one queue, preventing concurrent read-modify-write races.
   */
  private static readonly queues = new Map<string, Promise<void>>()
  private readonly gate?: BackpressureGate
  private readonly projectKey: string
  private readonly store: ExperienceStore
  private readonly synthesisService?: ExperienceSynthesisService

  constructor(options: ExperienceHookServiceOptions) {
    this.projectKey = resolve(options.baseDirectory)
    this.store = new ExperienceStore(options.baseDirectory)
    this.synthesisService = options.synthesisService
    this.gate = options.gate
  }

  /**
   * Enqueue processing of a completed curation response.
   * Returns a promise that resolves when this specific call's curation work is done.
   * Background synthesis may continue after this promise settles.
   * Never rejects — errors are swallowed inside process().
   */
  onCurateComplete(response: string, insightsActive?: string[]): Promise<void> {
    const current = ExperienceHookService.queues.get(this.projectKey) ?? Promise.resolve()
    let settleProcessDone!: () => void
    const processDone = new Promise<void>((resolve) => {
      settleProcessDone = resolve
    })
    const next = current.then(async () => {
      const {gateTriggered, meta, preIncrementCount} = await this.process(response, insightsActive)
      settleProcessDone()

      // Background synthesis:
      // - Cadence-based synthesis uses POST-increment count so strategy cadence
      //   remains correct at INTERVAL*3 boundaries.
      // - Gate-triggered synthesis uses PRE-increment count to avoid accidentally
      //   including strategy when not on a cadence boundary.
      // - When both trigger in the same queue slot, cadence subsumes gate so we avoid
      //   running two back-to-back synthesize() passes over the same entries.
      const cadenceTriggered = meta.curationCount % EXPERIENCE_CONSOLIDATION_INTERVAL === 0
      if (this.synthesisService) {
        if (cadenceTriggered) {
          await this.synthesisService.synthesize(this.store, meta.curationCount).catch(() => {})
        } else if (gateTriggered) {
          await this.synthesisService.synthesize(this.store, preIncrementCount).catch(() => {})
        }
      }
    }).catch(() => {
      settleProcessDone()
    })
    ExperienceHookService.queues.set(this.projectKey, next)

    // Prune the entry once the queue drains.
    next.then(() => {
      if (ExperienceHookService.queues.get(this.projectKey) === next) {
        ExperienceHookService.queues.delete(this.projectKey)
      }
    })

    return processDone
  }

  private groupBySubfolder(signals: Array<ExperiencePerformanceSignal | ExperienceSignal>): Record<string, Array<ExperiencePerformanceSignal | ExperienceSignal>> {
    const result: Record<string, Array<ExperiencePerformanceSignal | ExperienceSignal>> = {}

    for (const signal of signals) {
      const sub = signalTypeToSubfolder(signal.type)
      if (!result[sub]) {
        result[sub] = []
      }

      result[sub].push(signal)
    }

    return result
  }

  private isStandardType(type: ExperienceSignalType): boolean {
    return (STANDARD_SIGNAL_TYPES as readonly string[]).includes(type)
  }

  private async process(response: string, insightsActive?: string[]): Promise<{gateTriggered: boolean; meta: ExperienceMeta; preIncrementCount: number}> {
    // 1. Ensure store is seeded (idempotent — fast no-op after first run)
    try {
      await this.store.ensureInitialized()
    } catch {
      // Fail-open — still increment curationCount below
    }

    // 2. Extract signals from the agent response
    const signals = extractExperienceSignals(response)
    const grouped = this.groupBySubfolder(signals)

    // 3. Dedup: build content hash sets for all entry-backed subfolders
    const hashSets = new Map<string, Set<string>>()
    for (const [subfolder, subSignals] of Object.entries(grouped)) {
      if (subSignals.some((s) => s.type !== 'performance')) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const hashes = await this.store.readEntryContentHashes(subfolder)
          hashSets.set(subfolder, hashes)
        } catch {
          hashSets.set(subfolder, new Set())
        }
      }
    }

    // 4. Evaluate backpressure gate (standard subfolders only, D6)
    let gateTriggered = false
    let preIncrementCount = 0
    let currentMeta: ExperienceMeta | null = null
    if (signals.length > 0) {
      try {
        currentMeta = await this.store.readMeta()
        preIncrementCount = currentMeta.curationCount
      } catch {
        currentMeta = null
      }
    }

    if (this.gate && currentMeta) {
      let maxProjected = 0
      for (const [subfolder, subSignals] of Object.entries(grouped)) {
        const standardSignals = subSignals.filter((s) => this.isStandardType(s.type))
        if (standardSignals.length === 0) continue

        const existingHashes = hashSets.get(subfolder) ?? new Set()
        const newCount = standardSignals.filter((s) => !existingHashes.has(computeContentHash(s.text.trim()))).length

        try {
          // eslint-disable-next-line no-await-in-loop
          const existing = await this.store.listEntries(subfolder)
          maxProjected = Math.max(maxProjected, existing.length + newCount)
        } catch {
          maxProjected = Math.max(maxProjected, newCount)
        }
      }

      const decision = this.gate.evaluate({
        lastConsolidatedAt: currentMeta.lastConsolidatedAt,
        projectedEntryCount: maxProjected,
      })
      gateTriggered = decision === 'trigger-consolidation'
    }

    // 5. Create entries / append performance log
    await Promise.allSettled(
      Object.entries(grouped).map(async ([subfolder, subSignals]) => {
        for (const signal of subSignals) {
          const trimmedText = signal.text.trim()
          if (signal.type === 'performance') {
            const perfSignal = signal as ExperiencePerformanceSignal
            // eslint-disable-next-line no-await-in-loop
            await this.store.appendPerformanceLog({
              curationId: preIncrementCount,
              domain: perfSignal.domain,
              insightsActive: insightsActive ?? [],
              score: perfSignal.score,
              summary: trimmedText,
              ts: new Date().toISOString(),
            })
          } else {
            const hash = computeContentHash(trimmedText)
            const existingHashes = hashSets.get(subfolder)
            if (existingHashes?.has(hash)) {
              continue
            }

            const iso = new Date().toISOString()
            // eslint-disable-next-line no-await-in-loop
            await this.store.createEntry(subfolder, trimmedText, {
              contentHash: hash,
              createdAt: iso,
              importance: 50,
              maturity: 'draft',
              recency: 1,
              tags: ['experience', signal.type],
              title: trimmedText.slice(0, 80),
              type: signal.type,
              updatedAt: iso,
            })

            existingHashes?.add(hash)
          }
        }
      }),
    )

    // 6. Increment curation counter (always — tracks synthesis cadence even when no signals)
    const meta = await this.store.incrementCurationCount()

    return {gateTriggered, meta, preIncrementCount}
  }
}
