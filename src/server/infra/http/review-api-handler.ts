import express, {type RequestHandler, type Router} from 'express'
import {unlink as fsUnlink, writeFile as fsWriteFile, mkdir, readFile} from 'node:fs/promises'
import {dirname, join, relative} from 'node:path'

import type {CurateLogEntry, CurateLogOperation} from '../../core/domain/entities/curate-log-entry.js'
import type {ICurateLogStore} from '../../core/interfaces/storage/i-curate-log-store.js'
import type {IReviewBackupStore} from '../../core/interfaces/storage/i-review-backup-store.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
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
  operations: {
    confidence?: string
    impact?: string
    logId: string
    operationIndex: number
    reason?: string
    type: string
  }[]
  path: string
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
 * Scans curate log entries for operations with reviewStatus === 'pending'
 * and groups them by file path (relative to context tree).
 */
function collectPendingFiles(entries: CurateLogEntry[], contextTreeDir: string): PendingFileInfo[] {
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
        reason: op.reason,
        type: op.type,
      })
    }
  }

  return [...pendingByFile.entries()]
    .map(([path, operations]) => ({operations, path}))
    .sort((a, b) => a.path.localeCompare(b.path))
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
      const files = collectPendingFiles(entries, contextTreeDir)

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

          // Restore additional files (MERGE source, folder DELETE contents)
          await Promise.all(
            allAdditionalPaths.map(async (absPath) => {
              const relPath = relative(contextTreeDir, absPath)
              const content = await backupStore.read(relPath)
              if (content !== null) {
                await ctFs.writeFile(absPath, content)
              }

              await backupStore.delete(relPath)
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

      const results = await Promise.all(
        updates.map(({logId, operationIndex}) => store.updateOperationReviewStatus(logId, operationIndex, decision)),
      )
      const updatedCount = results.filter(Boolean).length

      res.json({reverted, success: true, updatedCount})
    } catch (error: unknown) {
      res.status(500).json({error: error instanceof Error ? error.message : 'Internal error'})
    }
  }) as RequestHandler)

  return router
}
