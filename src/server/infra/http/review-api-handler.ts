import express, {type RequestHandler, type Router} from 'express'
import {unlink as fsUnlink, writeFile as fsWriteFile, mkdir, readFile} from 'node:fs/promises'
import {dirname, isAbsolute, join, relative} from 'node:path'

import type {CurateLogEntry, CurateLogOperation} from '../../core/domain/entities/curate-log-entry.js'
import type {ICurateLogStore} from '../../core/interfaces/storage/i-curate-log-store.js'
import type {IReviewBackupStore} from '../../core/interfaces/storage/i-review-backup-store.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {MarkdownWriter} from '../../core/domain/knowledge/markdown-writer.js'
import {getReviewPageHtml} from './review-ui.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewApiOptions {
  /** File operations for the context tree. Defaults to real fs operations. Injectable for testing. */
  contextTreeFs?: {
    deleteFile: (absolutePath: string) => Promise<void>
    writeFile: (absolutePath: string, content: string) => Promise<void>
  }
  curateLogStoreFactory: (projectPath: string) => ICurateLogStore
  reviewBackupStoreFactory: (projectPath: string) => IReviewBackupStore
}

type PendingFileInfo = {
  currentSummary?: string
  operations: {
    confidence?: string
    impact?: string
    logId: string
    operationIndex: number
    previousSummary?: string
    reason?: string
    summary?: string
    type: string
  }[]
  path: string
  previousSummary?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function decodeProjectPath(encoded: string): null | string {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function getContextTreeDir(projectPath: string): string {
  return join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)
}

/**
 * Returns true if filePath escapes outside the given root directory.
 * Guards against path traversal (e.g. ../../etc/passwd).
 */
function isTraversal(rootDir: string, filePath: string): boolean {
  const resolved = relative(rootDir, join(rootDir, filePath))
  return resolved.startsWith('..') || isAbsolute(resolved)
}

/**
 * Extract summary from markdown file content's frontmatter.
 */
function extractSummaryFromContent(content: string): string | undefined {
  try {
    return MarkdownWriter.parseContent(content).summary
  } catch {
    return undefined
  }
}

/**
 * Scans curate log entries for operations with reviewStatus === 'pending'
 * and groups them by file path (relative to context tree).
 *
 * Reads live summaries from the actual files (current + backup) so that
 * reviews always reflect the latest state, even after subsequent curations.
 */
async function collectPendingFiles(
  entries: CurateLogEntry[],
  contextTreeDir: string,
  backupStore: IReviewBackupStore,
): Promise<PendingFileInfo[]> {
  const pendingByFile = new Map<string, PendingFileInfo['operations']>()

  for (const entry of entries) {
    for (let i = 0; i < entry.operations.length; i++) {
      const op = entry.operations[i]
      if (op.reviewStatus !== 'pending') continue
      if (!op.filePath) continue

      const relativePath = relative(contextTreeDir, op.filePath)
      // Skip paths that resolve outside the context tree (e.g., absolute paths from different projects)
      if (relativePath.startsWith('..')) continue

      let ops = pendingByFile.get(relativePath)
      if (!ops) {
        ops = []
        pendingByFile.set(relativePath, ops)
      }

      ops.push({
        confidence: op.confidence,
        impact: op.impact,
        logId: entry.id,
        operationIndex: i,
        previousSummary: op.previousSummary,
        reason: op.reason,
        summary: op.summary,
        type: op.type,
      })
    }
  }

  // Read live summaries from actual files (current + backup) in parallel
  const sortedEntries = [...pendingByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const results = await Promise.all(
    sortedEntries.map(async ([path, operations]): Promise<PendingFileInfo> => {
      let currentSummary: string | undefined
      let previousSummary: string | undefined

      try {
        const currentContent = await readFile(join(contextTreeDir, path), 'utf8')
        currentSummary = extractSummaryFromContent(currentContent)
      } catch {
        // File may have been deleted (DELETE operation) — that's expected
      }

      try {
        const backupContent = await backupStore.read(path)
        if (backupContent !== null) {
          previousSummary = extractSummaryFromContent(backupContent)
        }
      } catch {
        // No backup — file was newly added
      }

      // Fall back to curate log values if live reads yielded nothing
      if (!currentSummary && !previousSummary) {
        const lastOp = operations.at(-1)!
        currentSummary = lastOp.summary
        previousSummary = lastOp.previousSummary
      }

      return {currentSummary, operations, path, previousSummary}
    }),
  )

  return results
}

type PendingUpdate = {
  additionalFilePaths?: string[]
  logId: string
  operationIndex: number
  type: CurateLogOperation['type']
}

/**
 * Finds all pending operations that match a given relative file path and
 * returns update tasks (logId + operationIndex + type).
 */
function findPendingUpdates(
  entries: CurateLogEntry[],
  contextTreeDir: string,
  targetPath: string,
): PendingUpdate[] {
  const updates: PendingUpdate[] = []

  for (const entry of entries) {
    for (let i = 0; i < entry.operations.length; i++) {
      const op: CurateLogOperation = entry.operations[i]
      if (op.reviewStatus !== 'pending') continue
      if (!op.filePath) continue

      const relativePath = relative(contextTreeDir, op.filePath)
      if (relativePath === targetPath) {
        updates.push({additionalFilePaths: op.additionalFilePaths, logId: entry.id, operationIndex: i, type: op.type})
      }
    }
  }

  return updates
}

// ── Router factory ───────────────────────────────────────────────────────────

export function createReviewApiRouter(options: ReviewApiOptions): Router {
  // eslint-disable-next-line new-cap
  const router = express.Router()

  const ctFs = options.contextTreeFs ?? {
    async deleteFile(absolutePath: string) {
      await fsUnlink(absolutePath)
    },
    async writeFile(absolutePath: string, content: string) {
      await mkdir(dirname(absolutePath), {recursive: true})
      await fsWriteFile(absolutePath, content, 'utf8')
    },
  }

  // Parse JSON request bodies
  router.use(express.json() as RequestHandler)

  // GET /review — serve the review UI HTML page
  router.get('/review', (_req, res) => {
    res.type('html').send(getReviewPageHtml())
  })

  // GET /api/review/pending?project=<base64url>
  // Returns list of files with pending review operations
  router.get('/api/review/pending', (async (req, res) => {
    const projectEncoded = req.query.project
    if (typeof projectEncoded !== 'string' || !projectEncoded) {
      res.status(400).json({error: 'Missing project parameter'})
      return
    }

    const projectPath = decodeProjectPath(projectEncoded)
    if (!projectPath) {
      res.status(400).json({error: 'Invalid project parameter'})
      return
    }

    try {
      const store = options.curateLogStoreFactory(projectPath)
      const entries = await store.list()
      const contextTreeDir = getContextTreeDir(projectPath)
      const backupStore = options.reviewBackupStoreFactory(projectPath)
      const files = await collectPendingFiles(entries, contextTreeDir, backupStore)

      res.json({files, projectPath})
    } catch (error: unknown) {
      res.status(500).json({error: error instanceof Error ? error.message : 'Internal error'})
    }
  }) as RequestHandler)

  // GET /api/review/diff?project=<base64url>&path=<relative_path>
  // Returns old (backup) and new (current) content for diff rendering
  router.get('/api/review/diff', (async (req, res) => {
    const projectEncoded = req.query.project
    const filePath = req.query.path

    if (typeof projectEncoded !== 'string' || typeof filePath !== 'string' || !projectEncoded || !filePath) {
      res.status(400).json({error: 'Missing project or path parameter'})
      return
    }

    const projectPath = decodeProjectPath(projectEncoded)
    if (!projectPath) {
      res.status(400).json({error: 'Invalid project parameter'})
      return
    }

    try {
      const contextTreeDir = getContextTreeDir(projectPath)

      if (isTraversal(contextTreeDir, filePath)) {
        res.status(400).json({error: 'Invalid file path'})
        return
      }

      const backupStore = options.reviewBackupStoreFactory(projectPath)

      // Read backup (pre-curate) content
      const oldContent = (await backupStore.read(filePath)) ?? ''

      // Read current (post-curate) content
      let newContent = ''
      try {
        newContent = await readFile(join(contextTreeDir, filePath), 'utf8')
      } catch {
        // File may have been deleted — that's a valid diff (content → empty)
      }

      res.json({newContent, oldContent, path: filePath})
    } catch (error: unknown) {
      res.status(500).json({error: error instanceof Error ? error.message : 'Internal error'})
    }
  }) as RequestHandler)

  // POST /api/review/decide
  // Body: { project: string (base64url), path: string, decision: 'approved' | 'rejected' }
  // Updates reviewStatus for all pending operations on the given file
  router.post('/api/review/decide', (async (req, res) => {
    const {decision, path: filePath, project: projectEncoded} = req.body as {
      decision?: string
      path?: string
      project?: string
    }

    if (!projectEncoded || !filePath || !decision) {
      res.status(400).json({error: 'Missing required fields: project, path, decision'})
      return
    }

    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({error: 'Invalid decision — must be "approved" or "rejected"'})
      return
    }

    const projectPath = decodeProjectPath(projectEncoded)
    if (!projectPath) {
      res.status(400).json({error: 'Invalid project parameter'})
      return
    }

    try {
      const store = options.curateLogStoreFactory(projectPath)
      const contextTreeDir = getContextTreeDir(projectPath)

      if (isTraversal(contextTreeDir, filePath)) {
        res.status(400).json({error: 'Invalid file path'})
        return
      }

      const entries = await store.list()

      const updates = findPendingUpdates(entries, contextTreeDir, filePath)

      let reverted = false

      if (updates.length > 0) {
        const backupStore = options.reviewBackupStoreFactory(projectPath)

        const allAdditionalPaths = [
          ...new Set(updates.flatMap((u) => u.additionalFilePaths ?? [])),
        ]

        if (decision === 'rejected') {
          // Revert the primary file
          const absolutePath = join(contextTreeDir, filePath)
          const backupContent = await backupStore.read(filePath)

          // null means ADD (new file) → remove it; backup exists → restore pre-curate content
          await (backupContent === null
            ? ctFs.deleteFile(absolutePath).catch(() => {})
            : ctFs.writeFile(absolutePath, backupContent))

          // Restore additional files (MERGE source, folder DELETE contents).
          // Best-effort: partial failures must not block the log update below.
          await Promise.allSettled(
            allAdditionalPaths.map(async (absPath) => {
              const relPath = relative(contextTreeDir, absPath)
              const content = await backupStore.read(relPath)
              if (content !== null) {
                await ctFs.writeFile(absPath, content)
              }
            }),
          )

          reverted = true
        }

        // On both approve and reject: clear the backup so future modifications
        // use the current state as the new baseline
        await backupStore.delete(filePath)
        await Promise.all(
          allAdditionalPaths.map((absPath) => backupStore.delete(relative(contextTreeDir, absPath))),
        )
      }

      // Batch-update grouped by logId (one read+write per entry file)
      const byLogId = new Map<string, Array<{operationIndex: number; reviewStatus: 'approved' | 'rejected'}>>()
      for (const {logId, operationIndex} of updates) {
        let batch = byLogId.get(logId)
        if (!batch) {
          batch = []
          byLogId.set(logId, batch)
        }

        batch.push({operationIndex, reviewStatus: decision})
      }

      const logIdBatches = [...byLogId.entries()]
      const results = await Promise.all(
        logIdBatches.map(([logId, batch]) => store.batchUpdateOperationReviewStatus(logId, batch)),
      )
      // Assumes all indices in each batch are valid — guaranteed by findPendingUpdates which only produces indices from actual entries.
      const updatedCount = logIdBatches.reduce((sum, [, batch], i) => sum + (results[i] ? batch.length : 0), 0)

      res.json({reverted, success: true, updatedCount})
    } catch (error: unknown) {
      res.status(500).json({error: error instanceof Error ? error.message : 'Internal error'})
    }
  }) as RequestHandler)

  return router
}
