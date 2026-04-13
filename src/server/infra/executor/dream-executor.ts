/**
 * DreamExecutor - Orchestrates background memory consolidation ("dreaming").
 *
 * 8-step flow:
 * 1. Capture pre-state snapshot
 * 2. Load dream state
 * 3. Find changed files since last dream (via curate log scanning)
 * 4. Run operations (NO-OP stubs in Phase 1 — consolidate/synthesize/prune added later)
 * 5. Post-dream propagation (staleness + manifest rebuild)
 * 6. Write dream log
 * 7. Update dream state
 * 8. Release lock (in finally block)
 *
 * Lock lifecycle: caller acquires lock via DreamTrigger; this executor releases on
 * success or rolls back on error so the time gate isn't fooled.
 */

import {access} from 'node:fs/promises'
import {isAbsolute, join, sep} from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {FileState} from '../../core/domain/entities/context-tree-snapshot.js'
import type {CurateLogEntry} from '../../core/domain/entities/curate-log-entry.js'
import type {CurateLogStatus} from '../../core/interfaces/storage/i-curate-log-store.js'
import type {DreamLogEntry, DreamLogSummary, DreamOperation} from '../dream/dream-log-schema.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {FileContextTreeManifestService} from '../context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../context-tree/file-context-tree-summary-service.js'
import {diffStates} from '../context-tree/snapshot-diff.js'
import {consolidate, type ConsolidateDeps} from '../dream/operations/consolidate.js'

const DREAM_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export type DreamExecutorDeps = {
  curateLogStore: {
    list(filters?: {after?: number; before?: number; limit?: number; status?: CurateLogStatus[]}): Promise<CurateLogEntry[]>
  }
  dreamLockService: {
    release(): Promise<void>
    rollback(priorMtime: number): Promise<void>
  }
  dreamLogStore: {
    getNextId(): Promise<string>
    save(entry: DreamLogEntry): Promise<void>
  }
  dreamStateService: {
    read(): Promise<import('../dream/dream-state-schema.js').DreamState>
    write(state: import('../dream/dream-state-schema.js').DreamState): Promise<void>
  }
  searchService: ConsolidateDeps['searchService']
}

type DreamExecuteOptions = {
  priorMtime: number
  projectRoot: string
  taskId: string
  trigger: 'agent-idle' | 'cli' | 'manual'
}

export class DreamExecutor {
  constructor(private readonly deps: DreamExecutorDeps) {}

  async executeWithAgent(
    agent: ICipherAgent,
    options: DreamExecuteOptions,
  ): Promise<string> {
    const {priorMtime, projectRoot, trigger} = options
    const contextTreeDir = join(projectRoot, BRV_DIR, CONTEXT_TREE_DIR)

    // Timeout budget
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DREAM_TIMEOUT_MS)

    const logId = await this.deps.dreamLogStore.getNextId()
    const startedAt = Date.now()
    const zeroes: DreamLogSummary = {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0}

    // Save initial processing entry
    const processingEntry: DreamLogEntry = {
      id: logId,
      operations: [],
      startedAt,
      status: 'processing',
      summary: zeroes,
      trigger,
    }
    await this.deps.dreamLogStore.save(processingEntry)

    let succeeded = false

    try {
      // Step 1: Capture pre-state
      const snapshotService = new FileContextTreeSnapshotService({baseDirectory: projectRoot})
      let preState: Map<string, FileState> | undefined
      try {
        preState = await snapshotService.getCurrentState(projectRoot)
      } catch {
        // Fail-open: if snapshot fails, skip propagation
      }

      // Step 2: Load dream state
      const dreamState = await this.deps.dreamStateService.read()

      // Step 3: Find changed files since last dream
      const changedFiles = await this.findChangedFilesSinceLastDream(dreamState.lastDreamAt, contextTreeDir)
      // Step 4: Run operations (consolidate now, synthesize + prune in ENG-2061/2062)
      const consolidateResults = await consolidate([...changedFiles], {
        agent,
        contextTreeDir,
        searchService: this.deps.searchService,
        taskId: options.taskId,
      })
      const allOperations: DreamOperation[] = [...consolidateResults]

      // Step 5: Post-dream propagation (fail-open)
      if (preState) {
        try {
          const postState = await snapshotService.getCurrentState(projectRoot)
          const changedPaths = diffStates(preState, postState)
          if (changedPaths.length > 0) {
            const summaryService = new FileContextTreeSummaryService()
            await summaryService.propagateStaleness(changedPaths, agent, projectRoot)
            const manifestService = new FileContextTreeManifestService({baseDirectory: projectRoot})
            await manifestService.buildManifest(projectRoot)
          }
        } catch {
          // Fail-open: propagation errors never block dream
        }
      }

      // Step 6: Write dream log
      const summary = this.computeSummary(allOperations)
      const completedEntry: DreamLogEntry = {
        completedAt: Date.now(),
        id: logId,
        operations: allOperations,
        startedAt,
        status: 'completed',
        summary,
        trigger,
      }
      await this.deps.dreamLogStore.save(completedEntry)

      // Step 7: Update dream state
      await this.deps.dreamStateService.write({
        ...dreamState,
        curationsSinceDream: 0,
        lastDreamAt: new Date().toISOString(),
        lastDreamLogId: logId,
        totalDreams: dreamState.totalDreams + 1,
      })

      succeeded = true
      return logId
    } catch (error) {
      // Save error/partial log entry (best-effort)
      if (controller.signal.aborted) {
        const partialEntry: DreamLogEntry = {
          abortReason: 'Budget exceeded (5 min)',
          completedAt: Date.now(),
          id: logId,
          operations: [],
          startedAt,
          status: 'partial',
          summary: zeroes,
          trigger,
        }
        await this.deps.dreamLogStore.save(partialEntry).catch(() => {})
      } else {
        const errorEntry: DreamLogEntry = {
          completedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          id: logId,
          operations: [],
          startedAt,
          status: 'error',
          summary: zeroes,
          trigger,
        }
        await this.deps.dreamLogStore.save(errorEntry).catch(() => {})
      }

      throw error
    } finally {
      clearTimeout(timeout)
      // Step 8: Lock management — release on success, rollback on error
      // eslint-disable-next-line unicorn/prefer-ternary
      if (succeeded) {
        await this.deps.dreamLockService.release().catch(() => {})
      } else {
        await this.deps.dreamLockService.rollback(priorMtime).catch(() => {})
      }
    }
  }

  /** Errors are tracked at the log level (status='error'), not per-operation — always 0 here. */
  private computeSummary(operations: DreamOperation[]): DreamLogSummary {
    const summary: DreamLogSummary = {consolidated: 0, errors: 0, flaggedForReview: 0, pruned: 0, synthesized: 0}
    for (const op of operations) {
      if (op.type === 'CONSOLIDATE') summary.consolidated++
      if (op.type === 'SYNTHESIZE') summary.synthesized++
      if (op.type === 'PRUNE') summary.pruned++
      if (op.needsReview) summary.flaggedForReview++
    }

    return summary
  }

  private async findChangedFilesSinceLastDream(
    lastDreamAt: null | string,
    contextTreeDir: string,
  ): Promise<Set<string>> {
    // First dream (lastDreamAt=null): scan ALL curate logs — every curation happened "since never"
    const afterTimestamp = lastDreamAt ? new Date(lastDreamAt).getTime() : 0

    const recentLogs = await this.deps.curateLogStore.list({
      after: afterTimestamp,
      status: ['completed'],
    })

    const changedFiles = new Set<string>()
    for (const log of recentLogs) {
      for (const op of log.operations ?? []) {
        // op.filePath is absolute; convert to relative for context tree operations
        if (op.filePath) {
          const relative = toContextTreeRelative(op.filePath, contextTreeDir)
          if (relative) changedFiles.add(relative)
        }

        if (op.additionalFilePaths) {
          for (const p of op.additionalFilePaths) {
            const relative = toContextTreeRelative(p, contextTreeDir)
            if (relative) changedFiles.add(relative)
          }
        }
      }
    }

    // Filter to files that still exist (concurrent with Promise.all to avoid no-await-in-loop)
    const checks = [...changedFiles].map(async (file) => {
      try {
        await access(join(contextTreeDir, file))
        return file
      } catch {
        return null
      }
    })
    const results = await Promise.all(checks)
    return new Set(results.filter((f): f is string => f !== null))
  }
}

/** Convert an absolute file path to a context-tree-relative path, or undefined if not inside the tree. */
function toContextTreeRelative(absolutePath: string, contextTreeDir: string): string | undefined {
  // Normalize separators for cross-platform (Windows uses backslash)
  const normalized = absolutePath.replaceAll('\\', '/')
  const normalizedDir = contextTreeDir.replaceAll('\\', '/')

  if (normalized.startsWith(normalizedDir + '/')) {
    return normalized.slice(normalizedDir.length + 1)
  }

  // Already relative? Validate it doesn't traverse outside the context tree
  if (!isAbsolute(normalized)) {
    const resolved = join(contextTreeDir, normalized)
    if (resolved.startsWith(contextTreeDir + sep) || resolved.startsWith(contextTreeDir + '/')) {
      return normalized
    }

    return undefined // Path traversal attempt (e.g., ../../secret.md)
  }

  return undefined
}
