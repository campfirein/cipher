/**
 * Dream Undo — reverts the last dream's file changes using previousTexts from the dream log.
 *
 * Runs directly from CLI (no daemon/agent needed). Pure file I/O.
 * Only undoes the LAST dream — not a history stack.
 */

import {mkdir, unlink, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import type {DreamLogEntry, DreamOperation} from './dream-log-schema.js'
import type {DreamState} from './dream-state-schema.js'

export type DreamUndoDeps = {
  archiveService?: {restoreEntry(stubPath: string, directory?: string): Promise<string>}
  contextTreeDir: string
  dreamLogStore: {
    getById(id: string): Promise<DreamLogEntry | null>
    save(entry: DreamLogEntry): Promise<void>
  }
  dreamStateService: {
    read(): Promise<DreamState>
    write(state: DreamState): Promise<void>
  }
  manifestService: {buildManifest(dir?: string): Promise<unknown>}
}

export interface DreamUndoResult {
  deletedFiles: string[]
  dreamId: string
  errors: string[]
  restoredArchives: string[]
  restoredFiles: string[]
}

export async function undoLastDream(deps: DreamUndoDeps): Promise<DreamUndoResult> {
  const {contextTreeDir, dreamLogStore, dreamStateService, manifestService} = deps

  // ── Precondition checks ─────────────────────────────────────────────────
  const state = await dreamStateService.read()
  if (!state.lastDreamLogId) {
    throw new Error('No dream to undo')
  }

  const log = await dreamLogStore.getById(state.lastDreamLogId)
  if (!log) {
    throw new Error(`Dream log not found: ${state.lastDreamLogId}`)
  }

  if (log.status === 'undone') {
    throw new Error(`Dream already undone: ${state.lastDreamLogId}`)
  }

  if (log.status !== 'completed' && log.status !== 'partial') {
    throw new Error(`Cannot undo dream with status: ${log.status}`)
  }

  // ── Reverse operations ──────────────────────────────────────────────────
  const result: DreamUndoResult = {
    deletedFiles: [],
    dreamId: log.id,
    errors: [],
    restoredArchives: [],
    restoredFiles: [],
  }

  // Track pending merges to remove (for PRUNE/SUGGEST_MERGE)
  const mergesToRemove: Array<{mergeTarget: string; sourceFile: string}> = []

  const reversed = [...log.operations].reverse()
  for (const op of reversed) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await undoOperation(op, {contextTreeDir, deps, mergesToRemove, result})
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  // ── Post-undo: rebuild manifest ─────────────────────────────────────────
  try {
    await manifestService.buildManifest()
  } catch (error) {
    result.errors.push(`Manifest rebuild failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // ── Post-undo: mark log as undone ───────────────────────────────────────
  const undoneLog: DreamLogEntry = {
    completedAt: log.completedAt,
    id: log.id,
    operations: log.operations,
    startedAt: log.startedAt,
    status: 'undone',
    summary: log.summary,
    trigger: log.trigger,
    undoneAt: Date.now(),
  }
  await dreamLogStore.save(undoneLog)

  // ── Post-undo: rewind dream state ───────────────────────────────────────
  let {pendingMerges} = state
  if (mergesToRemove.length > 0) {
    pendingMerges = (pendingMerges ?? []).filter(
      (pm) => !mergesToRemove.some((rm) => rm.sourceFile === pm.sourceFile && rm.mergeTarget === pm.mergeTarget),
    )
  }

  await dreamStateService.write({
    ...state,
    lastDreamAt: null,
    pendingMerges,
    totalDreams: Math.max(0, state.totalDreams - 1),
  })

  return result
}

/** Unlink a file, ignoring ENOENT (already gone) but rethrowing other errors. */
async function unlinkSafe(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Resolve a relative path within contextTreeDir, rejecting traversal outside the tree. */
function safePath(contextTreeDir: string, relativePath: string): string {
  const full = resolve(contextTreeDir, relativePath)
  if (!full.startsWith(contextTreeDir + '/') && full !== contextTreeDir) {
    throw new Error(`Path traversal blocked: ${relativePath}`)
  }

  return full
}

// ── Per-operation undo handlers ───────────────────────────────────────────────

type UndoContext = {
  contextTreeDir: string
  deps: DreamUndoDeps
  mergesToRemove: Array<{mergeTarget: string; sourceFile: string}>
  result: DreamUndoResult
}

async function undoOperation(op: DreamOperation, ctx: UndoContext): Promise<void> {
  switch (op.type) {
    case 'CONSOLIDATE': {
      await undoConsolidate(op, ctx.contextTreeDir, ctx.result)
      break
    }

    case 'PRUNE': {
      await undoPrune(op, ctx)
      break
    }

    case 'SYNTHESIZE': {
      await undoSynthesize(op, ctx.contextTreeDir, ctx.result)
      break
    }
  }
}

async function undoConsolidate(
  op: Extract<DreamOperation, {type: 'CONSOLIDATE'}>,
  contextTreeDir: string,
  result: DreamUndoResult,
): Promise<void> {
  switch (op.action) {
    case 'CROSS_REFERENCE': {
      // Non-destructive — skip
      break
    }

    case 'MERGE': {
      if (!op.previousTexts || Object.keys(op.previousTexts).length === 0) {
        throw new Error(`Cannot undo MERGE: missing previousTexts for ${op.outputFile ?? op.inputFiles[0]}`)
      }

      // Restore all source files from previousTexts
      for (const [filePath, content] of Object.entries(op.previousTexts)) {
        const fullPath = safePath(contextTreeDir, filePath)
        // eslint-disable-next-line no-await-in-loop
        await mkdir(dirname(fullPath), {recursive: true})
        // eslint-disable-next-line no-await-in-loop
        await writeFile(fullPath, content, 'utf8')
        result.restoredFiles.push(filePath)
      }

      // Delete merged output if it wasn't an original source
      if (op.outputFile && !op.previousTexts[op.outputFile]) {
        await unlinkSafe(safePath(contextTreeDir, op.outputFile))
        result.deletedFiles.push(op.outputFile)
      }

      break
    }

    case 'TEMPORAL_UPDATE': {
      if (!op.previousTexts || Object.keys(op.previousTexts).length === 0) {
        throw new Error(`Cannot undo TEMPORAL_UPDATE: missing previousTexts for ${op.inputFiles[0]}`)
      }

      for (const [filePath, content] of Object.entries(op.previousTexts)) {
        const fullPath = safePath(contextTreeDir, filePath)
        // eslint-disable-next-line no-await-in-loop
        await mkdir(dirname(fullPath), {recursive: true})
        // eslint-disable-next-line no-await-in-loop
        await writeFile(fullPath, content, 'utf8')
        result.restoredFiles.push(filePath)
      }

      break
    }
  }
}

async function undoSynthesize(
  op: Extract<DreamOperation, {type: 'SYNTHESIZE'}>,
  contextTreeDir: string,
  result: DreamUndoResult,
): Promise<void> {
  // UPDATE modified a pre-existing file — can't undo without previousTexts (not captured by SYNTHESIZE)
  if (op.action === 'UPDATE') {
    throw new Error(`Cannot undo SYNTHESIZE/UPDATE: previousTexts not captured for ${op.outputFile}`)
  }

  // CREATE — delete the synthesized file
  await unlinkSafe(safePath(contextTreeDir, op.outputFile))
  result.deletedFiles.push(op.outputFile)
}

async function undoPrune(
  op: Extract<DreamOperation, {type: 'PRUNE'}>,
  ctx: UndoContext,
): Promise<void> {
  switch (op.action) {
    case 'ARCHIVE': {
      if (!ctx.deps.archiveService) {
        throw new Error(`Cannot undo PRUNE/ARCHIVE: no archive service available for ${op.file}`)
      }

      const restored = await ctx.deps.archiveService.restoreEntry(op.file, ctx.contextTreeDir)
      ctx.result.restoredArchives.push(restored)
      break
    }

    case 'KEEP': {
      // No-op — nothing was changed
      break
    }

    case 'SUGGEST_MERGE': {
      if (op.mergeTarget) {
        ctx.mergesToRemove.push({mergeTarget: op.mergeTarget, sourceFile: op.file})
      }

      break
    }
  }
}
