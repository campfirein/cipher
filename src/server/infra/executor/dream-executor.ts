/**
 * DreamExecutor - Orchestrates background memory consolidation ("dreaming").
 *
 * 8-step flow:
 * 1. Capture pre-state snapshot
 * 2. Load dream state
 * 3. Find changed files since last dream (via curate log scanning)
 * 4. Run operations (consolidate, synthesize, prune)
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
import type {IRuntimeSignalStore} from '../../core/interfaces/storage/i-runtime-signal-store.js'
import type {DreamLogEntry, DreamLogSummary, DreamOperation} from '../dream/dream-log-schema.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {FileContextTreeManifestService} from '../context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../context-tree/file-context-tree-summary-service.js'
import {diffStates} from '../context-tree/snapshot-diff.js'
import {consolidate, type ConsolidateDeps} from '../dream/operations/consolidate.js'
import {prune} from '../dream/operations/prune.js'
import {synthesize} from '../dream/operations/synthesize.js'

const DREAM_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export type DreamExecutorDeps = {
  archiveService: {
    archiveEntry(relativePath: string, agent: ICipherAgent, directory?: string): Promise<{fullPath: string; originalPath: string; stubPath: string}>
    findArchiveCandidates(directory?: string): Promise<string[]>
  }
  curateLogStore: {
    getNextId(): Promise<string>
    list(filters?: {after?: number; before?: number; limit?: number; status?: CurateLogStatus[]}): Promise<CurateLogEntry[]>
    save(entry: CurateLogEntry): Promise<void>
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
    update(updater: (state: import('../dream/dream-state-schema.js').DreamState) => import('../dream/dream-state-schema.js').DreamState): Promise<import('../dream/dream-state-schema.js').DreamState>
    write(state: import('../dream/dream-state-schema.js').DreamState): Promise<void>
  }
  reviewBackupStore?: {
    save(relativePath: string, content: string): Promise<void>
  }
  /**
   * Optional. Passed through to consolidate's CROSS_REFERENCE review gate
   * (reads `maturity` via `get`) and to prune's candidacy scan (reads
   * `importance`/`maturity` via `list`). The full `IRuntimeSignalStore` is
   * accepted so both code paths can consume what they need.
   */
  runtimeSignalStore?: IRuntimeSignalStore
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
  ): Promise<{logId: string; result: string}> {
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
      taskId: options.taskId,
      trigger,
    }
    await this.deps.dreamLogStore.save(processingEntry)

    // Hoisted so the catch block can surface any work that completed before a
    // timeout or error — keeps the dream log audit trail and `brv dream --undo`
    // history accurate for partial runs.
    const allOperations: DreamOperation[] = []
    let succeeded = false
    // Tracks whether the success-path createReviewEntries already ran. The
    // catch path also calls createReviewEntries for partial runs; without this
    // flag, a failure that occurs after step 6b succeeds (e.g. step 7
    // dreamStateService.update throws) would re-write the same review entries.
    let reviewEntriesWritten = false

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

      // Step 4: Run operations, pushing results incrementally so partial work
      // is preserved if a later step throws or the budget aborts.
      await this.runOperations({
        agent,
        changedFiles,
        contextTreeDir,
        logId,
        out: allOperations,
        projectRoot,
        signal: controller.signal,
        taskId: options.taskId,
      })

      // Step 5: Post-dream propagation (fail-open)
      if (preState) {
        try {
          const postState = await snapshotService.getCurrentState(projectRoot)
          const changedPaths = diffStates(preState, postState)
          if (changedPaths.length > 0) {
            const summaryService = new FileContextTreeSummaryService()
            await summaryService.propagateStaleness(changedPaths, agent, projectRoot, options.taskId)
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
        taskId: options.taskId,
        trigger,
      }
      await this.deps.dreamLogStore.save(completedEntry)

      // Step 6b: Create curate log entries for needsReview operations (dual-write for review system).
      // Runs after the completed dream log is durably written so review tasks never outlive their dream log.
      await this.createReviewEntries(allOperations, contextTreeDir, options.taskId)
      reviewEntriesWritten = true

      // Step 7: Update dream state — atomic RMW under the per-file mutex so a
      // concurrent curate's incrementCurationCount can't be overwritten by the
      // reset, and so pendingMerges written by prune are preserved by the spread.
      await this.deps.dreamStateService.update((state) => ({
        ...state,
        curationsSinceDream: 0,
        lastDreamAt: new Date().toISOString(),
        lastDreamLogId: logId,
        totalDreams: state.totalDreams + 1,
      }))

      succeeded = true
      return {logId, result: this.formatResult(logId, summary)}
    } catch (error) {
      // Save error/partial log entry (best-effort). Use allOperations so any work
      // that completed before the failure is captured — keeps the audit trail and
      // undo history accurate even for partial runs.
      const summary = this.computeSummary(allOperations)
      if (controller.signal.aborted) {
        const partialEntry: DreamLogEntry = {
          abortReason: 'Budget exceeded (5 min)',
          completedAt: Date.now(),
          id: logId,
          operations: allOperations,
          startedAt,
          status: 'partial',
          summary,
          taskId: options.taskId,
          trigger,
        }
        await this.deps.dreamLogStore.save(partialEntry).catch(() => {})
      } else {
        const errorEntry: DreamLogEntry = {
          completedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          id: logId,
          operations: allOperations,
          startedAt,
          status: 'error',
          summary,
          taskId: options.taskId,
          trigger,
        }
        await this.deps.dreamLogStore.save(errorEntry).catch(() => {})
      }

      // Surface review-flagged ops that did complete into `brv review pending` even
      // when the dream failed overall. Skipped when no work accumulated so the
      // "no dream log, no review entries" invariant holds for errors that fire
      // before any operation ran. Also skipped when the success-path call
      // already wrote the entries (i.e. step 7 threw after step 6b succeeded)
      // to prevent duplicate review items.
      if (allOperations.length > 0 && !reviewEntriesWritten) {
        await this.createReviewEntries(allOperations, contextTreeDir, options.taskId)
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

  /**
   * Runs the three dream operations sequentially, pushing results into `out` after
   * each step. Extracted so the executor can preserve partial work when a later step
   * throws — and so tests can inject controlled ops without a full LLM round-trip.
   */
  protected async runOperations(args: {
    agent: ICipherAgent
    changedFiles: Set<string>
    contextTreeDir: string
    logId: string
    out: DreamOperation[]
    projectRoot: string
    signal: AbortSignal
    taskId: string
  }): Promise<void> {
    const {agent, changedFiles, contextTreeDir, logId, out, projectRoot, signal, taskId} = args

    out.push(
      ...(await consolidate([...changedFiles], {
        agent,
        contextTreeDir,
        dreamStateService: this.deps.dreamStateService,
        reviewBackupStore: this.deps.reviewBackupStore,
        runtimeSignalStore: this.deps.runtimeSignalStore,
        searchService: this.deps.searchService,
        signal,
        taskId,
      })),
    )

    if (changedFiles.size > 0) {
      out.push(
        ...(await synthesize({
          agent,
          contextTreeDir,
          runtimeSignalStore: this.deps.runtimeSignalStore,
          searchService: this.deps.searchService,
          signal,
          taskId,
        })),
      )
    }

    out.push(
      ...(await prune({
        agent,
        archiveService: this.deps.archiveService,
        contextTreeDir,
        dreamLogId: logId,
        dreamStateService: this.deps.dreamStateService,
        projectRoot,
        reviewBackupStore: this.deps.reviewBackupStore,
        runtimeSignalStore: this.deps.runtimeSignalStore,
        signal,
        taskId,
      })),
    )
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

  /**
   * Dual-write: create curate log entries for dream operations that need human review.
   * This surfaces them in `brv review pending` without modifying the review system.
   */
  private async createReviewEntries(
    operations: DreamOperation[],
    contextTreeDir: string,
    taskId: string,
  ): Promise<void> {
    const reviewOps = operations.filter((op) => op.needsReview)
    if (reviewOps.length === 0) return

    const curateOps: CurateLogEntry['operations'] = reviewOps.map((op) =>
      mapDreamOpToCurateOp(op, contextTreeDir),
    )

    try {
      const logId = await this.deps.curateLogStore.getNextId()
      const entry: CurateLogEntry = {
        completedAt: Date.now(),
        id: logId,
        input: {context: 'dream'},
        operations: curateOps,
        startedAt: Date.now(),
        status: 'completed',
        summary: {
          added: curateOps.filter((op) => op.type === 'ADD').length,
          deleted: curateOps.filter((op) => op.type === 'DELETE').length,
          failed: 0,
          merged: curateOps.filter((op) => op.type === 'MERGE').length,
          updated: curateOps.filter((op) => op.type === 'UPDATE' || op.type === 'UPSERT').length,
        },
        taskId,
      }
      await this.deps.curateLogStore.save(entry)
    } catch {
      // Fail-open: review entry creation must not block dream
    }
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
      if (log.input.context === 'dream') continue

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

  private formatResult(logId: string, summary: DreamLogSummary): string {
    const parts = [`Dream completed (${logId})`]
    const counts = [
      summary.consolidated > 0 ? `${summary.consolidated} consolidated` : '',
      summary.synthesized > 0 ? `${summary.synthesized} synthesized` : '',
      summary.pruned > 0 ? `${summary.pruned} pruned` : '',
    ].filter(Boolean)
    if (counts.length > 0) {
      parts.push(counts.join(' | '))
    } else if (summary.errors === 0 && summary.flaggedForReview === 0) {
      parts.push('No changes needed — context tree is up to date')
    }

    if (summary.errors > 0) {
      parts.push(`${summary.errors} operations failed`)
    }

    if (summary.flaggedForReview > 0) {
      parts.push(`${summary.flaggedForReview} operations flagged for review`)
    }

    return parts.join('\n')
  }
}

/** Map a dream operation to a curate log operation for the review system. */
function mapDreamOpToCurateOp(
  op: DreamOperation,
  contextTreeDir: string,
): CurateLogEntry['operations'][number] {
  if (op.type === 'PRUNE' && op.action === 'ARCHIVE') {
    return {
      filePath: join(contextTreeDir, op.file),
      needsReview: true,
      path: op.file,
      reason: `[dream/prune] ${op.reason}`,
      reviewStatus: 'pending',
      status: 'success',
      type: 'DELETE',
    }
  }

  if (op.type === 'CONSOLIDATE' && op.action === 'MERGE') {
    return {
      additionalFilePaths: op.inputFiles.filter((f) => f !== op.outputFile).map((f) => join(contextTreeDir, f)),
      filePath: op.outputFile ? join(contextTreeDir, op.outputFile) : undefined,
      needsReview: true,
      path: op.outputFile ?? op.inputFiles[0],
      reason: `[dream/consolidate] ${op.reason}`,
      reviewStatus: 'pending',
      status: 'success',
      type: 'MERGE',
    }
  }

  if (op.type === 'CONSOLIDATE' && op.action === 'TEMPORAL_UPDATE') {
    const targetFile = op.inputFiles[0]
    return {
      filePath: join(contextTreeDir, targetFile),
      needsReview: true,
      path: targetFile,
      reason: `[dream/consolidate] ${op.reason}`,
      reviewStatus: 'pending',
      status: 'success',
      type: 'UPDATE',
    }
  }

  if (op.type === 'CONSOLIDATE' && op.action === 'CROSS_REFERENCE') {
    const [targetFile, ...relatedFiles] = op.inputFiles
    return {
      additionalFilePaths: relatedFiles.map((file) => join(contextTreeDir, file)),
      filePath: join(contextTreeDir, targetFile),
      needsReview: true,
      path: targetFile,
      reason: `[dream/consolidate] ${op.reason}`,
      reviewStatus: 'pending',
      status: 'success',
      type: 'UPDATE',
    }
  }

  if (op.type === 'SYNTHESIZE' && op.action === 'CREATE') {
    return {
      filePath: join(contextTreeDir, op.outputFile),
      needsReview: true,
      path: op.outputFile,
      reason: '[dream/synthesize] Generated synthesis draft',
      reviewStatus: 'pending',
      status: 'success',
      type: 'ADD',
    }
  }

  const filePath = 'file' in op
    ? op.file
    : 'inputFiles' in op
      ? op.outputFile ?? op.inputFiles[0]
      : op.outputFile
  return {
    filePath: join(contextTreeDir, filePath),
    needsReview: true,
    path: filePath,
    reason: `[dream/${op.type.toLowerCase()}] ${'reason' in op ? op.reason : ''}`,
    reviewStatus: 'pending',
    status: 'success',
    type: 'UPDATE',
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
