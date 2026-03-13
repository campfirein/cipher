import {mkdir, unlink, writeFile} from 'node:fs/promises'
import {dirname, join, relative} from 'node:path'

import type {ICurateLogStore} from '../../../core/interfaces/storage/i-curate-log-store.js'
import type {IReviewBackupStore} from '../../../core/interfaces/storage/i-review-backup-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type ReviewDecideTaskRequest,
  type ReviewDecideTaskResponse,
  ReviewEvents,
} from '../../../../shared/transport/events/review-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

// ── Types ────────────────────────────────────────────────────────────────────

type CurateLogStoreFactory = (projectPath: string) => ICurateLogStore
type ReviewBackupStoreFactory = (projectPath: string) => IReviewBackupStore

export interface ReviewHandlerDeps {
  curateLogStoreFactory: CurateLogStoreFactory
  resolveProjectPath: ProjectPathResolver
  reviewBackupStoreFactory: ReviewBackupStoreFactory
  transport: ITransportServer
}

type PendingOp = {
  additionalFilePaths?: string[]
  logId: string
  operationIndex: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeFileWithDirs(absolutePath: string, content: string): Promise<void> {
  await mkdir(dirname(absolutePath), {recursive: true})
  await writeFile(absolutePath, content, 'utf8')
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handles review:decideTask — approves or rejects all pending review operations
 * for a given task ID in a single transport request.
 *
 * Mirrors the per-file logic in review-api-handler.ts but operates at task scope.
 */
export class ReviewHandler {
  private readonly curateLogStoreFactory: CurateLogStoreFactory
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly reviewBackupStoreFactory: ReviewBackupStoreFactory
  private readonly transport: ITransportServer

  constructor(deps: ReviewHandlerDeps) {
    this.curateLogStoreFactory = deps.curateLogStoreFactory
    this.resolveProjectPath = deps.resolveProjectPath
    this.reviewBackupStoreFactory = deps.reviewBackupStoreFactory
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<ReviewDecideTaskRequest, ReviewDecideTaskResponse>(
      ReviewEvents.DECIDE_TASK,
      (data, clientId) => this.handleDecideTask(data, clientId),
    )
  }

  private async handleDecideTask(
    {decision, taskId}: ReviewDecideTaskRequest,
    clientId: string,
  ): Promise<ReviewDecideTaskResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const contextTreeDir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)

    const store = this.curateLogStoreFactory(projectPath)
    const backupStore = this.reviewBackupStoreFactory(projectPath)
    const entries = await store.list()

    // Collect pending ops grouped by relative file path for this taskId
    const pendingByPath = new Map<string, PendingOp[]>()

    for (const entry of entries) {
      if (entry.taskId !== taskId) continue

      for (let i = 0; i < entry.operations.length; i++) {
        const op = entry.operations[i]
        if (op.reviewStatus !== 'pending' || !op.filePath) continue

        const rel = relative(contextTreeDir, op.filePath)
        if (rel.startsWith('..')) continue

        let ops = pendingByPath.get(rel)
        if (!ops) {
          ops = []
          pendingByPath.set(rel, ops)
        }

        ops.push({additionalFilePaths: op.additionalFilePaths, logId: entry.id, operationIndex: i})
      }
    }

    // Apply decision for each affected file in parallel
    const fileResults = await Promise.all(
      [...pendingByPath.entries()].map(async ([relPath, ops]) => {
        let reverted = false
        const allAdditionalPaths = [...new Set(ops.flatMap((o) => o.additionalFilePaths ?? []))]

        if (decision === 'rejected') {
          const absolutePath = join(contextTreeDir, relPath)
          const backupContent = await backupStore.read(relPath)

          // null backup = ADD operation (new file) → remove it; existing backup → restore
          await (backupContent === null
            ? unlink(absolutePath).catch(() => {})
            : writeFileWithDirs(absolutePath, backupContent))

          // Restore additional paths (MERGE source, folder DELETE contents)
          await Promise.all(
            allAdditionalPaths.map(async (absPath) => {
              const rel = relative(contextTreeDir, absPath)
              const content = await backupStore.read(rel)
              if (content !== null) await writeFileWithDirs(absPath, content)
              await backupStore.delete(rel)
            }),
          )

          reverted = true
        }

        // Clear backups for both approve and reject (current state becomes new baseline)
        await backupStore.delete(relPath)
        await Promise.all(
          allAdditionalPaths.map((absPath) => backupStore.delete(relative(contextTreeDir, absPath))),
        )

        // Update review status in the curate log
        await Promise.all(
          ops.map(({logId, operationIndex}) => store.updateOperationReviewStatus(logId, operationIndex, decision)),
        )

        return {path: relPath, reverted}
      }),
    )

    return {files: fileResults, totalCount: fileResults.length}
  }
}
