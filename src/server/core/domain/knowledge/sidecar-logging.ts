/**
 * Shared helper for observing swallowed sidecar failures.
 *
 * Runtime-signals dual-write is best-effort: failures never break the
 * caller's primary operation (markdown write, ranking read, etc.). After
 * commit 5 the sidecar is the canonical source for ranking signals, so
 * silent swallows hide real outages from operators. Every site that
 * swallows a sidecar error should call this helper from inside the catch.
 *
 * The log message shape is stable across call sites so operators can
 * grep for `sidecar <verb> failed` to surface every occurrence.
 */

import type {ILogger} from '../../../../agent/core/interfaces/i-logger.js'

export function warnSidecarFailure(
  logger: ILogger | undefined,
  site: string,
  verb: string,
  target: string,
  error: unknown,
): void {
  if (!logger) return
  const message = error instanceof Error ? error.message : String(error)
  logger.warn(`${site}: sidecar ${verb} failed for ${target}: ${message}`)
}
