import {resolve} from 'node:path'

import type {IExperienceHookService} from '../../core/interfaces/experience/i-experience-hook-service.js'
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
  private readonly projectKey: string
  private readonly store: ExperienceStore

  constructor(baseDirectory: string, consolidationService?: ExperienceConsolidationService) {
    this.projectKey = resolve(baseDirectory)
    this.store = new ExperienceStore(baseDirectory)
    this.consolidationService = consolidationService
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
      const meta = await this.process(response)
      settleProcessDone()

      if (this.consolidationService && meta.curationCount % EXPERIENCE_CONSOLIDATION_INTERVAL === 0) {
        await this.consolidationService.consolidate(this.store, meta.curationCount).catch(() => {})
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

  private async process(response: string): Promise<ExperienceMeta> {
    // 1. Ensure store is seeded (idempotent — fast no-op after first run)
    await this.store.ensureInitialized()

    // 2. Extract typed signals from the agent response
    const signals = extractExperienceSignals(response)

    // 3. Group by target file and batch-write after deduplication (parallel across files)
    const groups = Object.entries(this.groupByFile(signals))

    await Promise.allSettled(
      groups.map(async ([filename, {bullets, section}]) => {
        const existing = await this.store.readSectionLines(filename, section)
        const existingSet = new Set(existing.map((s) => s.toLowerCase()))
        const newBullets = bullets.filter((b) => !existingSet.has(b.toLowerCase()))
        if (newBullets.length > 0) {
          await this.store.appendBulkToFile(filename, section, newBullets)
        }
      }),
    )

    // 4. Increment curation counter (always — tracks consolidation cadence even when no signals)
    return this.store.incrementCurationCount()
  }
}
