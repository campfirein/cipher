import type {ILogger} from '../../../agent/core/interfaces/i-logger.js'
import type {IRuntimeSignalStore} from '../../core/interfaces/storage/i-runtime-signal-store.js'

import {
  determineTier,
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
 * succeeded. Errors are logged at WARN level and swallowed.
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
 * matched paths. Increments `accessCount` per matched path; seeds a default
 * record if the path has no prior signals (first read).
 *
 * Best-effort per path: if one path's update throws, the rest still get
 * processed (failures don't short-circuit the batch). Paths are processed
 * in parallel — different relPaths map to different storage keys, so
 * there's no cross-path lock contention.
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
        await store.update(relPath, (current: RuntimeSignals): RuntimeSignals => ({
          ...current,
          accessCount: current.accessCount + 1,
        }))
      } catch (error) {
        warnSidecarFailure(logger, TOOL_MODE_QUERY_SITE, 'access-bump', relPath, error)
      }
    }),
  )
}
