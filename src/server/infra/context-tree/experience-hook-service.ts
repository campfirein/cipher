import {resolve} from 'node:path'

import type {IExperienceHookService} from '../../core/interfaces/experience/i-experience-hook-service.js'
import type {BackpressureGate} from './backpressure-gate.js'
import type {ExperienceConsolidationService} from './experience-consolidation-service.js'

import {EXPERIENCE_CONSOLIDATION_INTERVAL} from '../../constants.js'
import {type ExperienceSignal, extractExperienceSignals, signalTarget} from './experience-extractor.js'
import {type ExperienceMeta, ExperienceStore} from './experience-store.js'

/**
 * ExperienceHookService — default implementation of IExperienceHookService.
 *
 * Responsibilities:
 * - Extract experience signals from curation responses
 * - Deduplicate against existing section bullets (case-insensitive)
 * - Batch-write new bullets to the experience store
 * - Increment the curation counter on every hook call (tracks consolidation cadence)
 * - Serialize concurrent hook calls and consolidation via a promise-chain queue
 *
 * Fail-open: all errors inside process() are swallowed so that experience
 * write failures never surface to the curation caller.
 */
export class ExperienceHookService implements IExperienceHookService {
  /**
   * Project-scoped serialization queues.
   * Keyed by resolved absolute project path so that all instances for the same
   * project share one queue, preventing concurrent read-modify-write races on
   * the experience markdown files and _meta.json even when multiple
   * ExperienceHookService instances exist for the same directory.
   */
  private static readonly queues = new Map<string, Promise<void>>()
  private readonly consolidationService?: ExperienceConsolidationService
  private readonly gate?: BackpressureGate
  private readonly projectKey: string
  private readonly store: ExperienceStore

  constructor(baseDirectory: string, consolidationService?: ExperienceConsolidationService, gate?: BackpressureGate) {
    this.projectKey = resolve(baseDirectory)
    this.store = new ExperienceStore(baseDirectory)
    this.consolidationService = consolidationService
    this.gate = gate
  }

  /**
   * Enqueue processing of a completed curation response.
   * Returns a promise that resolves when this specific call's curation work is done.
   * Background consolidation may continue after this promise settles, but it still
   * remains on the shared project queue so later calls do not race with it.
   * Never rejects — errors are swallowed inside process().
   */
  onCurateComplete(response: string): Promise<void> {
    const current = ExperienceHookService.queues.get(this.projectKey) ?? Promise.resolve()
    let settleProcessDone!: () => void
    const processDone = new Promise<void>((resolve) => {
      settleProcessDone = resolve
    })
    const next = current.then(async () => {
      const {gateTriggered, meta, preIncrementCount} = await this.process(response)
      settleProcessDone()

      // Background consolidation:
      // - Cadence-based consolidation uses POST-increment count so playbook cadence
      //   remains correct at INTERVAL*3 boundaries.
      // - Gate-triggered consolidation uses PRE-increment count to avoid accidentally
      //   including playbook when not on a cadence boundary.
      // - When both trigger in the same queue slot, cadence subsumes gate so we avoid
      //   running two back-to-back consolidate() passes over the same files.
      const cadenceTriggered = meta.curationCount % EXPERIENCE_CONSOLIDATION_INTERVAL === 0
      if (this.consolidationService) {
        if (cadenceTriggered) {
          await this.consolidationService.consolidate(this.store, meta.curationCount).catch(() => {})
        } else if (gateTriggered) {
          await this.consolidationService.consolidate(this.store, preIncrementCount).catch(() => {})
        }
      }
    }).catch(() => {
      settleProcessDone()
    })
    ExperienceHookService.queues.set(this.projectKey, next)

    // Prune the entry once the queue drains.
    // Only delete when `next` is still the tail (no newer task was enqueued
    // while this one was in-flight), so concurrent callers never clobber each other.
    next.then(() => {
      if (ExperienceHookService.queues.get(this.projectKey) === next) {
        ExperienceHookService.queues.delete(this.projectKey)
      }
    })

    return processDone
  }

  private groupByFile(signals: ExperienceSignal[]): Record<string, {bullets: string[]; section: string}> {
    const result: Record<string, {bullets: string[]; section: string}> = {}

    for (const signal of signals) {
      const {file, section} = signalTarget(signal.type)
      if (!result[file]) {
        result[file] = {bullets: [], section}
      }

      result[file].bullets.push(signal.text.trim())
    }

    return result
  }

  private async process(response: string): Promise<{gateTriggered: boolean; meta: ExperienceMeta; preIncrementCount: number}> {
    // 1. Ensure store is seeded (idempotent — fast no-op after first run)
    try {
      await this.store.ensureInitialized()
    } catch {
      // Fail-open — still increment curationCount below to keep consolidation cadence stable.
    }

    // 2. Extract typed signals from the agent response
    const signals = extractExperienceSignals(response)
    const groupedSignals = this.groupByFile(signals)
    const existingByFile = new Map<string, string[]>()

    // 3. Evaluate backpressure gate (Pattern 2) — gate only, no blocking
    let gateTriggered = false
    let preIncrementCount = 0
    if (this.gate && signals.length > 0) {
      const meta = await this.store.readMeta()
      preIncrementCount = meta.curationCount
      // Compute projected entry counts (existing + incoming unique bullets)
      let maxProjected = 0
      for (const [filename, {bullets, section}] of Object.entries(groupedSignals)) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await this.store.readSectionLines(filename, section)
        existingByFile.set(filename, existing)
        const existingSet = new Set(existing.map((s) => s.toLowerCase()))
        const newCount = bullets.filter((b) => !existingSet.has(b.toLowerCase())).length
        maxProjected = Math.max(maxProjected, existing.length + newCount)
      }

      const decision = this.gate.evaluate({
        lastConsolidatedAt: meta.lastConsolidatedAt,
        projectedEntryCount: maxProjected,
      })
      gateTriggered = decision === 'trigger-consolidation'
    }

    // 4. Group by target file and batch-write after deduplication (parallel across files)
    const groups = Object.entries(groupedSignals)

    await Promise.allSettled(
      groups.map(async ([filename, {bullets, section}]) => {
        const existing = existingByFile.get(filename) ?? await this.store.readSectionLines(filename, section)
        const existingSet = new Set(existing.map((s) => s.toLowerCase()))
        const newBullets = bullets.filter((b) => !existingSet.has(b.toLowerCase()))
        if (newBullets.length > 0) {
          await this.store.appendBulkToFile(filename, section, newBullets)
        }
      }),
    )

    // 5. Increment curation counter (always — tracks consolidation cadence even when no signals)
    const meta = await this.store.incrementCurationCount()

    return {gateTriggered, meta, preIncrementCount}
  }
}
