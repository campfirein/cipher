import {randomUUID} from 'node:crypto'

import type {HarnessVersion} from '../../core/domain/harness/types.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../agent/agent-schemas.js'

import {
  HarnessStoreError,
  HarnessStoreErrorCode,
} from '../../core/domain/errors/harness-store-error.js'
import {detectAndPickTemplate} from './detect-and-pick-template.js'
import {getTemplate} from './templates/index.js'

// Heuristic starting value per v1-design-decisions.md §2.1 — Mode A threshold.
// Option C pass-through templates cap the steady-state heuristic at 0.50, so
// starting at 0.30 keeps v1 inside Mode A from the first call without flipping
// into Mode B/C before refinement lands in Phase 6.
const V1_STARTING_HEURISTIC = 0.3

export class HarnessBootstrap {
  // Per-pair single-flight map — collapses concurrent bootstrap attempts
  // for the same (projectId, commandType) into one actual save. The
  // underlying store's sibling-version check is documented racy under
  // concurrent saveVersion calls with the same version number but
  // different ids (harness-store.ts:282); this map closes that window
  // for bootstrap-originated writes.
  private readonly inFlight = new Map<string, Promise<void>>()

  constructor(
    private readonly store: IHarnessStore,
    private readonly fileSystem: IFileSystem,
    private readonly config: ValidatedHarnessConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * Idempotent. If a harness version already exists for
   * `(projectId, commandType)`, returns silently. Otherwise writes v1
   * from the Option C template that matches the detected project type.
   *
   * Race-safe: 100 parallel calls on the same pair produce exactly one
   * v1. Concurrent callers share the same in-flight promise; losers on
   * a cross-process race catch `VERSION_CONFLICT` and return silently.
   */
  async bootstrapIfNeeded(
    projectId: string,
    commandType: 'chat' | 'curate' | 'query',
    workingDirectory: string,
  ): Promise<void> {
    // `\x00` is forbidden in both fields so the join is unambiguous.
    const pairKey = `${projectId}\u0000${commandType}`
    const inFlight = this.inFlight.get(pairKey)
    if (inFlight !== undefined) return inFlight

    const promise = this.doBootstrap(projectId, commandType, workingDirectory)
    this.inFlight.set(pairKey, promise)
    try {
      await promise
    } finally {
      this.inFlight.delete(pairKey)
    }
  }

  private async doBootstrap(
    projectId: string,
    commandType: 'chat' | 'curate' | 'query',
    workingDirectory: string,
  ): Promise<void> {
    if (!this.config.enabled) return

    const existing = await this.store.getLatest(projectId, commandType)
    if (existing !== undefined) return

    // v1.0 ships curate templates only (Task 4.3). chat/query bootstraps
    // are graceful no-ops until template coverage extends.
    if (commandType !== 'curate') {
      this.logger.debug('HarnessBootstrap: no template for commandType — skipping', {
        commandType,
        projectId,
      })
      return
    }

    const projectType = await detectAndPickTemplate(
      workingDirectory,
      this.fileSystem,
      this.config,
      this.logger,
    )
    const template = getTemplate(commandType, projectType)

    const version: HarnessVersion = {
      code: template.code,
      commandType,
      createdAt: Date.now(),
      heuristic: V1_STARTING_HEURISTIC,
      id: randomUUID(),
      metadata: template.meta,
      projectId,
      projectType,
      version: 1,
    }

    try {
      await this.store.saveVersion(version)
      this.logger.info('HarnessBootstrap: wrote v1 harness', {
        commandType,
        projectId,
        projectType,
        versionId: version.id,
      })
    } catch (error) {
      if (HarnessStoreError.isCode(error, HarnessStoreErrorCode.VERSION_CONFLICT)) {
        // Expected race outcome: another bootstrapIfNeeded call wrote v1
        // first. Both callers wanted the same thing; the existing v1 is
        // the correct end state.
        this.logger.debug('HarnessBootstrap: lost race — existing v1 satisfies the caller', {
          commandType,
          projectId,
        })
        return
      }

      this.logger.error('HarnessBootstrap: saveVersion failed with unexpected error', {
        commandType,
        error: error instanceof Error ? error.message : String(error),
        projectId,
      })
      throw error
    }
  }
}
