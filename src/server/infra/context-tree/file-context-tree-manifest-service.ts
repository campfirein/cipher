/* eslint-disable camelcase */
/**
 * File-based implementation of IContextTreeManifestService.
 *
 * Builds and reads the context manifest (_manifest.json) which allocates
 * context tree entries into three lanes (summaries, contexts, stubs)
 * with token budgets for efficient query context injection.
 *
 * Freshness check uses source_fingerprint (hash of sorted path:mtime:size)
 * to detect additions, modifications, and deletions. Stat-only, no file reads.
 *
 * Tradeoff: rare false-fresh cases where content changes but mtime+size
 * are preserved. Acceptable because writeFile() updates mtime and the next
 * curate run will rebuild the manifest anyway.
 */

import {readdir, readFile, stat, writeFile} from 'node:fs/promises'
import {join, relative} from 'node:path'

import type {
  ContextManifest,
  LaneTokens,
  ManifestEntry,
  ResolvedEntry,
} from '../../core/domain/knowledge/summary-types.js'
import type {IContextTreeManifestService} from '../../core/interfaces/context-tree/i-context-tree-manifest-service.js'

import {
  ABSTRACT_EXTENSION,
  ARCHIVE_DIR,
  BRV_DIR,
  CONTEXT_FILE_EXTENSION,
  CONTEXT_TREE_DIR,
  MANIFEST_FILE,
  STUB_EXTENSION,
  SUMMARY_INDEX_FILE,
} from '../../constants.js'
import {parseFrontmatterScoring} from '../../core/domain/knowledge/markdown-writer.js'
import {DEFAULT_LANE_BUDGETS} from '../../core/domain/knowledge/summary-types.js'
import {estimateTokens} from '../executor/pre-compaction/compaction-escalation.js'
import {isArchiveStub, isDerivedArtifact} from './derived-artifact.js'
import {computeContentHash} from './hash-utils.js'
import {toUnixPath} from './path-utils.js'
import {parseSummaryFrontmatter} from './summary-frontmatter.js'

export interface ManifestServiceConfig {
  baseDirectory?: string
}

export class FileContextTreeManifestService implements IContextTreeManifestService {
  private readonly config: ManifestServiceConfig

  constructor(config: ManifestServiceConfig = {}) {
    this.config = config
  }

  public async buildManifest(directory?: string, laneBudgets?: LaneTokens): Promise<ContextManifest> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const budgets = laneBudgets ?? DEFAULT_LANE_BUDGETS

    // Scan all entries
    const summaries: ManifestEntry[] = []
    const contexts: ManifestEntry[] = []
    const stubs: ManifestEntry[] = []

    await this.scanForManifest(contextTreeDir, contextTreeDir, summaries, contexts, stubs)

    // Lane allocation with prioritized fill
    const activeSummaries = this.allocateLane(
      summaries.sort((a, b) => (b.order ?? 0) - (a.order ?? 0)),
      budgets.summaries,
    )
    const activeContexts = this.allocateLane(
      contexts.sort((a, b) => (b.importance ?? 50) - (a.importance ?? 50)),
      budgets.contexts,
    )
    const activeStubs = this.allocateLane(stubs, budgets.stubs)

    const activeContext = [...activeSummaries, ...activeContexts, ...activeStubs]
    const totalTokens = activeContext.reduce((sum, e) => sum + e.tokens, 0)

    // Compute source fingerprint (stat-only, no file reads)
    const sourceFingerprint = await this.computeSourceFingerprint(contextTreeDir)

    const manifest: ContextManifest = {
      active_context: activeContext,
      generated_at: new Date().toISOString(),
      lane_tokens: {
        contexts: activeContexts.reduce((sum, e) => sum + e.tokens, 0),
        stubs: activeStubs.reduce((sum, e) => sum + e.tokens, 0),
        summaries: activeSummaries.reduce((sum, e) => sum + e.tokens, 0),
      },
      source_fingerprint: sourceFingerprint,
      total_tokens: totalTokens,
      version: 1,
    }

    // Write _manifest.json
    const manifestPath = join(contextTreeDir, MANIFEST_FILE)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    return manifest
  }

  public async readManifest(directory?: string): Promise<ContextManifest | null> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const manifestPath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, MANIFEST_FILE)

    try {
      const content = await readFile(manifestPath, 'utf8')

      return JSON.parse(content) as ContextManifest
    } catch {
      return null
    }
  }

  public async readManifestIfFresh(directory?: string): Promise<ContextManifest | null> {
    const manifest = await this.readManifest(directory)
    if (!manifest) return null

    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    // Compare stored fingerprint against current state
    const currentFingerprint = await this.computeSourceFingerprint(contextTreeDir)
    if (currentFingerprint !== manifest.source_fingerprint) return null

    return manifest
  }

  public async resolveForInjection(
    manifest: ContextManifest,
    _query?: string,
    directory?: string,
  ): Promise<ResolvedEntry[]> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    const resolved: ResolvedEntry[] = []

    // Order: summaries (broadest first) → contexts → stubs
    const ordered = [
      ...manifest.active_context.filter((e) => e.type === 'summary'),
      ...manifest.active_context.filter((e) => e.type === 'context'),
      ...manifest.active_context.filter((e) => e.type === 'stub'),
    ]

    /* eslint-disable no-await-in-loop */
    for (const entry of ordered) {
      try {
        let content: string
        // For context entries, prefer .abstract.md sibling if it exists on disk
        // (dynamic read avoids stale-manifest issues since .abstract.md is a derived artifact)
        if (entry.type === 'context') {
          const abstractRelPath = entry.path.replace(/\.md$/, ABSTRACT_EXTENSION)
          const abstractFullPath = join(contextTreeDir, abstractRelPath)
          try {
            content = await readFile(abstractFullPath, 'utf8')
          } catch {
            // Abstract not ready yet — fall back to full content
            content = await readFile(join(contextTreeDir, entry.path), 'utf8')
          }
        } else {
          content = await readFile(join(contextTreeDir, entry.path), 'utf8')
        }

        resolved.push({
          content,
          path: entry.path,
          tokens: entry.tokens,
          type: entry.type,
        })
      } catch {
        // Skip unreadable files
      }
    }
    /* eslint-enable no-await-in-loop */

    return resolved
  }

  /**
   * Allocate entries into a lane respecting the token budget.
   * Entries are already sorted by priority (caller responsibility).
   */
  private allocateLane(entries: ManifestEntry[], budget: number): ManifestEntry[] {
    const allocated: ManifestEntry[] = []
    let remaining = budget

    for (const entry of entries) {
      if (entry.tokens <= remaining) {
        allocated.push(entry)
        remaining -= entry.tokens
      }
    }

    return allocated
  }

  /**
   * Compute source fingerprint from stat data (path:mtime:size).
   * Stat-only — no file reads required.
   */
  private async computeSourceFingerprint(contextTreeDir: string): Promise<string> {
    const entries: Array<{mtime: number; path: string; size: number}> = []
    await this.scanSourceStats(contextTreeDir, contextTreeDir, entries)

    // Also include .abstract.md siblings so newly-written abstracts invalidate the manifest
    await this.scanAbstractStats(contextTreeDir, contextTreeDir, entries)

    const input = entries
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((e) => `${e.path}:${e.mtime}:${e.size}`)
      .join('\n')

    return computeContentHash(input)
  }

  /**
   * Recursively scan context tree for .abstract.md sibling files.
   * These are derived artifacts excluded from normal stat scan but included
   * here so their appearance invalidates the manifest (triggers abstract-aware rescan).
   */
  private async scanAbstractStats(
    currentDir: string,
    contextTreeDir: string,
    entries: Array<{mtime: number; path: string; size: number}>,
  ): Promise<void> {
    let dirEntries: import('node:fs').Dirent[]
    try {
      dirEntries = await readdir(currentDir, {withFileTypes: true}) as import('node:fs').Dirent[]
    } catch {
      return
    }

    /* eslint-disable no-await-in-loop */
    for (const entry of dirEntries) {
      const entryName = entry.name as string
      const fullPath = join(currentDir, entryName)

      if (entry.isDirectory()) {
        await this.scanAbstractStats(fullPath, contextTreeDir, entries)
      } else if (entry.isFile() && entryName.endsWith(ABSTRACT_EXTENSION)) {
        const relativePath = toUnixPath(relative(contextTreeDir, fullPath))
        try {
          const fileStat = await stat(fullPath)
          entries.push({
            mtime: fileStat.mtimeMs,
            path: relativePath,
            size: fileStat.size,
          })
        } catch {
          // Skip unreadable files
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  /**
   * Recursively scan _archived/ directory for .stub.md files.
   */
  private async scanArchivedStubs(
    currentDir: string,
    contextTreeDir: string,
    stubs: ManifestEntry[],
  ): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(currentDir, {withFileTypes: true}) as import('node:fs').Dirent[]
    } catch {
      return
    }

    /* eslint-disable no-await-in-loop */
    for (const entry of entries) {
      const entryName = entry.name as string
      const fullPath = join(currentDir, entryName)

      if (entry.isDirectory()) {
        await this.scanArchivedStubs(fullPath, contextTreeDir, stubs)
      } else if (entry.isFile() && entryName.endsWith(STUB_EXTENSION)) {
        const relativePath = toUnixPath(relative(contextTreeDir, fullPath))
        try {
          const content = await readFile(fullPath, 'utf8')
          stubs.push({
            path: relativePath,
            tokens: estimateTokens(content),
            type: 'stub',
          })
        } catch {
          // Skip unreadable stubs
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  /**
   * Recursively scan context tree, collecting entries for manifest building.
   */
  private async scanForManifest(
    currentDir: string,
    contextTreeDir: string,
    summaries: ManifestEntry[],
    contexts: ManifestEntry[],
    stubs: ManifestEntry[],
  ): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(currentDir, {withFileTypes: true}) as import('node:fs').Dirent[]
    } catch {
      return
    }

    /* eslint-disable no-await-in-loop */
    for (const entry of entries) {
      const entryName = entry.name as string
      const fullPath = join(currentDir, entryName)

      if (entry.isDirectory()) {
        // Scan _archived/ for .stub.md files only; recurse otherwise
        await (entryName === ARCHIVE_DIR
          ? this.scanArchivedStubs(fullPath, contextTreeDir, stubs)
          : this.scanForManifest(fullPath, contextTreeDir, summaries, contexts, stubs))
      } else if (entry.isFile() && entryName.endsWith(CONTEXT_FILE_EXTENSION)) {
        const relativePath = toUnixPath(relative(contextTreeDir, fullPath))

        if (entryName === SUMMARY_INDEX_FILE) {
          // Summary entry — read frontmatter for condensation_order and token_count
          try {
            const content = await readFile(fullPath, 'utf8')
            const fm = parseSummaryFrontmatter(content)
            summaries.push({
              order: fm?.condensation_order,
              path: relativePath,
              tokens: fm?.token_count ?? estimateTokens(content),
              type: 'summary',
            })
          } catch {
            // Skip unreadable summaries
          }
        } else if (!isDerivedArtifact(relativePath) && !isArchiveStub(relativePath)) {
          // Regular context entry — extract importance from frontmatter
          try {
            const content = await readFile(fullPath, 'utf8')
            const scoring = parseFrontmatterScoring(content)

            // Check for a sibling .abstract.md — use its token count for lane budgeting
            const abstractRelPath = relativePath.replace(/\.md$/, ABSTRACT_EXTENSION)
            const abstractFullPath = join(contextTreeDir, abstractRelPath)
            let abstractTokens: number | undefined
            try {
              const abstractContent = await readFile(abstractFullPath, 'utf8')
              abstractTokens = estimateTokens(abstractContent)
            } catch { /* no abstract yet */ }

            contexts.push({
              abstractPath: abstractTokens === undefined ? undefined : abstractRelPath,
              abstractTokens,
              importance: scoring?.importance ?? 50,
              path: relativePath,
              tokens: abstractTokens ?? estimateTokens(content),
              type: 'context',
            })
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  /**
   * Recursively collect stat data for all source files (for fingerprint).
   * Excludes derived artifacts.
   */
  private async scanSourceStats(
    currentDir: string,
    contextTreeDir: string,
    entries: Array<{mtime: number; path: string; size: number}>,
  ): Promise<void> {
    let dirEntries: import('node:fs').Dirent[]
    try {
      dirEntries = await readdir(currentDir, {withFileTypes: true}) as import('node:fs').Dirent[]
    } catch {
      return
    }

    /* eslint-disable no-await-in-loop */
    for (const entry of dirEntries) {
      const entryName = entry.name as string
      const fullPath = join(currentDir, entryName)

      if (entry.isDirectory()) {
        await this.scanSourceStats(fullPath, contextTreeDir, entries)
      } else if (entry.isFile() && entryName.endsWith(CONTEXT_FILE_EXTENSION)) {
        const relativePath = toUnixPath(relative(contextTreeDir, fullPath))
        // Include all non-derived files (contexts + stubs) in fingerprint
        if (isDerivedArtifact(relativePath)) continue

        try {
          const fileStat = await stat(fullPath)
          entries.push({
            mtime: fileStat.mtimeMs,
            path: relativePath,
            size: fileStat.size,
          })
        } catch {
          // Skip unreadable files
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }
}
