/**
 * Executes validated reorg candidates on the filesystem.
 *
 * Supports merge and move operations with atomic writes,
 * relation rewriting, and empty directory cleanup.
 */

import {mkdir, readdir, readFile, rename, rm, rmdir, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {ReorgCandidate, ReorgQualityMetrics, ReorgResult} from '../../../core/interfaces/executor/i-reorg-executor.js'

import {MarkdownWriter,parseFrontmatter} from '../../../core/domain/knowledge/markdown-writer.js'
import {rewriteRelationsInTree} from '../../../core/domain/knowledge/relation-rewriter.js'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ReorgOperationExecutorDeps {
  contextTreeDir: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Remove empty parent directories up to (but not including) the context tree root.
 */
async function cleanEmptyParentDirs(filePath: string, contextTreeDir: string): Promise<void> {
  let dir = dirname(filePath)

  while (dir.length > contextTreeDir.length && dir.startsWith(contextTreeDir)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const entries = await readdir(dir)
      if (entries.length > 0) {
        break
      }

      // eslint-disable-next-line no-await-in-loop
      await rmdir(dir)
      dir = dirname(dir)
    } catch {
      break
    }
  }
}

// ── Executor ────────────────────────────────────────────────────────────────

export class ReorgOperationExecutor {
  private readonly contextTreeDir: string

  constructor(deps: ReorgOperationExecutorDeps) {
    this.contextTreeDir = deps.contextTreeDir
  }

  async execute(candidate: ReorgCandidate): Promise<ReorgResult> {
    switch (candidate.type) {
      case 'merge': {
        return this.executeMerge(candidate)
      }

      case 'move': {
        return this.executeMove(candidate)
      }

      default: {
        return {
          candidate,
          changedPaths: [],
          error: `Unsupported operation type: ${candidate.type}`,
          success: false,
        }
      }
    }
  }

  private async executeMerge(candidate: ReorgCandidate): Promise<ReorgResult> {
    const sourcePath = candidate.sourcePaths[0]
    if (!sourcePath) {
      return {
        candidate,
        changedPaths: [],
        error: 'No source path specified',
        success: false,
      }
    }

    const sourceAbsolute = join(this.contextTreeDir, sourcePath)
    const targetAbsolute = join(this.contextTreeDir, candidate.targetPath)

    try {
      // Read source and target content
      const sourceContent = await readFile(sourceAbsolute, 'utf8')
      const targetContent = await readFile(targetAbsolute, 'utf8')

      // Compute pre-merge keyword counts for quality metrics
      const sourceKeywords = parseFrontmatter(sourceContent)?.frontmatter.keywords ?? []
      const targetKeywords = parseFrontmatter(targetContent)?.frontmatter.keywords ?? []
      const preKeywordCount = sourceKeywords.length + targetKeywords.length

      // Merge contexts (deterministic via MarkdownWriter — deduplicates keywords)
      const mergedContent = MarkdownWriter.mergeContexts(sourceContent, targetContent)

      // Compute post-merge keyword count
      const mergedKeywords = parseFrontmatter(mergedContent)?.frontmatter.keywords ?? []
      const postKeywordCount = mergedKeywords.length

      // Write merged content to target atomically (write to temp, then rename)
      const tmpPath = `${targetAbsolute}.tmp`
      await writeFile(tmpPath, mergedContent, 'utf8')
      await rename(tmpPath, targetAbsolute)

      // Rewrite relations: source → target
      const pathMapping = new Map<string, string>()
      pathMapping.set(sourcePath, candidate.targetPath)
      const modifiedRelationPaths = await rewriteRelationsInTree(this.contextTreeDir, pathMapping)

      // Delete source
      await rm(sourceAbsolute, {force: true})

      // Clean empty parent directories
      await cleanEmptyParentDirs(sourceAbsolute, this.contextTreeDir)

      const changedPaths = [
        candidate.targetPath,
        sourcePath,
        ...modifiedRelationPaths,
      ]

      return {
        candidate,
        changedPaths: [...new Set(changedPaths)],
        qualityMetrics: {postKeywordCount, preKeywordCount},
        success: true,
      }
    } catch (error) {
      return {
        candidate,
        changedPaths: [],
        error: error instanceof Error ? error.message : String(error),
        success: false,
      }
    }
  }

  private async executeMove(candidate: ReorgCandidate): Promise<ReorgResult> {
    const sourcePath = candidate.sourcePaths[0]
    if (!sourcePath) {
      return {
        candidate,
        changedPaths: [],
        error: 'No source path specified',
        success: false,
      }
    }

    const sourceAbsolute = join(this.contextTreeDir, sourcePath)
    const targetAbsolute = join(this.contextTreeDir, candidate.targetPath)

    try {
      // Ensure target directory exists
      await mkdir(dirname(targetAbsolute), {recursive: true})

      // Move the file (preserves basename — only parent path changes)
      await rename(sourceAbsolute, targetAbsolute)

      // Rewrite relations: old path → new path
      const pathMapping = new Map<string, string>()
      pathMapping.set(sourcePath, candidate.targetPath)
      const modifiedRelationPaths = await rewriteRelationsInTree(this.contextTreeDir, pathMapping)

      // Clean empty parent directories
      await cleanEmptyParentDirs(sourceAbsolute, this.contextTreeDir)

      const changedPaths = [
        sourcePath,
        candidate.targetPath,
        ...modifiedRelationPaths,
      ]

      // Quality metrics: use detection-time alignment scores from candidate metadata.
      // preDomainAlignment = how well keywords matched the original domain.
      // postDomainAlignment = how well keywords match the target domain (= confidence).
      const qualityMetrics: ReorgQualityMetrics = {
        postDomainAlignment: candidate.confidence,
        preDomainAlignment: typeof candidate.detectionMetadata.currentDomainSimilarity === 'number'
          ? candidate.detectionMetadata.currentDomainSimilarity
          : 1 - candidate.confidence, // fallback: approximate from confidence
      }

      return {
        candidate,
        changedPaths: [...new Set(changedPaths)],
        qualityMetrics,
        success: true,
      }
    } catch (error) {
      return {
        candidate,
        changedPaths: [],
        error: error instanceof Error ? error.message : String(error),
        success: false,
      }
    }
  }
}
