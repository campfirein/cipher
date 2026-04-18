/**
 * Sidecar store for per-machine ranking signals.
 *
 * Keeps `importance`, `recency`, `maturity`, `accessCount`, `updateCount`
 * out of context-tree markdown frontmatter so that query-time bumps don't
 * dirty version-controlled files or create merge conflicts across teammates.
 *
 * Backed by `IKeyStorage` with composite keys of the form
 * `["signals", ...pathSegments]`. The relative path is split on `/` so each
 * segment satisfies the key-storage validation rules.
 *
 * All paths are relative to the context tree root (e.g. `auth/jwt-refresh.md`)
 * using forward slashes, matching how paths flow through the rest of the
 * knowledge pipeline.
 *
 * ## Concurrency guarantees
 *
 * Atomicity applies **within a single process**. Two `update` calls on the
 * same path in the same process serialize via the per-key RWLock inside
 * `FileKeyStorage` — no lost updates.
 *
 * Across processes (daemon + CLI), the per-process locks do not coordinate,
 * so there is a narrow lost-update window when both processes race a read-
 * modify-write on the same entry. For ranking signals this is acceptable:
 * losing one access-hit bump has no correctness impact, only a tiny
 * ranking drift that the next session self-heals. Do **not** rely on
 * this interface for data where consistency is required (e.g. identifiers,
 * counters that must never skip).
 *
 * ## Invariants NOT enforced here
 *
 * The store accepts any `RuntimeSignals` record that satisfies the schema —
 * it does not enforce semantic invariants such as the importance ↔ maturity
 * hysteresis defined by `determineTier`. Callers bumping `importance` must
 * recompute `maturity` themselves (typically via `determineTier`) as part
 * of the same updater callback.
 */

import type {RuntimeSignals} from '../../domain/knowledge/runtime-signals-schema.js'

/**
 * Pure function that derives the next signals from the current signals.
 * Called inside an atomic read-modify-write critical section.
 */
export type RuntimeSignalsUpdater = (current: RuntimeSignals) => RuntimeSignals

export interface IRuntimeSignalStore {
  /**
   * Apply an updater to many entries in parallel.
   *
   * Each entry is updated atomically via {@link update}; different paths run
   * concurrently. Used by the access-hit flush path which accumulates bumps
   * across many files between index rebuilds.
   */
  batchUpdate(updates: Map<string, RuntimeSignalsUpdater>): Promise<void>

  /**
   * Remove an entry. No-op if the entry does not exist.
   *
   * Called when a file is archived or deleted so the sidecar does not retain
   * orphan records.
   */
  delete(relPath: string): Promise<void>

  /**
   * Read the signals for a path, returning defaults when no entry exists
   * or when the stored record fails schema validation.
   *
   * Never throws and never returns null — callers can treat every path as
   * having a signal record.
   */
  get(relPath: string): Promise<RuntimeSignals>

  /**
   * Bulk-read signals for a known set of paths.
   *
   * Preferred over {@link list} for ranking passes that operate on the
   * top-N search results: O(N) where N is the number of requested paths,
   * instead of O(all stored entries). The returned map always has an entry
   * for every requested path — missing and corrupt records fall back to
   * defaults, matching {@link get}.
   */
  getMany(relPaths: readonly string[]): Promise<Map<string, RuntimeSignals>>

  /**
   * Snapshot every stored entry as a Map keyed by relative path.
   *
   * Intended for administrative passes (diagnostics, orphan pruning) rather
   * than per-query ranking — use {@link getMany} for that.
   */
  list(): Promise<Map<string, RuntimeSignals>>

  /**
   * Replace the signals for a path with the provided record.
   *
   * Used for seeding (curate ADD with defaults) and for operations that
   * compute a full new record without needing the current value (merge,
   * restore).
   */
  set(relPath: string, signals: RuntimeSignals): Promise<void>

  /**
   * Atomically read, transform, and write the signals for a path.
   *
   * The updater receives the current signals (defaults if none are stored)
   * and must return the complete replacement record. Runs inside the
   * per-key lock provided by {@link IKeyStorage.update}, so concurrent
   * callers on the same path within one process serialize cleanly — no
   * lost updates. See the interface-level note about cross-process
   * behaviour.
   *
   * Use this for any bump semantics that depend on the current value, e.g.
   * `accessCount += hits` or `importance = min(100, current + bonus)`.
   */
  update(relPath: string, updater: RuntimeSignalsUpdater): Promise<RuntimeSignals>
}
