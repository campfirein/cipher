/**
 * In-memory `IHarnessStore` implementation for unit tests.
 *
 * Phase 2's `HarnessOutcomeRecorder` tests run against this double so
 * they don't depend on the concrete `HarnessStore` (which lives in
 * `src/agent/infra/harness/harness-store.ts`, shipped by Phase 1).
 *
 * Behaviorally equivalent to the real store's contract in the ways
 * Phase 2 consumers rely on:
 *   - `saveVersion` throws `HarnessStoreError(VERSION_CONFLICT)` on
 *     duplicate `id` OR duplicate `(projectId, commandType, version)`
 *     tuple
 *   - `listOutcomes` returns newest first (by `timestamp`)
 *   - `listVersions` returns newest first (by `version`)
 *   - `getLatest` / `getVersion` return `undefined` (not `null`) on miss
 *
 * Intentional simplifications vs. the real store:
 *   - `pruneOldVersions` keeps the newest `keep` by `version` number;
 *     does NOT implement the real store's "preserve best-H parent
 *     chain" rule. Tests that depend on that rule belong in the real
 *     store's own test suite, not Phase 2's recorder tests.
 *   - No Zod validation; the double trusts the caller. The real
 *     store validates on write.
 *   - `recordFeedback` is a no-op on missing outcomes (useful for
 *     tests that flag fixture outcomes without seeding the store
 *     exhaustively). The real store throws `OUTCOME_NOT_FOUND`.
 *
 * Stored values are `structuredClone`d on write and on read so tests
 * stay hermetic — a test mutating a returned object does not see the
 * mutation reflected in the store, and vice versa.
 */

import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessVersion,
} from '../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../src/agent/core/interfaces/i-harness-store.js'

import {HarnessStoreError} from '../../src/agent/core/domain/errors/harness-store-error.js'

const DEFAULT_LIST_OUTCOMES_LIMIT = 100

function partitionKey(projectId: string, commandType: string): string {
  return `${projectId}\u0000${commandType}`
}

function compositeKey(projectId: string, commandType: string, versionId: string): string {
  return `${partitionKey(projectId, commandType)}\u0000${versionId}`
}

export class InMemoryHarnessStore implements IHarnessStore {
  private outcomes = new Map<string, CodeExecOutcome>()
  private scenarios = new Map<string, EvaluationScenario>()
  private versions = new Map<string, HarnessVersion>()

  async deleteOutcome(
    projectId: string,
    commandType: string,
    outcomeId: string,
  ): Promise<boolean> {
    const key = compositeKey(projectId, commandType, outcomeId)
    return this.outcomes.delete(key)
  }

  async deleteOutcomes(projectId: string, commandType: string): Promise<number> {
    const partition = partitionKey(projectId, commandType)
    let deleted = 0
    for (const [key, outcome] of this.outcomes) {
      if (partitionKey(outcome.projectId, outcome.commandType) === partition) {
        this.outcomes.delete(key)
        deleted++
      }
    }

    return deleted
  }

  async deleteScenario(
    projectId: string,
    commandType: string,
    scenarioId: string,
  ): Promise<boolean> {
    const key = compositeKey(projectId, commandType, scenarioId)
    return this.scenarios.delete(key)
  }

  async getLatest(projectId: string, commandType: string): Promise<HarnessVersion | undefined> {
    const matches = this.versionsForPartition(projectId, commandType)
    if (matches.length === 0) return undefined

    let latest = matches[0]
    for (const v of matches) {
      if (v.version > latest.version) latest = v
    }

    return structuredClone(latest)
  }

  async getVersion(
    projectId: string,
    commandType: string,
    versionId: string,
  ): Promise<HarnessVersion | undefined> {
    const hit = this.versions.get(compositeKey(projectId, commandType, versionId))
    return hit ? structuredClone(hit) : undefined
  }

  async listOutcomes(
    projectId: string,
    commandType: string,
    limit?: number,
  ): Promise<CodeExecOutcome[]> {
    const partition = partitionKey(projectId, commandType)
    const matches: CodeExecOutcome[] = []
    for (const outcome of this.outcomes.values()) {
      if (partitionKey(outcome.projectId, outcome.commandType) === partition) {
        matches.push(structuredClone(outcome))
      }
    }

    matches.sort((a, b) => b.timestamp - a.timestamp)
    return matches.slice(0, limit ?? DEFAULT_LIST_OUTCOMES_LIMIT)
  }

  async listScenarios(projectId: string, commandType: string): Promise<EvaluationScenario[]> {
    const partition = partitionKey(projectId, commandType)
    const matches: EvaluationScenario[] = []
    for (const scenario of this.scenarios.values()) {
      if (partitionKey(scenario.projectId, scenario.commandType) === partition) {
        matches.push(structuredClone(scenario))
      }
    }

    return matches
  }

  async listVersions(projectId: string, commandType: string): Promise<HarnessVersion[]> {
    const matches = this.versionsForPartition(projectId, commandType).map((v) => structuredClone(v))
    matches.sort((a, b) => b.version - a.version)
    return matches
  }

  async pruneOldVersions(projectId: string, commandType: string, keep: number): Promise<number> {
    const matches = this.versionsForPartition(projectId, commandType)
    if (matches.length <= keep) return 0

    const sorted = [...matches].sort((a, b) => b.version - a.version)
    const toDelete = sorted.slice(keep)
    for (const v of toDelete) {
      this.versions.delete(compositeKey(v.projectId, v.commandType, v.id))
    }

    return toDelete.length
  }

  async recordFeedback(
    projectId: string,
    commandType: string,
    outcomeId: string,
    verdict: 'bad' | 'good' | null,
  ): Promise<void> {
    const partition = partitionKey(projectId, commandType)
    for (const [key, outcome] of this.outcomes) {
      if (
        partitionKey(outcome.projectId, outcome.commandType) === partition &&
        outcome.id === outcomeId
      ) {
        this.outcomes.set(key, structuredClone({...outcome, userFeedback: verdict}))
        return
      }
    }
    // Silent no-op on miss. See module header for the rationale.
  }

  async saveOutcome(outcome: CodeExecOutcome): Promise<void> {
    const key = compositeKey(outcome.projectId, outcome.commandType, outcome.id)
    this.outcomes.set(key, structuredClone(outcome))
  }

  async saveScenario(scenario: EvaluationScenario): Promise<void> {
    const key = compositeKey(scenario.projectId, scenario.commandType, scenario.id)
    this.scenarios.set(key, structuredClone(scenario))
  }

  async saveVersion(version: HarnessVersion): Promise<void> {
    const key = compositeKey(version.projectId, version.commandType, version.id)
    if (this.versions.has(key)) {
      throw HarnessStoreError.versionConflict(version.projectId, version.commandType, {
        id: version.id,
      })
    }

    const clash = this.versionsForPartition(version.projectId, version.commandType).find(
      (v) => v.version === version.version,
    )
    if (clash) {
      throw HarnessStoreError.versionConflict(version.projectId, version.commandType, {
        version: version.version,
      })
    }

    this.versions.set(key, structuredClone(version))
  }

  private versionsForPartition(projectId: string, commandType: string): HarnessVersion[] {
    const partition = partitionKey(projectId, commandType)
    const matches: HarnessVersion[] = []
    for (const v of this.versions.values()) {
      if (partitionKey(v.projectId, v.commandType) === partition) {
        matches.push(v)
      }
    }

    return matches
  }
}
