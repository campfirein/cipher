/**
 * IKeyStorage-backed implementation of {@link IRuntimeSignalStore}.
 *
 * Uses composite keys `["signals", ...pathSegments]`. Atomicity within a
 * single process comes from `IKeyStorage.update`'s per-key RWLock; the
 * interface docs cover the cross-process caveat.
 */

import type {IKeyStorage, StorageKey} from '../../../agent/core/interfaces/i-key-storage.js'
import type {ILogger} from '../../../agent/core/interfaces/i-logger.js'
import type {
  IRuntimeSignalStore,
  RuntimeSignalsUpdater,
} from '../../core/interfaces/storage/i-runtime-signal-store.js'

import {
  createDefaultRuntimeSignals,
  type RuntimeSignals,
  RuntimeSignalsSchema,
} from '../../core/domain/knowledge/runtime-signals-schema.js'

const SIGNALS_PREFIX = 'signals'

// TODO(runtime-signals): callers bumping `importance` must recompute
// `maturity` via `determineTier` in the same updater — the store does not
// enforce the hysteresis relationship. Audit call sites in commit 3.
//
// TODO(runtime-signals): orphan entries accumulate when markdown files are
// deleted outside curate. Add `pruneOrphans(existingPaths)` when commit 6
// lands, or expose via a `brv signals clean` admin command.

export class RuntimeSignalStore implements IRuntimeSignalStore {
  constructor(
    private readonly keyStorage: IKeyStorage,
    private readonly logger: ILogger,
  ) {}

  async batchUpdate(updates: Map<string, RuntimeSignalsUpdater>): Promise<void> {
    // Different relPaths do not share a per-key lock, so parallel updates
    // scale naturally. Each individual update remains atomic because
    // IKeyStorage.update is atomic per key (within one process).
    await Promise.all(
      [...updates.entries()].map(([relPath, updater]) => this.update(relPath, updater)),
    )
  }

  async delete(relPath: string): Promise<void> {
    await this.keyStorage.delete(this.signalKey(relPath))
  }

  async get(relPath: string): Promise<RuntimeSignals> {
    const raw = await this.keyStorage.get<unknown>(this.signalKey(relPath))
    return this.validateOrDefault(raw, relPath)
  }

  async getMany(relPaths: readonly string[]): Promise<Map<string, RuntimeSignals>> {
    const entries = await Promise.all(
      relPaths.map(async (relPath) => [relPath, await this.get(relPath)] as const),
    )
    return new Map(entries)
  }

  async list(): Promise<Map<string, RuntimeSignals>> {
    const entries = await this.keyStorage.listWithValues<unknown>([SIGNALS_PREFIX])
    const result = new Map<string, RuntimeSignals>()

    for (const entry of entries) {
      const relPath = this.relPathFromKey(entry.key)
      if (relPath === null) continue
      result.set(relPath, this.validateOrDefault(entry.value, relPath))
    }

    return result
  }

  async set(relPath: string, signals: RuntimeSignals): Promise<void> {
    const validated = RuntimeSignalsSchema.parse(signals)
    await this.keyStorage.set(this.signalKey(relPath), validated)
  }

  async update(relPath: string, updater: RuntimeSignalsUpdater): Promise<RuntimeSignals> {
    return this.keyStorage.update<RuntimeSignals>(this.signalKey(relPath), (current) => {
      // `current` is typed as RuntimeSignals but the underlying value may be
      // anything the disk held (missing, partial, corrupt). validateOrDefault
      // coerces it into a valid record before the updater runs.
      const base = this.validateOrDefault(current, relPath)
      const merged = updater(base)
      // Re-validate updater output so a buggy caller cannot land invalid
      // data (e.g. importance out of range) on disk.
      return RuntimeSignalsSchema.parse(merged)
    })
  }

  /**
   * Reconstruct the relative path from a `["signals", ...segments]` key.
   * Returns null for keys that do not belong to this store (defensive against
   * the remote chance of namespace collisions during listing).
   */
  private relPathFromKey(key: StorageKey): null | string {
    if (key.length < 2 || key[0] !== SIGNALS_PREFIX) return null
    return key.slice(1).join('/')
  }

  /**
   * Encode a relative path into a composite storage key.
   *
   * FileKeyStorage rejects `/` inside segments, so each path component
   * becomes its own segment. Empty components (from leading, trailing, or
   * consecutive slashes) are dropped so the encoding is insensitive to
   * path normalization variants.
   */
  private signalKey(relPath: string): StorageKey {
    const segments = relPath.split('/').filter((s) => s.length > 0)
    return [SIGNALS_PREFIX, ...segments]
  }

  /**
   * Coerce an unknown stored value into a valid RuntimeSignals record.
   *
   * Missing (`undefined`) yields defaults silently — the common fresh-path
   * case. Corrupt stored data logs a warning and also falls back to
   * defaults so callers never have to handle read errors inline.
   */
  private validateOrDefault(raw: unknown, relPath: string): RuntimeSignals {
    if (raw === undefined) {
      return createDefaultRuntimeSignals()
    }

    const parsed = RuntimeSignalsSchema.safeParse(raw)
    if (parsed.success) return parsed.data

    this.logger.warn(
      `RuntimeSignalStore: discarding corrupt entry for ${relPath}: ${parsed.error.message}`,
    )
    return createDefaultRuntimeSignals()
  }
}
