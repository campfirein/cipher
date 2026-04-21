/**
 * AutoHarness V2 storage — `IKeyStorage`-backed implementation.
 *
 * Facade over `IKeyStorage` that partitions harness versions, outcomes,
 * and scenarios under composite key prefixes. This file ships the
 * version CRUD (Phase 1 Task 1.2); outcome and scenario CRUD land in
 * Task 1.3 — those methods are `throw 'not implemented yet'` stubs
 * here so the class satisfies the interface and stays compile-valid
 * mid-phase.
 *
 * Key-space layout (see `tasks/phase_1_2_handoff.md §C4`):
 *   ["harness", "version",  projectId, commandType, versionId]
 *   ["harness", "outcome",  projectType, projectId, commandType, outcomeId]   (Task 1.3)
 *   ["harness", "scenario", projectType, projectId, commandType, scenarioId]  (Task 1.3)
 *
 * `HarnessVersion` bodies are inlined in the key record — typical
 * harness code is <10KB. If that ceiling moves, swap the code field to
 * an `IBlobStorage` reference; consumers see no interface change.
 *
 * Atomicity per-key comes from `IKeyStorage.update`'s RWLock within a
 * process; cross-key writes are not atomic. Single-writer flows
 * (bootstrap v1, refinement serialized per (projectId, commandType))
 * make that sufficient for v1.0 — see the `IHarnessStore` module header.
 */

import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessVersion,
} from '../../core/domain/harness/types.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {BatchOperation, IKeyStorage, StorageKey} from '../../core/interfaces/i-key-storage.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'

import {HarnessStoreError} from '../../core/domain/errors/harness-store-error.js'
import {HarnessVersionSchema} from '../../core/domain/harness/types.js'

const HARNESS_PREFIX = 'harness'
const VERSION_PREFIX = 'version'

const TASK_1_3_PENDING =
  'Not implemented — HarnessStore: outcome/scenario CRUD lands in Phase 1 Task 1.3'

export class HarnessStore implements IHarnessStore {
  constructor(
    private readonly keyStorage: IKeyStorage,
    private readonly logger: ILogger,
  ) {}

  // ── outcomes (Task 1.3 stubs) ──────────────────────────────────────────────

  async deleteOutcomes(_projectId: string, _commandType: string): Promise<number> {
    throw new Error(TASK_1_3_PENDING)
  }

  // ── versions ───────────────────────────────────────────────────────────────

  async getLatest(projectId: string, commandType: string): Promise<HarnessVersion | undefined> {
    // Delegate to `listVersions` rather than re-deriving the "max version"
    // comparator — a future change to the sort key can't silently break
    // `getLatest`. The O(n log n) sort is negligible at v1.0 scale
    // (`maxVersions` default 20).
    const sorted = await this.listVersions(projectId, commandType)
    return sorted[0]
  }

  async getVersion(
    projectId: string,
    commandType: string,
    versionId: string,
  ): Promise<HarnessVersion | undefined> {
    return this.keyStorage.get<HarnessVersion>(this.versionKey(projectId, commandType, versionId))
  }

  async listOutcomes(
    _projectId: string,
    _commandType: string,
    _limit?: number,
  ): Promise<CodeExecOutcome[]> {
    throw new Error(TASK_1_3_PENDING)
  }

  async listScenarios(_projectId: string, _commandType: string): Promise<EvaluationScenario[]> {
    throw new Error(TASK_1_3_PENDING)
  }

  async listVersions(projectId: string, commandType: string): Promise<HarnessVersion[]> {
    const versions = await this.listVersionsForPair(projectId, commandType)
    return [...versions].sort((a, b) => b.version - a.version)
  }

  /**
   * Preservation policy:
   *   1. Latest (highest `version`) is always kept.
   *   2. Best-heuristic version AND its parent chain (up to the root) are
   *      kept, so refinement history stays traceable.
   *   3. Remaining versions are dropped oldest-first until at most `keep`
   *      versions remain — OR until only preserved versions remain,
   *      whichever hits first. If preservation demands more than `keep`,
   *      the preserved set wins (matches the Phase 1 Task 1.2 test doc's
   *      test #12 semantics).
   */
  async pruneOldVersions(
    projectId: string,
    commandType: string,
    keep: number,
  ): Promise<number> {
    // Precondition: `keep` is a non-negative integer. Defensive validation
    // at this interface boundary catches caller bugs (e.g. a future CLI
    // passing `--keep -1`) with an immediate, clear error rather than a
    // silent "all non-preserved candidates deleted" behavior.
    if (!Number.isInteger(keep) || keep < 0) {
      throw new RangeError(`pruneOldVersions: keep must be a non-negative integer, got ${keep}`)
    }

    const versions = await this.listVersionsForPair(projectId, commandType)
    if (versions.length <= keep) return 0

    const preserved = new Set<string>()
    const byId = new Map(versions.map((v) => [v.id, v]))

    let latest = versions[0]
    let bestH = versions[0]
    for (const v of versions) {
      if (v.version > latest.version) latest = v
      if (v.heuristic > bestH.heuristic) bestH = v
    }

    preserved.add(latest.id)
    preserved.add(bestH.id)

    // Walk parent chain of best-H. Break on missing parent (dangling)
    // OR on an already-preserved id (defensive cycle guard).
    let cursor: HarnessVersion | undefined = bestH
    while (cursor?.parentId !== undefined) {
      const parent = byId.get(cursor.parentId)
      if (!parent) break
      if (preserved.has(parent.id)) break
      preserved.add(parent.id)
      cursor = parent
    }

    const candidates = versions
      .filter((v) => !preserved.has(v.id))
      .sort((a, b) => a.version - b.version)

    const deleteCount = Math.min(candidates.length, versions.length - keep)
    if (deleteCount <= 0) return 0

    const toDelete = candidates.slice(0, deleteCount)
    const operations: BatchOperation[] = toDelete.map((v) => ({
      key: this.versionKey(v.projectId, v.commandType, v.id),
      type: 'delete' as const,
    }))

    await this.keyStorage.batch(operations)
    this.logger.debug('HarnessStore.pruneOldVersions deleted entries', {
      commandType,
      deleted: toDelete.length,
      projectId,
    })

    return toDelete.length
  }

  async recordFeedback(
    _projectId: string,
    _commandType: string,
    _outcomeId: string,
    _verdict: 'bad' | 'good' | null,
  ): Promise<void> {
    throw new Error(TASK_1_3_PENDING)
  }

  async saveOutcome(_outcome: CodeExecOutcome): Promise<void> {
    throw new Error(TASK_1_3_PENDING)
  }

  async saveScenario(_scenario: EvaluationScenario): Promise<void> {
    throw new Error(TASK_1_3_PENDING)
  }

  async saveVersion(version: HarnessVersion): Promise<void> {
    const parsed = HarnessVersionSchema.parse(version)
    const key = this.versionKey(parsed.projectId, parsed.commandType, parsed.id)

    // NOTE: this sibling-version-number check is racy across concurrent
    // `saveVersion` calls with the SAME `(projectId, commandType, version)`
    // tuple but DIFFERENT ids — closing that window would require a
    // cross-key lock. Accepted for v1.0 because Phase 6's refinement
    // queue serializes writes per `(projectId, commandType)`; if that
    // assumption breaks, introduce a per-pair mutex.
    const siblings = await this.listVersionsForPair(parsed.projectId, parsed.commandType)
    const clash = siblings.find((v) => v.version === parsed.version)
    if (clash !== undefined) {
      throw HarnessStoreError.versionConflict(parsed.projectId, parsed.commandType, {
        version: parsed.version,
      })
    }

    // Id-uniqueness check is closed atomically via `update` — the read,
    // updater evaluation, and write all happen under the same per-key
    // RWLock, so concurrent saves with the same id can't both succeed.
    //
    // `FileKeyStorage.update` rewraps thrown errors as plain `Error`,
    // discarding the typed `HarnessStoreError` class. To preserve the
    // caller-facing error type, we signal the conflict via a closure
    // flag instead — the updater returns the existing value unchanged
    // (effective no-op write), and we throw the typed error once
    // `update` resolves normally.
    let idConflict = false
    await this.keyStorage.update<HarnessVersion | undefined>(key, (existing) => {
      if (existing !== undefined) {
        idConflict = true
        return existing
      }

      return parsed
    })
    if (idConflict) {
      throw HarnessStoreError.versionConflict(parsed.projectId, parsed.commandType, {
        id: parsed.id,
      })
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async listVersionsForPair(
    projectId: string,
    commandType: string,
  ): Promise<HarnessVersion[]> {
    const entries = await this.keyStorage.listWithValues<HarnessVersion>([
      HARNESS_PREFIX,
      VERSION_PREFIX,
      projectId,
      commandType,
    ])
    return entries.map((e) => e.value)
  }

  private versionKey(projectId: string, commandType: string, versionId: string): StorageKey {
    return [HARNESS_PREFIX, VERSION_PREFIX, projectId, commandType, versionId]
  }
}
