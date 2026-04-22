/**
 * AutoHarness V2 storage — `IKeyStorage`-backed implementation.
 *
 * Facade over `IKeyStorage` that partitions harness versions, outcomes,
 * and scenarios under composite key prefixes.
 *
 * Key-space layout (see `tasks/phase_1_2_handoff.md §C4`):
 *   ["harness", "version",  projectId, commandType, versionId]
 *   ["harness", "outcome",  projectType, projectId, commandType, outcomeId]
 *   ["harness", "scenario", projectType, projectId, commandType, scenarioId]
 *
 * `projectType` appears in the outcome/scenario prefix (not version) —
 * enables a v1.1 cross-project aggregation query
 * (`list(["harness", "outcome", "typescript"])`) without a migration.
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
import {
  CodeExecOutcomeSchema,
  EvaluationScenarioSchema,
  HarnessVersionSchema,
  ProjectTypeSchema,
} from '../../core/domain/harness/types.js'

const HARNESS_PREFIX = 'harness'
const VERSION_PREFIX = 'version'
const OUTCOME_PREFIX = 'outcome'
const SCENARIO_PREFIX = 'scenario'

/**
 * Default cap when `listOutcomes` is called without an explicit `limit`.
 * Keeps the heuristic's 50-outcome window comfortably within range while
 * bounding memory for bad callers.
 */
const DEFAULT_LIST_OUTCOMES_LIMIT = 100

export class HarnessStore implements IHarnessStore {
  constructor(
    private readonly keyStorage: IKeyStorage,
    private readonly logger: ILogger,
  ) {}

  // ── outcomes ──────────────────────────────────────────────────────────────

  async deleteOutcome(
    projectId: string,
    commandType: string,
    outcomeId: string,
  ): Promise<boolean> {
    // Outcome key includes projectType, which we don't have. Try all
    // three values — at most 3 lookups, acceptable for user-driven
    // feedback operations.
    //
    // TOCTOU window between get() and delete() is harmless: a concurrent
    // writer cannot change the key under us (IDs are deterministic), and
    // a concurrent delete simply makes ours a no-op. Same reasoning as
    // deleteScenario.
    for (const projectType of ProjectTypeSchema.options) {
      const key = this.outcomeKey(projectType, projectId, commandType, outcomeId)
      // eslint-disable-next-line no-await-in-loop
      const hit = await this.keyStorage.get(key)
      if (hit !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await this.keyStorage.delete(key)
        return true
      }
    }

    return false
  }

  async deleteOutcomes(projectId: string, commandType: string): Promise<number> {
    const keys: StorageKey[] = []
    for (const projectType of ProjectTypeSchema.options) {
      // eslint-disable-next-line no-await-in-loop
      const entries = await this.keyStorage.listWithValues<CodeExecOutcome>([
        HARNESS_PREFIX,
        OUTCOME_PREFIX,
        projectType,
        projectId,
        commandType,
      ])
      for (const entry of entries) keys.push(entry.key)
    }

    if (keys.length === 0) return 0

    const operations: BatchOperation[] = keys.map((key) => ({key, type: 'delete' as const}))
    await this.keyStorage.batch(operations)
    this.logger.debug('HarnessStore.deleteOutcomes cleared partition', {
      commandType,
      deleted: keys.length,
      projectId,
    })

    return keys.length
  }

  // ── scenarios ─────────────────────────────────────────────────────────────

  async deleteScenario(
    projectId: string,
    commandType: string,
    scenarioId: string,
  ): Promise<boolean> {
    for (const projectType of ProjectTypeSchema.options) {
      const key = this.scenarioKey(projectType, projectId, commandType, scenarioId)
      // eslint-disable-next-line no-await-in-loop
      const exists = await this.keyStorage.exists(key)
      if (exists) {
        // keyStorage.delete is idempotent on missing keys, so the narrow
        // TOCTOU window between exists() and delete() is harmless — a
        // concurrent deleteOutcomes could remove the key in between, but
        // the delete call simply no-ops.
        // eslint-disable-next-line no-await-in-loop
        await this.keyStorage.delete(key)
        this.logger.debug('HarnessStore.deleteScenario removed entry', {
          commandType,
          projectId,
          scenarioId,
        })
        return true
      }
    }

    return false
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
    projectId: string,
    commandType: string,
    limit?: number,
  ): Promise<CodeExecOutcome[]> {
    // Precondition: `limit` (when provided) is a positive integer. Invalid
    // values degrade silently to the default rather than throwing, since
    // this method is read-only and a bad limit is strictly a caller hint.
    const cap =
      limit !== undefined && Number.isInteger(limit) && limit > 0
        ? limit
        : DEFAULT_LIST_OUTCOMES_LIMIT

    const matches = await this.listOutcomesAcrossPartitions(projectId, commandType)
    matches.sort((a, b) => b.timestamp - a.timestamp)
    return matches.slice(0, cap)
  }

  async listScenarios(projectId: string, commandType: string): Promise<EvaluationScenario[]> {
    const matches: EvaluationScenario[] = []
    for (const projectType of ProjectTypeSchema.options) {
      // eslint-disable-next-line no-await-in-loop
      const entries = await this.keyStorage.listWithValues<EvaluationScenario>([
        HARNESS_PREFIX,
        SCENARIO_PREFIX,
        projectType,
        projectId,
        commandType,
      ])
      for (const entry of entries) matches.push(entry.value)
    }

    // No temporal order on scenarios — return in insertion-stable order
    // per the interface docstring.
    return matches
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
    projectId: string,
    commandType: string,
    outcomeId: string,
    verdict: 'bad' | 'good' | null,
  ): Promise<void> {
    // `recordFeedback`'s signature doesn't carry `projectType`, so we
    // locate the outcome by scanning all partitions first.
    //
    // Uses `get` + `set` rather than `keyStorage.update` because
    // `FileKeyStorage.update` wraps thrown errors as plain `Error`,
    // which would mangle the typed `HarnessStoreError.outcomeNotFound`
    // we want to surface on the narrow race where the outcome is
    // deleted between our locate scan and the read. That race window
    // is non-corrupting — we simply report `OUTCOME_NOT_FOUND` to the
    // caller. In practice Phase 2 callers flag outcomes they just
    // read from `listOutcomes`, so the race is negligible.
    const locatedKey = await this.findOutcomeKey(projectId, commandType, outcomeId)
    if (locatedKey === undefined) {
      throw HarnessStoreError.outcomeNotFound(projectId, commandType, outcomeId)
    }

    const current = await this.keyStorage.get<CodeExecOutcome>(locatedKey)
    if (current === undefined) {
      throw HarnessStoreError.outcomeNotFound(projectId, commandType, outcomeId)
    }

    await this.keyStorage.set(locatedKey, {...current, userFeedback: verdict})
  }

  async saveOutcome(outcome: CodeExecOutcome): Promise<void> {
    const parsed = CodeExecOutcomeSchema.parse(outcome)
    const key = this.outcomeKey(
      parsed.projectType,
      parsed.projectId,
      parsed.commandType,
      parsed.id,
    )
    // Duplicate `id` is an idempotent overwrite per the interface docs.
    await this.keyStorage.set(key, parsed)
  }

  async saveScenario(scenario: EvaluationScenario): Promise<void> {
    const parsed = EvaluationScenarioSchema.parse(scenario)
    const key = this.scenarioKey(
      parsed.projectType,
      parsed.projectId,
      parsed.commandType,
      parsed.id,
    )
    await this.keyStorage.set(key, parsed)
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

  private async findOutcomeKey(
    projectId: string,
    commandType: string,
    outcomeId: string,
  ): Promise<StorageKey | undefined> {
    for (const projectType of ProjectTypeSchema.options) {
      const key = this.outcomeKey(projectType, projectId, commandType, outcomeId)
      // eslint-disable-next-line no-await-in-loop
      const hit = await this.keyStorage.exists(key)
      if (hit) return key
    }

    return undefined
  }

  private async listOutcomesAcrossPartitions(
    projectId: string,
    commandType: string,
  ): Promise<CodeExecOutcome[]> {
    const matches: CodeExecOutcome[] = []
    for (const projectType of ProjectTypeSchema.options) {
      // eslint-disable-next-line no-await-in-loop
      const entries = await this.keyStorage.listWithValues<CodeExecOutcome>([
        HARNESS_PREFIX,
        OUTCOME_PREFIX,
        projectType,
        projectId,
        commandType,
      ])
      for (const entry of entries) matches.push(entry.value)
    }

    return matches
  }

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

  private outcomeKey(
    projectType: string,
    projectId: string,
    commandType: string,
    outcomeId: string,
  ): StorageKey {
    return [HARNESS_PREFIX, OUTCOME_PREFIX, projectType, projectId, commandType, outcomeId]
  }

  private scenarioKey(
    projectType: string,
    projectId: string,
    commandType: string,
    scenarioId: string,
  ): StorageKey {
    return [HARNESS_PREFIX, SCENARIO_PREFIX, projectType, projectId, commandType, scenarioId]
  }

  private versionKey(projectId: string, commandType: string, versionId: string): StorageKey {
    return [HARNESS_PREFIX, VERSION_PREFIX, projectId, commandType, versionId]
  }
}
