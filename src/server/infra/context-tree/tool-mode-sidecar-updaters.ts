import type {ILogger} from '../../../agent/core/interfaces/i-logger.js'
import type {IRuntimeSignalStore} from '../../core/interfaces/storage/i-runtime-signal-store.js'

import {
  determineTier,
  recordAccessHits,
  recordCurateUpdate,
} from '../../core/domain/knowledge/memory-scoring.js'
import {
  createDefaultRuntimeSignals,
  type RuntimeSignals,
} from '../../core/domain/knowledge/runtime-signals-schema.js'
import {warnSidecarFailure} from '../../core/domain/knowledge/sidecar-logging.js'

const TOOL_MODE_CURATE_SITE = 'tool-mode-curate'
const TOOL_MODE_QUERY_SITE = 'tool-mode-query'

/**
 * Update the runtime-signal sidecar after a successful tool-mode curate write.
 *
 * - `existedBefore=false` → seed default signals (ADD path).
 * - `existedBefore=true`  → bump importance + recency + updateCount and
 *   recompute maturity (UPDATE path), mirroring the legacy curate-tool's
 *   `mirrorCurateUpdate`.
 *
 * Best-effort: a sidecar failure must never break the write that already
 * succeeded. When a `logger` is passed, the outer error is logged at WARN
 * level via `warnSidecarFailure`; without one, the helper is silent and
 * relies on the underlying `RuntimeSignalStore` (mandatory logger) to
 * surface storage-level failures. Write call sites should pass a logger
 * since curate failures matter; read call sites (executors) skip it to
 * avoid stderr noise on bulk reads.
 */
export async function bumpSidecarOnCurateWrite(params: {
  existedBefore: boolean
  logger?: ILogger
  relPath: string
  store: IRuntimeSignalStore | undefined
}): Promise<void> {
  const {existedBefore, logger, relPath, store} = params
  if (!store) return

  if (existedBefore) {
    try {
      await store.update(relPath, (current: RuntimeSignals): RuntimeSignals => {
        const bumped = recordCurateUpdate(current)
        return {
          ...current,
          importance: bumped.importance,
          maturity: determineTier(bumped.importance, current.maturity),
          recency: bumped.recency,
          updateCount: bumped.updateCount,
        }
      })
    } catch (error) {
      warnSidecarFailure(logger, TOOL_MODE_CURATE_SITE, 'update', relPath, error)
    }

    return
  }

  try {
    await store.set(relPath, createDefaultRuntimeSignals())
  } catch (error) {
    warnSidecarFailure(logger, TOOL_MODE_CURATE_SITE, 'seed', relPath, error)
  }
}

/**
 * Bump the runtime-signal sidecar after a tool-mode query/search returns
 * matched paths.
 *
 * Mirrors `SearchKnowledgeService.mirrorHitsToSignalStore`: applies the
 * canonical access-hit scoring via `recordAccessHits` (bumps `accessCount`
 * AND `importance`) and re-evaluates `maturity` through `determineTier`.
 * Bumping `accessCount` alone would let prune ignore a topic the user
 * actively reads — main's logic intentionally raises importance to keep
 * frequently-accessed topics out of the prune set.
 *
 * Best-effort per path: if one path's update throws, the rest still get
 * processed (failures don't short-circuit the batch). Paths are processed
 * in parallel — different relPaths map to different storage keys, so
 * there's no cross-path lock contention.
 *
 * The `logger` param is optional and intentionally not wired by the
 * executor call sites (search/query) — bulk reads with a flaky sidecar
 * would spam stderr without changing behavior. The underlying store has
 * its own mandatory logger that surfaces storage-layer failures.
 */
export async function bumpSidecarOnQueryRead(params: {
  logger?: ILogger
  relPaths: string[]
  store: IRuntimeSignalStore | undefined
}): Promise<void> {
  const {logger, relPaths, store} = params
  if (!store || relPaths.length === 0) return

  await Promise.all(
    relPaths.map(async (relPath) => {
      try {
        await store.update(relPath, (current: RuntimeSignals): RuntimeSignals => {
          const bumped = recordAccessHits(current, 1)
          return {
            ...current,
            accessCount: bumped.accessCount,
            importance: bumped.importance,
            maturity: determineTier(bumped.importance, current.maturity),
          }
        })
      } catch (error) {
        warnSidecarFailure(logger, TOOL_MODE_QUERY_SITE, 'access-bump', relPath, error)
      }
    }),
  )
}
