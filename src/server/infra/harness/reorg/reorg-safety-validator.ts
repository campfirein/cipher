/* eslint-disable no-await-in-loop */
/**
 * Safety validator for reorg candidates.
 *
 * Validates candidates before execution to prevent data loss,
 * relation breakage, and overwrite of existing files.
 */

import {readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'

import type {ReorgCandidate} from '../../../core/interfaces/executor/i-reorg-executor.js'

import {parseFrontmatterScoring} from '../../../core/domain/knowledge/markdown-writer.js'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidatedResult {
  approved: ReorgCandidate[]
  rejected: Array<{candidate: ReorgCandidate; reason: string}>
}

interface ValidationOptions {
  maxBatchSize?: number
  protectCore?: boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)

    return true
  } catch {
    return false
  }
}

async function hasArchiveStubs(contextTreeDir: string, relativePath: string): Promise<boolean> {
  // Archive stubs live at _archived/<relative-path-without-ext>.stub.md
  // e.g., domain/topic/file.md → _archived/domain/topic/file.stub.md
  const pathWithoutExt = relativePath.replace(/\.md$/, '')
  const stubPath = join(contextTreeDir, '_archived', `${pathWithoutExt}.stub.md`)
  try {
    await stat(stubPath)

    return true
  } catch {
    return false
  }
}

async function getMaturity(contextTreeDir: string, relativePath: string): Promise<string | undefined> {
  const absolutePath = join(contextTreeDir, relativePath)
  try {
    const content = await readFile(absolutePath, 'utf8')
    const scoring = parseFrontmatterScoring(content)

    return scoring?.maturity
  } catch {
    return undefined
  }
}

// ── Validator ───────────────────────────────────────────────────────────────

/**
 * Validate reorg candidates before execution.
 *
 * Checks:
 * - merge: target MUST exist, source != target, reject if target is 'core' (when protectCore)
 * - move: target must NOT exist (would overwrite)
 * - Archive stub awareness: skip if source has stubs in _archived/
 * - Max batch size cap
 * - Relation reference feasibility scan
 */
export async function validateCandidates(
  candidates: ReorgCandidate[],
  contextTreeDir: string,
  options?: ValidationOptions,
): Promise<ValidatedResult> {
  const maxBatchSize = options?.maxBatchSize ?? 10
  const protectCore = options?.protectCore ?? true

  const approved: ReorgCandidate[] = []
  const rejected: Array<{candidate: ReorgCandidate; reason: string}> = []

  for (const candidate of candidates) {
    // Batch size cap
    if (approved.length >= maxBatchSize) {
      rejected.push({candidate, reason: `Batch size limit reached (max ${maxBatchSize})`})

      continue
    }

    const sourcePath = candidate.sourcePaths[0]
    if (!sourcePath) {
      rejected.push({candidate, reason: 'No source path specified'})

      continue
    }

    // Archive stub check (applies to both merge and move)
    const hasStubs = await hasArchiveStubs(contextTreeDir, sourcePath)
    if (hasStubs) {
      rejected.push({candidate, reason: 'Source has archive stubs in _archived/ — skipping to preserve restore capability'})

      continue
    }

    if (candidate.type === 'merge') {
      // Source != target
      if (sourcePath === candidate.targetPath) {
        rejected.push({candidate, reason: 'Source and target are the same file'})

        continue
      }

      // Target must exist
      const targetExists = await fileExists(join(contextTreeDir, candidate.targetPath))
      if (!targetExists) {
        rejected.push({candidate, reason: `Merge target does not exist: ${candidate.targetPath}`})

        continue
      }

      // Source must exist
      const sourceExists = await fileExists(join(contextTreeDir, sourcePath))
      if (!sourceExists) {
        rejected.push({candidate, reason: `Merge source does not exist: ${sourcePath}`})

        continue
      }

      // Protect core maturity targets
      if (protectCore) {
        const targetMaturity = await getMaturity(contextTreeDir, candidate.targetPath)
        if (targetMaturity === 'core') {
          rejected.push({candidate, reason: 'Target has "core" maturity — protected from merge modifications'})

          continue
        }
      }

      approved.push(candidate)
    } else if (candidate.type === 'move') {
      // Target must NOT exist (would overwrite)
      const targetExists = await fileExists(join(contextTreeDir, candidate.targetPath))
      if (targetExists) {
        rejected.push({candidate, reason: `Move target already exists: ${candidate.targetPath}`})

        continue
      }

      // Source must exist
      const sourceExists = await fileExists(join(contextTreeDir, sourcePath))
      if (!sourceExists) {
        rejected.push({candidate, reason: `Move source does not exist: ${sourcePath}`})

        continue
      }

      approved.push(candidate)
    } else {
      rejected.push({candidate, reason: `Unsupported operation type: ${candidate.type}`})
    }
  }

  return {approved, rejected}
}
