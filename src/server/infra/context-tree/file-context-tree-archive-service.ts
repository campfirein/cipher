/* eslint-disable camelcase */
/**
 * File-based implementation of IContextTreeArchiveService.
 *
 * Archives low-importance context entries into _archived/ with:
 * - .full.md: lossless preserved original content
 * - .stub.md: searchable ghost cue (~220 tokens) with lineage pointers
 *
 * Archive naming preserves relative paths to avoid collisions:
 *   auth/jwt-tokens/refresh-flow.md → _archived/auth/jwt-tokens/refresh-flow.stub.md
 *
 * Fail-open: any error during ghost cue generation falls back to deterministic truncation.
 */

import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {dirname, extname, join} from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {FrontmatterScoring} from '../../core/domain/knowledge/markdown-writer.js'
import type {ArchiveResult, DrillDownResult} from '../../core/domain/knowledge/summary-types.js'
import type {IContextTreeArchiveService} from '../../core/interfaces/context-tree/i-context-tree-archive-service.js'

import {
  ARCHIVE_DIR,
  ARCHIVE_IMPORTANCE_THRESHOLD,
  BRV_DIR,
  CONTEXT_FILE_EXTENSION,
  CONTEXT_TREE_DIR,
  DEFAULT_GHOST_CUE_MAX_TOKENS,
  FULL_ARCHIVE_EXTENSION,
  STUB_EXTENSION,
} from '../../constants.js'
import {applyDecay} from '../../core/domain/knowledge/memory-scoring.js'
import {estimateTokens} from '../executor/pre-compaction/compaction-escalation.js'
import {isArchiveStub, isDerivedArtifact} from './derived-artifact.js'
import {toUnixPath} from './path-utils.js'
import {generateArchiveStubContent, parseArchiveStubFrontmatter} from './summary-frontmatter.js'

export class FileContextTreeArchiveService implements IContextTreeArchiveService {
  public async archiveEntry(
    relativePath: string,
    agent: ICipherAgent,
    directory?: string,
  ): Promise<ArchiveResult> {
    const baseDir = directory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const originalFullPath = join(contextTreeDir, relativePath)

    // Read original content
    const content = await readFile(originalFullPath, 'utf8')
    const originalTokenCount = estimateTokens(content)

    // Compute archive paths: replace extension with .stub.md / .full.md
    const pathWithoutExt = relativePath.slice(0, -extname(relativePath).length)
    const stubRelPath = join(ARCHIVE_DIR, `${pathWithoutExt}${STUB_EXTENSION}`)
    const fullRelPath = join(ARCHIVE_DIR, `${pathWithoutExt}${FULL_ARCHIVE_EXTENSION}`)
    const stubFullPath = join(contextTreeDir, stubRelPath)
    const fullFullPath = join(contextTreeDir, fullRelPath)

    // Create parent directories under _archived/
    await mkdir(dirname(stubFullPath), {recursive: true})

    // Write .full.md — verbatim original content (lossless)
    await writeFile(fullFullPath, content, 'utf8')

    // Generate ghost cue via LLM (fail-open to deterministic truncation)
    const ghostCue = await this.generateGhostCue(agent, content)
    const ghostCueTokenCount = estimateTokens(ghostCue)

    // Parse frontmatter to get importance for eviction metadata
    const importance = this.extractImportance(content)

    // Write .stub.md with archive stub frontmatter
    const stubContent = generateArchiveStubContent(
      {
        evicted_at: new Date().toISOString(),
        evicted_importance: importance,
        original_path: relativePath,
        original_token_count: originalTokenCount,
        points_to: toUnixPath(fullRelPath),
        type: 'archive_stub',
      },
      ghostCue,
    )
    await writeFile(stubFullPath, stubContent, 'utf8')

    // Delete original file
    await unlink(originalFullPath)

    return {
      fullPath: toUnixPath(fullRelPath),
      ghostCueTokenCount,
      originalPath: relativePath,
      stubPath: toUnixPath(stubRelPath),
    }
  }

  public async drillDown(stubPath: string, directory?: string): Promise<DrillDownResult> {
    const baseDir = directory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const stubFullPath = join(contextTreeDir, stubPath)

    // Parse stub to get points_to
    const stubContent = await readFile(stubFullPath, 'utf8')
    const fm = parseArchiveStubFrontmatter(stubContent)
    if (!fm) {
      throw new Error(`Invalid archive stub: ${stubPath}`)
    }

    // Read full content
    const fullPath = join(contextTreeDir, fm.points_to)
    const fullContent = await readFile(fullPath, 'utf8')

    return {
      fullContent,
      originalPath: fm.original_path,
      tokenCount: estimateTokens(fullContent),
    }
  }

  public async findArchiveCandidates(directory?: string): Promise<string[]> {
    const baseDir = directory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    const candidates: string[] = []
    await this.scanForCandidates(contextTreeDir, contextTreeDir, candidates)

    return candidates
  }

  public async restoreEntry(stubPath: string, directory?: string): Promise<string> {
    const baseDir = directory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const stubFullPath = join(contextTreeDir, stubPath)

    // Parse stub to get original_path and points_to
    const stubContent = await readFile(stubFullPath, 'utf8')
    const fm = parseArchiveStubFrontmatter(stubContent)
    if (!fm) {
      throw new Error(`Invalid archive stub: ${stubPath}`)
    }

    // Read full content
    const fullPath = join(contextTreeDir, fm.points_to)
    const fullContent = await readFile(fullPath, 'utf8')

    // Write to original path (restore)
    const restoredPath = join(contextTreeDir, fm.original_path)
    await mkdir(dirname(restoredPath), {recursive: true})
    await writeFile(restoredPath, fullContent, 'utf8')

    // Delete stub and full archive files
    await unlink(stubFullPath)
    await unlink(fullPath)

    return fm.original_path
  }

  /**
   * Extract importance score from frontmatter. Returns 50 if not found.
   */
  private extractImportance(content: string): number {
    const match = /^importance:\s*(\d+(?:\.\d+)?)/m.exec(content)

    return match ? Number.parseFloat(match[1]) : 50
  }

  /**
   * Generate a ghost cue using LLM with deterministic fallback.
   */
  private async generateGhostCue(agent: ICipherAgent, content: string): Promise<string> {
    try {
      const taskId = `ghost_cue_${Date.now()}`
      const sessionId = await agent.createTaskSession(taskId, 'query')
      try {
        const prompt = `Summarize the following knowledge entry in ~${DEFAULT_GHOST_CUE_MAX_TOKENS} tokens or less. Output ONLY the summary. Preserve key entity names and relationships.

<content>
${content.slice(0, 8000)}
</content>`

        const response = await agent.executeOnSession(sessionId, prompt, {
          executionContext: {
            clearHistory: true,
            commandType: 'query',
            maxIterations: 1,
            maxTokens: DEFAULT_GHOST_CUE_MAX_TOKENS * 4, // chars ≈ tokens * 4
            temperature: 0.3,
          },
          taskId,
        })

        if (response && response.trim().length > 20) {
          return response.trim()
        }
      } finally {
        await agent.deleteTaskSession(sessionId)
      }
    } catch {
      // Fall through to deterministic fallback
    }

    // Deterministic fallback: truncate content
    return `${content.replaceAll(/\s+/g, ' ').trim().slice(0, 320)}...`
  }

  /**
   * Parse FrontmatterScoring fields from content frontmatter.
   */
  private parseScoring(content: string): FrontmatterScoring {
    const scoring: FrontmatterScoring = {}

    const importanceMatch = /^importance:\s*(\d+(?:\.\d+)?)/m.exec(content)
    if (importanceMatch) scoring.importance = Number.parseFloat(importanceMatch[1])

    const maturityMatch = /^maturity:\s*['"]?(core|draft|validated)['"]?/m.exec(content)
    if (maturityMatch) scoring.maturity = maturityMatch[1] as FrontmatterScoring['maturity']

    const updatedMatch = /^updatedAt:\s*['"]?(.+?)['"]?\s*$/m.exec(content)
    if (updatedMatch) scoring.updatedAt = updatedMatch[1]

    return scoring
  }

  /**
   * Recursively scan context tree for archive candidates.
   */
  private async scanForCandidates(
    currentDir: string,
    contextTreeDir: string,
    candidates: string[],
  ): Promise<void> {
    const {readdir: readdirFs} = await import('node:fs/promises')
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdirFs(currentDir, {withFileTypes: true}) as import('node:fs').Dirent[]
    } catch {
      return
    }

    const now = Date.now()

    /* eslint-disable no-await-in-loop */
    for (const entry of entries) {
      const entryName = entry.name as string
      const fullPath = join(currentDir, entryName)

      if (entry.isDirectory()) {
        if (entryName === ARCHIVE_DIR) continue
        await this.scanForCandidates(fullPath, contextTreeDir, candidates)
      } else if (entry.isFile() && entryName.endsWith(CONTEXT_FILE_EXTENSION)) {
        const relativePath = toUnixPath(fullPath.slice(contextTreeDir.length + 1))
        if (isDerivedArtifact(relativePath) || isArchiveStub(relativePath)) continue

        try {
          const content = await readFile(fullPath, 'utf8')
          const scoring = this.parseScoring(content)

          // Only archive draft entries below importance threshold
          if (scoring.maturity !== 'draft') continue

          const daysSinceUpdate = scoring.updatedAt
            ? (now - new Date(scoring.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
            : 0
          const decayed = applyDecay(scoring, daysSinceUpdate)

          if ((decayed.importance ?? 50) < ARCHIVE_IMPORTANCE_THRESHOLD) {
            candidates.push(relativePath)
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }
}
