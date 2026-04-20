/**
 * Storage interface for AutoHarness V2.
 *
 * Abstraction for persisting:
 *   - harness versions (immutable records of learned code),
 *   - code_exec outcomes (the raw signal the heuristic + refiner read from),
 *   - evaluation scenarios (fixtures used to score candidate refinements).
 *
 * Each entity is partitioned by the composite key `(projectId, commandType)`.
 * Outcomes and scenarios additionally carry `projectType` at the entity
 * level so a v1.1 cross-project aggregation query is a data-layer
 * filter, not a schema migration.
 *
 * ## Atomicity
 *
 * The interface does NOT promise cross-method transactions. Implementations
 * are expected to provide per-key serialization via the underlying
 * `IBlobStorage` + `IKeyStorage` primitives — enough for the single-writer
 * flows this store supports (bootstrap writes v1 once; refinement writes
 * vN+1 serialized by the in-process refinement queue). Multi-key or
 * cross-entity atomicity is not a store concern for v1.0.
 *
 * ## Known extension (Phase 7)
 *
 * `brv harness use <version-id>` pins an explicit "active" version per
 * `(projectId, commandType)`. That pin needs `setActiveVersion` +
 * `getActiveVersion` on the store. Intentionally NOT added in this
 * skeleton — the consumer lands in Phase 7, extending the interface then
 * is purely additive. `getLatest` here means "most-recently-written
 * version", which will coexist with the pin concept without ambiguity.
 *
 * Method order is alphabetical to match the repo's `perfectionist/sort-
 * interfaces` convention. Per-method JSDoc groups them conceptually.
 */

import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessVersion,
} from '../../infra/harness/types.js'

export interface IHarnessStore {
  /**
   * Delete every outcome for a `(projectId, commandType)` pair — invoked by
   * `brv harness reset` (Phase 7) and by the migration hatch in test
   * fixtures. Returns the number of records deleted.
   */
  deleteOutcomes(projectId: string, commandType: string): Promise<number>

  /**
   * Return the most-recently-written version for a `(projectId, commandType)`
   * pair — ranked by the stored `version` number, not by `heuristic`. This
   * is "newest" semantics, not "best" semantics. Phase 7's pinned-version
   * concept lives in a separate method (see the Known extension note in
   * the module header).
   */
  getLatest(projectId: string, commandType: string): Promise<HarnessVersion | null>

  /**
   * Fetch a specific version by its id. Returns `null` when the id is not
   * in the store; does not throw on miss.
   */
  getVersion(
    projectId: string,
    commandType: string,
    versionId: string,
  ): Promise<HarnessVersion | null>

  /**
   * List outcomes for a `(projectId, commandType)` pair, newest first.
   * `limit` caps the returned array; when omitted, implementations
   * typically return the last ~50–100 entries (consumer-defined) but
   * should never promise unbounded.
   */
  listOutcomes(
    projectId: string,
    commandType: string,
    limit?: number,
  ): Promise<CodeExecOutcome[]>

  /**
   * List every scenario for a `(projectId, commandType)` pair. Used by the
   * evaluator to score candidate harness versions. Per-project scope
   * prevents cross-contamination between users.
   */
  listScenarios(
    projectId: string,
    commandType: string,
  ): Promise<EvaluationScenario[]>

  /**
   * Snapshot every stored version for a `(projectId, commandType)` pair,
   * ordered from oldest to newest. At typical v1.0 scale (`maxVersions`
   * default 20), the array fits comfortably in memory.
   */
  listVersions(projectId: string, commandType: string): Promise<HarnessVersion[]>

  /**
   * Prune older versions, keeping at most `keep` records for the pair.
   * Implementations should preserve:
   *   1. the latest version (highest `version` number),
   *   2. the parent chain of the best-H version on record,
   * and drop the remainder starting from the oldest.
   *
   * Returns the number of versions deleted.
   */
  pruneOldVersions(
    projectId: string,
    commandType: string,
    keep: number,
  ): Promise<number>

  /**
   * Set the `userFeedback` field on a stored outcome. `null` clears a prior
   * flag (distinct from "never flagged" which is `undefined` on the
   * record).
   *
   * This method does NOT insert synthetic weighted outcomes — that is the
   * caller's responsibility (Phase 2's `HarnessOutcomeRecorder.attachFeedback`
   * calls this to set the field, then calls `saveOutcome` 3× for `'bad'` or
   * 1× for `'good'` per the design's weighting policy). Keeping the store
   * primitive means the policy can evolve without a storage-layer edit.
   */
  recordFeedback(outcomeId: string, verdict: 'bad' | 'good' | null): Promise<void>

  /**
   * Persist a code_exec outcome. Includes the raw outcome fields plus the
   * `usedHarness` / `delegated` / `userFeedback` flags the heuristic reads.
   * Implementations may accept duplicate `id` as an idempotent overwrite.
   */
  saveOutcome(outcome: CodeExecOutcome): Promise<void>

  /**
   * Persist an evaluation scenario for a `(projectId, commandType)` pair.
   * Scenarios are captured from both successful AND failed sessions —
   * negative scenarios prevent the refiner from "improving" into a harness
   * that succeeds by damaging data.
   */
  saveScenario(scenario: EvaluationScenario): Promise<void>

  /**
   * Persist a new harness version. Templates bootstrap as v1; refinements
   * write v2, v3, … each pointing to a parent. Implementations must reject
   * a version with a clashing `id` or a `(projectId, commandType, version)`
   * tuple that already exists.
   */
  saveVersion(version: HarnessVersion): Promise<void>
}
