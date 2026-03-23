/* eslint-disable no-await-in-loop */
/**
 * Safety validator for reorg candidates.
 *
 * Validates candidates before execution to prevent data loss,
 * relation breakage, and overwrite of existing files.
 */

import {glob} from 'glob'
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
  const dir = relativePath.replace(/\/[^/]+$/, '')
  const archiveDir = join(dir, '_archived')
  const stubs = await glob('*.stub.md', {cwd: join(contextTreeDir, archiveDir), nodir: true}).catch(() => [])

  return stubs.some((stub) => {
    const stubBase = stub.replace('.stub.md', '')
    const sourceBase = relativePath.split('/').at(-1)?.replace('.md', '') ?? ''

    return stubBase === sourceBase
  })
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

/**
 * Scan context tree for files that reference the given source path via @relations.
 * Returns the count of files referencing this path.
 */
async function countRelationReferences(contextTreeDir: string, sourcePath: string): Promise<number> {
  const mdFiles = await glob('**/*.md', {cwd: contextTreeDir, nodir: true})
  let count = 0

  // Normalize the source path for matching (without .md extension for flexibility)
  const sourceWithoutExt = sourcePath.replace(/\.md$/, '')

  for (const relativePath of mdFiles) {
    const absolutePath = join(contextTreeDir, relativePath)
    try {
      const content = await readFile(absolutePath, 'utf8')
      // Check both frontmatter related arrays and legacy @relation references
      if (content.includes(sourcePath) || content.includes(sourceWithoutExt)) {
        count++
      }
    } catch {
      // Skip unreadable files
    }
  }

  return count
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

      // Relation rewrite feasibility — just log the count, don't reject
      // (rewriteRelationsInTree handles this gracefully)
      await countRelationReferences(contextTreeDir, sourcePath)

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

      // Relation rewrite feasibility
      await countRelationReferences(contextTreeDir, sourcePath)

      approved.push(candidate)
    } else {
      rejected.push({candidate, reason: `Unsupported operation type: ${candidate.type}`})
    }
  }

  return {approved, rejected}
}
