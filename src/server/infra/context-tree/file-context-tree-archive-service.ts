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
import type {ILogger} from '../../../agent/core/interfaces/i-logger.js'
import type {RuntimeSignals} from '../../core/domain/knowledge/runtime-signals-schema.js'
import type {ArchiveResult, DrillDownResult} from '../../core/domain/knowledge/summary-types.js'
import type {IContextTreeArchiveService} from '../../core/interfaces/context-tree/i-context-tree-archive-service.js'
import type {IRuntimeSignalStore} from '../../core/interfaces/storage/i-runtime-signal-store.js'

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
import {createDefaultRuntimeSignals} from '../../core/domain/knowledge/runtime-signals-schema.js'
import {warnSidecarFailure} from '../../core/domain/knowledge/sidecar-logging.js'
import {estimateTokens} from '../executor/pre-compaction/compaction-escalation.js'
import {isArchiveStub, isDerivedArtifact} from './derived-artifact.js'
import {toUnixPath} from './path-utils.js'
import {generateArchiveStubContent, parseArchiveStubFrontmatter} from './summary-frontmatter.js'

export class FileContextTreeArchiveService implements IContextTreeArchiveService {
  constructor(
    private readonly runtimeSignalStore?: IRuntimeSignalStore,
    private readonly logger?: ILogger,
  ) {}

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

    // Capture current importance from the sidecar for the archive stub's
    // eviction metadata. Falls back to the default when no sidecar entry
    // exists (pre-migration files, or a sidecar that hasn't been written to
    // for this path). Fail-open on sidecar errors.
    const importance = await this.readImportanceForArchiveMetadata(toUnixPath(relativePath))

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

    // Dual-write: drop the archived file's runtime-signal entry so the
    // sidecar does not retain an orphan. Fail-open — markdown is canonical.
    if (this.runtimeSignalStore) {
      try {
        await this.runtimeSignalStore.delete(toUnixPath(relativePath))
      } catch (error) {
        // Best-effort — archive already succeeded.
        warnSidecarFailure(this.logger, 'archive-service', 'delete', relativePath, error)
      }
    }

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

    // Preload the runtime-signal map once per scan. `list()` returns only
    // paths with stored entries; paths without one fall back to defaults at
    // the comparison site. On sidecar failure, scan with an empty map —
    // archive candidacy then depends on defaults only (importance 50), which
    // keeps all draft entries above the threshold and archives nothing. That
    // is the safest fallback when scoring data is unavailable.
    let signalsByPath: Map<string, RuntimeSignals>
    try {
      signalsByPath = this.runtimeSignalStore ? await this.runtimeSignalStore.list() : new Map()
    } catch (error) {
      warnSidecarFailure(this.logger, 'archive-service', 'list', 'candidate scan', error)
      signalsByPath = new Map()
    }

    const candidates: string[] = []
    await this.scanForCandidates(contextTreeDir, contextTreeDir, candidates, signalsByPath)

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

    // Dual-write: seed the restored file with default signals. Signal
    // history from before archiving was already dropped on archive — restore
    // is a user-initiated action, so resetting to defaults is acceptable.
    if (this.runtimeSignalStore) {
      try {
        await this.runtimeSignalStore.set(toUnixPath(fm.original_path), createDefaultRuntimeSignals())
      } catch (error) {
        // Best-effort — markdown restore already succeeded.
        warnSidecarFailure(this.logger, 'archive-service', 'seed', fm.original_path, error)
      }
    }

    return fm.original_path
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
   * Extract the `updatedAt` timestamp from markdown frontmatter. This is
   * the one scoring-adjacent field that stays in markdown (it tracks real
   * content modification, not a runtime signal).
   */
  private parseUpdatedAt(content: string): string | undefined {
    const match = /^updatedAt:\s*['"]?(.+?)['"]?\s*$/m.exec(content)
    return match ? match[1] : undefined
  }

  /**
   * Read the importance value to embed in an archive stub's eviction metadata.
   * Pulls from the runtime-signal sidecar (source of truth post-commit-4),
   * falling back to the default when no entry exists or the store is
   * unavailable.
   */
  private async readImportanceForArchiveMetadata(relativePath: string): Promise<number> {
    if (!this.runtimeSignalStore) return createDefaultRuntimeSignals().importance
    try {
      const signals = await this.runtimeSignalStore.get(relativePath)
      return signals.importance
    } catch (error) {
      warnSidecarFailure(
        this.logger,
        'archive-service',
        'get',
        `${relativePath} (archive metadata read)`,
        error,
      )
      return createDefaultRuntimeSignals().importance
    }
  }

  /**
   * Recursively scan context tree for archive candidates.
   */
  private async scanForCandidates(
    currentDir: string,
    contextTreeDir: string,
    candidates: string[],
    signalsByPath: Map<string, RuntimeSignals>,
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
        await this.scanForCandidates(fullPath, contextTreeDir, candidates, signalsByPath)
      } else if (entry.isFile() && entryName.endsWith(CONTEXT_FILE_EXTENSION)) {
        const relativePath = toUnixPath(fullPath.slice(contextTreeDir.length + 1))
        if (isDerivedArtifact(relativePath) || isArchiveStub(relativePath)) continue

        try {
          // Runtime signals come from the sidecar; `updatedAt` stays in
          // markdown because it reflects content modification time, not a
          // ranking signal. Paths without a sidecar entry use defaults —
          // maturity 'draft' passes the gate, importance 50 stays above
          // ARCHIVE_IMPORTANCE_THRESHOLD (which is < 50), so files without
          // recorded signals are correctly excluded from archival.
          const signals = signalsByPath.get(relativePath) ?? createDefaultRuntimeSignals()

          // Only archive draft entries below importance threshold
          if (signals.maturity !== 'draft') continue

          const content = await readFile(fullPath, 'utf8')
          const updatedAt = this.parseUpdatedAt(content)
          const daysSinceUpdate = updatedAt
            ? (now - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
            : 0
          const decayed = applyDecay(signals, daysSinceUpdate)

          if (decayed.importance < ARCHIVE_IMPORTANCE_THRESHOLD) {
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
