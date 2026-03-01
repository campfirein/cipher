import MiniSearch from 'minisearch'
import {join} from 'node:path'
import {removeStopwords} from 'stopword'

import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../sandbox/tools-sdk.js'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR, SUMMARY_INDEX_FILE} from '../../../../server/constants.js'
import {
  type FrontmatterScoring,
  parseFrontmatterScoring,
  updateScoringInContent,
} from '../../../../server/core/domain/knowledge/markdown-writer.js'
import {
  applyDecay,
  applyDefaultScoring,
  compoundScore,
  determineTier,
  recordAccessHits,
} from '../../../../server/core/domain/knowledge/memory-scoring.js'
import { isArchiveStub, isDerivedArtifact } from '../../../../server/infra/context-tree/derived-artifact.js'
import { parseArchiveStubFrontmatter, parseSummaryFrontmatter } from '../../../../server/infra/context-tree/summary-frontmatter.js'
import { isPathLikeQuery, matchMemoryPath, parseSymbolicQuery } from './memory-path-matcher.js'
import {
  buildReferenceIndex,
  buildSymbolTree,
  getSubtreeDocumentIds,
  getSymbolKindLabel,
  getSymbolOverview,
  MemorySymbolKind,
  type MemorySymbolTree,
  type ReferenceIndex,
  type SummaryDocLike,
} from './memory-symbol-tree.js'

const MAX_CONTEXT_TREE_FILES = 10_000
const DEFAULT_CACHE_TTL_MS = 5000

/** Bump when MINISEARCH_OPTIONS fields/boost change to invalidate cached indexes */
const INDEX_SCHEMA_VERSION = 4

/** Only include results whose normalized score is at least this fraction of the top result's score */
const SCORE_GAP_RATIO = 0.75

/** Minimum normalized score for the top result. Below this, the query is considered out-of-domain */
const MINIMUM_RELEVANCE_SCORE = 0.6

/** Normalized score threshold above which results are trusted despite unmatched query terms */
const UNMATCHED_TERM_SCORE_THRESHOLD = 0.85

/** Minimum query term length to consider "significant" for OOD term-based detection */
const UNMATCHED_TERM_MIN_LENGTH = 4

/** Chunk size in characters for smart excerpt extraction (~200 tokens) */
const CHUNK_SIZE_CHARS = 800

/** Overlap between chunks in characters (15% of chunk size) */
const CHUNK_OVERLAP_CHARS = 120

/**
 * Normalize raw MiniSearch BM25 score to [0, 1) range.
 * Uses the monotonic formula: score / (1 + score)
 * Maps: strong(15)→0.94, medium(8)→0.89, moderate(4)→0.80, weak(1)→0.50, none(0)→0.
 * Query-independent — no per-query normalization needed.
 */
function normalizeScore(rawScore: number): number {
  return rawScore / (1 + rawScore)
}

const MINISEARCH_OPTIONS = {
  fields: ['title', 'content', 'path'] as string[],
  idField: 'id' as const,
  searchOptions: {
    boost: {path: 1.5, title: 3},
    fuzzy: 0.2,
    prefix: true,
  },
  storeFields: ['title', 'path'] as string[],
}

interface IndexedDocument {
  content: string
  id: string
  mtime: number
  path: string
  scoring: FrontmatterScoring
  title: string
}

interface CachedIndex {
  contextTreePath: string
  documentMap: Map<string, IndexedDocument>
  fileMtimes: Map<string, number>
  index: MiniSearch<IndexedDocument>
  lastValidatedAt: number
  referenceIndex: ReferenceIndex
  schemaVersion: number
  /** _index.md files collected separately for symbol tree annotation */
  summaryMap: Map<string, SummaryDocLike>
  symbolTree: MemorySymbolTree
}

/**
 * State for managing concurrent access to the search index.
 * Uses a promise-based lock to prevent duplicate index builds during parallel execution.
 */
interface IndexState {
  /** Promise for an in-progress index build, undefined if no build is in progress */
  buildingPromise: Promise<CachedIndex> | undefined
  /** Cached index data, undefined if not yet built */
  cachedIndex: CachedIndex | undefined
}

/**
 * Configuration for SearchKnowledgeService.
 */
export interface SearchKnowledgeServiceConfig {
  /** Base directory for the project (defaults to process.cwd()) */
  baseDirectory?: string
  /** Cache TTL in milliseconds (defaults to 5000) */
  cacheTtlMs?: number
}

/**
 * Extended search options supporting symbolic filters.
 */
export interface SearchOptions {
  /** Symbol kinds to exclude from results (e.g. ['subtopic']) */
  excludeKinds?: string[]
  /** Symbol kinds to include in results (e.g. ['domain', 'context']) */
  includeKinds?: string[]
  /** Maximum number of results to return */
  limit?: number
  /** Minimum maturity tier for results */
  minMaturity?: 'core' | 'draft' | 'validated'
  /** If true, return tree structure overview instead of search results */
  overview?: boolean
  /** Depth for overview mode (default: 2) */
  overviewDepth?: number
  /** Path prefix to scope search within (e.g. "auth" or "auth/jwt-tokens") */
  scope?: string
}

function filterStopWords(query: string): string {
  const words = query.toLowerCase().split(/\s+/)
  const filtered = removeStopwords(words)
  return filtered.length > 0 ? filtered.join(' ') : query
}

/**
 * Checks if any significant query term is completely unmatched across search results.
 * Uses MiniSearch's queryTerms property to identify which terms actually matched.
 * A "significant" term is one with length >= UNMATCHED_TERM_MIN_LENGTH (filters out
 * short generic words that are noisy for OOD detection).
 */
function hasUnmatchedSignificantTerms(queryTerms: string[], searchResults: Array<{queryTerms: string[]}>): boolean {
  const significantTerms = queryTerms.filter((t) => t.length >= UNMATCHED_TERM_MIN_LENGTH)
  if (significantTerms.length === 0) return false

  const allMatchedQueryTerms = new Set<string>()
  for (const result of searchResults.slice(0, 10)) {
    for (const term of result.queryTerms) {
      allMatchedQueryTerms.add(term)
    }
  }

  return significantTerms.some((t) => !allMatchedQueryTerms.has(t))
}

function extractTitle(content: string, fallbackTitle: string): string {
  const match = /^# (.+)$/m.exec(content)
  return match ? match[1].trim() : fallbackTitle
}

/**
 * Find the best semantic break point in a chunk slice.
 * Searches the last 30% of the text for break points with priority:
 * paragraph (\n\n) > sentence (. ? !) > line (\n).
 * Returns the character offset to break at, or -1 if no good break found.
 */
function findBreakPoint(slice: string): number {
  const searchStart = Math.floor(slice.length * 0.7)
  const searchSlice = slice.slice(searchStart)

  const paraBreak = searchSlice.lastIndexOf('\n\n')
  if (paraBreak !== -1) {
    return searchStart + paraBreak + 2
  }

  const sentEnd = Math.max(
    searchSlice.lastIndexOf('. '),
    searchSlice.lastIndexOf('.\n'),
    searchSlice.lastIndexOf('? '),
    searchSlice.lastIndexOf('?\n'),
    searchSlice.lastIndexOf('! '),
    searchSlice.lastIndexOf('!\n'),
  )
  if (sentEnd !== -1) {
    return searchStart + sentEnd + 2
  }

  const lineBreak = searchSlice.lastIndexOf('\n')
  if (lineBreak !== -1) {
    return searchStart + lineBreak + 1
  }

  return -1
}

/**
 * Chunk a document into overlapping pieces with smart break-point detection.
 * Inspired by QMD's chunking strategy — breaks at semantic boundaries
 * (paragraph > sentence > line > word) for coherent excerpts.
 */
function chunkDocument(content: string): {pos: number; text: string}[] {
  if (content.length <= CHUNK_SIZE_CHARS) {
    return [{pos: 0, text: content}]
  }

  const chunks: {pos: number; text: string}[] = []
  let charPos = 0

  while (charPos < content.length) {
    let endPos = Math.min(charPos + CHUNK_SIZE_CHARS, content.length)

    // Find best break point in last 30% of chunk
    if (endPos < content.length) {
      const breakOffset = findBreakPoint(content.slice(charPos, endPos))
      if (breakOffset !== -1) {
        endPos = charPos + breakOffset
      }
    }

    // Ensure forward progress
    if (endPos <= charPos) {
      endPos = Math.min(charPos + CHUNK_SIZE_CHARS, content.length)
    }

    chunks.push({pos: charPos, text: content.slice(charPos, endPos)})

    if (endPos >= content.length) break

    // Overlap with previous chunk
    charPos = endPos - CHUNK_OVERLAP_CHARS
    if (charPos <= chunks.at(-1)!.pos) {
      charPos = endPos
    }
  }

  return chunks
}

function extractExcerpt(content: string, query: string, maxLength: number = 800): string {
  // Strip ## Relations section and title heading
  const relationsMatch = /^## Relations\n([\S\s]*?)(?=\n## |\n# |$)/m.exec(content)
  let cleanContent = content
  if (relationsMatch) {
    cleanContent = content.replace(relationsMatch[0], '').trim()
  }

  cleanContent = cleanContent.replace(/^# .+$/m, '').trim()

  // Chunk the document into semantically coherent pieces
  const chunks = chunkDocument(cleanContent)

  // Score each chunk by query term density and pick the best
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)

  let bestChunk = chunks[0]
  let bestScore = -1

  for (const chunk of chunks) {
    const chunkLower = chunk.text.toLowerCase()
    const score = queryTerms.reduce((acc, term) => acc + (chunkLower.includes(term) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestChunk = chunk
    }
  }

  let excerpt = bestChunk.text.trim()
  if (excerpt.length > maxLength) {
    excerpt = excerpt.slice(0, maxLength).trim() + '...'
  } else if (chunks.length > 1) {
    excerpt += '...'
  }

  return excerpt || cleanContent.slice(0, maxLength) + (cleanContent.length > maxLength ? '...' : '')
}

async function findMarkdownFilesWithMtime(
  fileSystem: IFileSystem,
  contextTreePath: string,
): Promise<Array<{mtime: number; path: string}>> {
  try {
    const globResult = await fileSystem.globFiles(`**/*${CONTEXT_FILE_EXTENSION}`, {
      cwd: contextTreePath,
      includeMetadata: true,
      maxResults: MAX_CONTEXT_TREE_FILES,
      respectGitignore: false,
    })

    return globResult.files.map((f) => {
      let relativePath = f.path
      if (f.path.startsWith(contextTreePath)) {
        relativePath = f.path.slice(contextTreePath.length + 1)
      }

      return {
        mtime: f.modified?.getTime() ?? 0,
        path: relativePath,
      }
    })
  } catch {
    return []
  }
}

function isCacheValid(cache: CachedIndex, currentFiles: Array<{mtime: number; path: string}>): boolean {
  if (cache.fileMtimes.size !== currentFiles.length) {
    return false
  }

  for (const file of currentFiles) {
    const cachedMtime = cache.fileMtimes.get(file.path)
    if (cachedMtime === undefined || cachedMtime !== file.mtime) {
      return false
    }
  }

  return true
}

async function buildFreshIndex(
  fileSystem: IFileSystem,
  contextTreePath: string,
  filesWithMtime: Array<{mtime: number; path: string}>,
): Promise<CachedIndex> {
  const now = Date.now()

  if (filesWithMtime.length === 0) {
    const index = new MiniSearch<IndexedDocument>(MINISEARCH_OPTIONS)
    return {
      contextTreePath,
      documentMap: new Map(),
      fileMtimes: new Map(),
      index,
      lastValidatedAt: now,
      referenceIndex: { backlinks: new Map(), forwardLinks: new Map() },
      schemaVersion: INDEX_SCHEMA_VERSION,
      summaryMap: new Map(),
      symbolTree: { root: [], symbolMap: new Map() },
    }
  }

  // Partition files: _index.md → summaryFiles, derived artifacts → skip, rest → indexable
  const summaryFiles: Array<{mtime: number; path: string}> = []
  const indexableFiles: Array<{mtime: number; path: string}> = []

  for (const file of filesWithMtime) {
    const fileName = file.path.split('/').at(-1) ?? ''
    if (fileName === SUMMARY_INDEX_FILE) {
      summaryFiles.push(file)
    } else if (!isDerivedArtifact(file.path)) {
      // Includes regular .md files AND .stub.md files (stubs are searchable)
      indexableFiles.push(file)
    }
    // .full.md and _manifest.json are skipped (isDerivedArtifact returns true)
  }

  // Read indexable documents for BM25 index
  const documentPromises = indexableFiles.map(async ({mtime, path: filePath}) => {
    try {
      const fullPath = join(contextTreePath, filePath)
      const {content} = await fileSystem.readFile(fullPath)
      const title = extractTitle(content, filePath.replace(/\.md$/, '').split('/').pop() || filePath)
      const scoring = parseFrontmatterScoring(content) ?? applyDefaultScoring()

      return {
        content,
        id: filePath,
        mtime,
        path: filePath,
        scoring,
        title,
      }
    } catch {
      return null
    }
  })

  // Read _index.md files separately for summaryMap (not indexed in BM25)
  const summaryPromises = summaryFiles.map(async ({ path: filePath }) => {
    try {
      const fullPath = join(contextTreePath, filePath)
      const { content } = await fileSystem.readFile(fullPath)
      const fm = parseSummaryFrontmatter(content)
      if (!fm) return null

      return {
        condensationOrder: fm.condensation_order,
        path: filePath,
        tokenCount: fm.token_count,
      } satisfies SummaryDocLike
    } catch {
      return null
    }
  })

  const [docResults, summaryResults] = await Promise.all([
    Promise.all(documentPromises),
    Promise.all(summaryPromises),
  ])

  const documents = docResults.filter((doc): doc is IndexedDocument => doc !== null)

  const documentMap = new Map<string, IndexedDocument>()
  const fileMtimes = new Map<string, number>()
  for (const doc of documents) {
    documentMap.set(doc.id, doc)
    fileMtimes.set(doc.path, doc.mtime)
  }

  // Also track summary file mtimes for cache invalidation
  for (const sf of summaryFiles) {
    fileMtimes.set(sf.path, sf.mtime)
  }

  const summaryMap = new Map<string, SummaryDocLike>()
  for (const summary of summaryResults) {
    if (summary) {
      summaryMap.set(summary.path, summary)
    }
  }

  const index = new MiniSearch<IndexedDocument>(MINISEARCH_OPTIONS)
  index.addAll(documents)

  // Build symbolic structures from the document map, with summary annotations
  const symbolTree = buildSymbolTree(documentMap, summaryMap)
  const referenceIndex = buildReferenceIndex(documentMap)

  return {
    contextTreePath,
    documentMap,
    fileMtimes,
    index,
    lastValidatedAt: now,
    referenceIndex,
    schemaVersion: INDEX_SCHEMA_VERSION,
    summaryMap,
    symbolTree,
  }
}

/**
 * Acquires the search index, using cached data when valid or building a fresh index.
 * Uses promise-based locking to prevent duplicate builds during parallel execution.
 */
async function acquireIndex(
  state: IndexState,
  fileSystem: IFileSystem,
  contextTreePath: string,
  ttlMs: number,
  onBeforeBuild?: (contextTreePath: string) => Promise<void>,
): Promise<CachedIndex | {error: true; result: SearchKnowledgeResult}> {
  const now = Date.now()

  // Fast path: TTL-based cache hit (no I/O needed)
  if (
    state.cachedIndex &&
    state.cachedIndex.contextTreePath === contextTreePath &&
    state.cachedIndex.schemaVersion === INDEX_SCHEMA_VERSION &&
    ttlMs > 0 &&
    now - state.cachedIndex.lastValidatedAt < ttlMs
  ) {
    return state.cachedIndex
  }

  // If another call is already building the index, wait for it
  if (state.buildingPromise) {
    return state.buildingPromise
  }

  // Create and store the build promise SYNCHRONOUSLY before any await
  // This prevents race conditions where multiple parallel calls all start building
  const buildPromise = (async (): Promise<CachedIndex> => {
    // Check if context tree exists (only if no cache or different path)
    if (!state.cachedIndex || state.cachedIndex.contextTreePath !== contextTreePath) {
      try {
        await fileSystem.listDirectory(contextTreePath)
      } catch {
        // Return empty index to signal error - caller will handle
        const emptyIndex = new MiniSearch<IndexedDocument>(MINISEARCH_OPTIONS)
        return {
          contextTreePath: '',
          documentMap: new Map(),
          fileMtimes: new Map(),
          index: emptyIndex,
          lastValidatedAt: 0,
          referenceIndex: { backlinks: new Map(), forwardLinks: new Map() },
          schemaVersion: INDEX_SCHEMA_VERSION,
          summaryMap: new Map(),
          symbolTree: { root: [], symbolMap: new Map() },
        }
      }
    }

    const allFiles = await findMarkdownFilesWithMtime(fileSystem, contextTreePath)
    // Exclude non-indexable derived artifacts (.full.md) so that currentFiles
    // matches what buildFreshIndex tracks in fileMtimes. Without this filter,
    // isCacheValid() sees a size mismatch once archives exist, causing cache thrash.
    // _index.md is kept (tracked for summary staleness), .stub.md is kept (BM25 indexed).
    const currentFiles = allFiles.filter((f) => !isDerivedArtifact(f.path) || f.path.split('/').at(-1) === SUMMARY_INDEX_FILE)

    // Re-check cache validity after getting file list (another call may have finished)
    if (
      state.cachedIndex &&
      state.cachedIndex.contextTreePath === contextTreePath &&
      state.cachedIndex.schemaVersion === INDEX_SCHEMA_VERSION &&
      isCacheValid(state.cachedIndex, currentFiles)
    ) {
      // Update timestamp atomically by creating a new object
      const updatedCache: CachedIndex = {
        ...state.cachedIndex,
        lastValidatedAt: Date.now(),
      }
      state.cachedIndex = updatedCache
      return updatedCache
    }

    // Flush pending access hits before building so updated scoring is picked up
    if (onBeforeBuild) {
      await onBeforeBuild(contextTreePath)
    }

    // Build fresh index
    const freshIndex = await buildFreshIndex(fileSystem, contextTreePath, currentFiles)
    state.cachedIndex = freshIndex
    return freshIndex
  })()

  // Store promise IMMEDIATELY (synchronously) so parallel calls can wait on it
  state.buildingPromise = buildPromise

  try {
    const result = await buildPromise

    // Check for error signal (empty contextTreePath means listDirectory failed)
    if (result.contextTreePath === '') {
      return {
        error: true,
        result: {
          message: 'Context tree not initialized. Run /init to create it.',
          results: [],
          totalFound: 0,
        },
      }
    }

    return result
  } finally {
    // Clear the lock after completion (success or failure)
    state.buildingPromise = undefined
  }
}

/**
 * SearchKnowledgeService implementation.
 * Provides knowledge search functionality with caching and indexing.
 */
export class SearchKnowledgeService implements ISearchKnowledgeService {
  private readonly baseDirectory: string
  private readonly cacheTtlMs: number
  private readonly fileSystem: IFileSystem
  private readonly pendingAccessHits: Map<string, number> = new Map()
  private readonly state: IndexState = {
    buildingPromise: undefined,
    cachedIndex: undefined,
  }

  constructor(fileSystem: IFileSystem, config: SearchKnowledgeServiceConfig = {}) {
    this.fileSystem = fileSystem
    this.baseDirectory = config.baseDirectory ?? process.cwd()
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  /**
   * Flush accumulated access hits to disk by updating frontmatter scoring.
   * Called during index rebuild to batch writes and avoid write amplification.
   * Best-effort: errors are swallowed per file.
   */
  async flushAccessHits(contextTreePath: string): Promise<void> {
    if (this.pendingAccessHits.size === 0) {
      return
    }

    const hits = new Map(this.pendingAccessHits)
    this.pendingAccessHits.clear()

    const tasks = [...hits.entries()].map(async ([relPath, count]) => {
      try {
        const fullPath = join(contextTreePath, relPath)
        const {content} = await this.fileSystem.readFile(fullPath)
        const scoring = parseFrontmatterScoring(content) ?? applyDefaultScoring()
        const updated = recordAccessHits(scoring, count)
        const newTier = determineTier(
          updated.importance ?? 50,
          (updated.maturity ?? 'draft') as 'core' | 'draft' | 'validated',
        )
        const finalScoring: FrontmatterScoring = {...updated, maturity: newTier}
        const newContent = updateScoringInContent(content, finalScoring)
        await this.fileSystem.writeFile(fullPath, newContent)
      } catch {
        // Best-effort — swallow per-file errors
      }
    })
    await Promise.allSettled(tasks)
  }

  /**
   * Search the knowledge base for relevant topics.
   * Supports symbolic path queries, scoped search, kind/maturity filtering, and overview mode.
   *
   * @param query - Natural language query string or symbolic path (e.g. "auth/jwt")
   * @param options - Search options including symbolic filters
   * @returns Search results with matching topics, enriched with symbolic metadata
   */
  async search(query: string, options?: SearchOptions): Promise<SearchKnowledgeResult> {
    const limit = options?.limit ?? 10
    const contextTreePath = join(this.baseDirectory, BRV_DIR, CONTEXT_TREE_DIR)

    // Acquire index with parallel-safe locking; flush pending access hits before any rebuild
    const indexResult = await acquireIndex(this.state, this.fileSystem, contextTreePath, this.cacheTtlMs, (ctxPath) =>
      this.flushAccessHits(ctxPath),
    )

    // Handle error case (context tree not initialized)
    if ('error' in indexResult) {
      return indexResult.result
    }

    const { documentMap, index, referenceIndex, symbolTree } = indexResult

    if (documentMap.size === 0) {
      return {
        message: 'Context tree is empty. Use /curate to add knowledge.',
        results: [],
        totalFound: 0,
      }
    }

    // Overview mode: return tree structure instead of search results
    if (options?.overview) {
      return this.buildOverviewResult(symbolTree, referenceIndex, options.scope, options.overviewDepth)
    }

    // Symbolic path resolution: try path-based query first
    if (isPathLikeQuery(query, symbolTree)) {
      const symbolicResult = this.trySymbolicSearch(
        query, symbolTree, referenceIndex, documentMap, index, limit, options,
      )

      if (symbolicResult) {
        return symbolicResult
      }
    }

    // Parse query for potential scope prefix (e.g. "auth jwt refresh" → scope=auth, text="jwt refresh")
    const parsed = parseSymbolicQuery(query, symbolTree)
    const effectiveScope = options?.scope ?? parsed.scopePath
    const effectiveQuery = parsed.scopePath ? parsed.textQuery : query

    // Run text-based MiniSearch (existing pipeline), optionally scoped to a subtree
    const textResult = this.runTextSearch(
      effectiveQuery || query, documentMap, index, limit, effectiveScope, symbolTree, referenceIndex, options,
    )

    // If scoped search returned nothing and we had a scope, fall back to global search
    if (textResult.results.length === 0 && effectiveScope && effectiveQuery) {
      return this.runTextSearch(query, documentMap, index, limit, undefined, symbolTree, referenceIndex, options)
    }

    return textResult
  }

  private accumulateAccessHits(paths: string[]): void {
    for (const path of paths) {
      this.pendingAccessHits.set(path, (this.pendingAccessHits.get(path) ?? 0) + 1)
    }
  }

  /**
   * Build overview result showing the tree structure at configurable depth.
   */
  private buildOverviewResult(
    symbolTree: MemorySymbolTree,
    referenceIndex: ReferenceIndex,
    scope?: string,
    depth?: number,
  ): SearchKnowledgeResult {
    const entries = getSymbolOverview(symbolTree, scope, depth ?? 2)

    const results: SearchKnowledgeResult['results'] = entries.map((entry) => ({
      backlinkCount: referenceIndex.backlinks.get(entry.path)?.length ?? 0,
      excerpt: `${entry.kind} | ${entry.childCount} children | maturity: ${entry.maturity}`,
      path: entry.path,
      score: entry.importance / 100,
      symbolKind: entry.kind,
      symbolPath: entry.path,
      title: entry.name,
    }))

    const domainCount = entries.filter((e) => e.kind === 'domain').length
    const topicCount = entries.filter((e) => e.kind === 'topic').length

    return {
      message: `Knowledge tree overview (${domainCount} domains, ${topicCount} topics).`,
      results,
      totalFound: entries.length,
    }
  }

  /**
   * Enrich a search result with symbolic metadata and backlink info.
   * For archive stubs, extracts points_to path into archiveFullPath.
   */
  private enrichResult(
    result: { excerpt: string; path: string; score: number; title: string },
    symbolTree: MemorySymbolTree,
    referenceIndex: ReferenceIndex,
    documentMap: Map<string, IndexedDocument>,
  ): SearchKnowledgeResult['results'][number] {
    const symbol = symbolTree.symbolMap.get(result.path)
    const backlinks = referenceIndex.backlinks.get(result.path)

    // Detect archive stubs and extract points_to for drill-down
    let archiveFullPath: string | undefined
    let symbolKind = symbol ? getSymbolKindLabel(symbol.kind) : undefined
    if (isArchiveStub(result.path)) {
      symbolKind = 'archive_stub'
      const doc = documentMap.get(result.path)
      if (doc) {
        const stubFm = parseArchiveStubFrontmatter(doc.content)
        if (stubFm) {
          archiveFullPath = stubFm.points_to
        }
      }
    }

    return {
      ...result,
      ...(archiveFullPath && { archiveFullPath }),
      backlinkCount: backlinks?.length ?? 0,
      relatedPaths: backlinks?.slice(0, 3),
      symbolKind,
      symbolPath: symbol?.path,
    }
  }

  /**
   * Run the standard text-based MiniSearch pipeline, optionally scoped to a subtree.
   */
  private runTextSearch(
    query: string,
    documentMap: Map<string, IndexedDocument>,
    index: MiniSearch<IndexedDocument>,
    limit: number,
    scopePath: string | undefined,
    symbolTree: MemorySymbolTree,
    referenceIndex: ReferenceIndex,
    options?: SearchOptions,
  ): SearchKnowledgeResult {
    const filteredQuery = filterStopWords(query)
    const filteredWords = filteredQuery.split(/\s+/).filter((w) => w.length >= 2)

    // Build scope filter if a subtree is specified
    let scopeFilter: ((result: { id: string }) => boolean) | undefined
    if (scopePath) {
      const subtreeIds = getSubtreeDocumentIds(symbolTree, scopePath)
      if (subtreeIds.size > 0) {
        scopeFilter = (result) => subtreeIds.has(result.id)
      }
    }

    // AND-first strategy: for multi-word queries, try AND for concentrated scores.
    // If AND returns no results, fall back to OR to ensure no regression.
    let rawResults: Array<{id: string; queryTerms: string[]; score: number}>
    let andSearchFailed = false
    const searchOpts = scopeFilter ? { filter: scopeFilter } : {}

    if (filteredWords.length >= 2) {
      rawResults = index.search(filteredQuery, { combineWith: 'AND', ...searchOpts })
      if (rawResults.length === 0) {
        andSearchFailed = true
        rawResults = index.search(filteredQuery, { combineWith: 'OR', ...searchOpts })
      }
    } else {
      rawResults = index.search(filteredQuery, { combineWith: 'OR', ...searchOpts })
    }

    // Normalize BM25 scores to [0, 1) then blend with importance + recency via compound scoring.
    // Decay is computed lazily from file mtime — no disk writes during search.
    const now = Date.now()
    const searchResults = rawResults.map((r) => {
      const doc = documentMap.get(r.id)
      const scoring = doc?.scoring ?? applyDefaultScoring()
      const daysSince = doc ? Math.max(0, (now - doc.mtime) / 86_400_000) : 0
      const decayed = applyDecay(scoring, daysSince)
      const bm25 = normalizeScore(r.score)

      return {
        ...r,
        score: compoundScore(bm25, decayed.importance ?? 50, decayed.recency ?? 1, decayed.maturity ?? 'draft'),
      }
    })
    searchResults.sort((a, b) => b.score - a.score)

    const results: SearchKnowledgeResult['results'] = []

    if (searchResults.length > 0) {
      // OOD detection: if the best result scores below the minimum floor,
      // the query has no meaningful match in the knowledge base.
      // Only apply for corpora with enough documents for reliable BM25 scoring.
      if (documentMap.size >= 50 && searchResults[0].score < MINIMUM_RELEVANCE_SCORE) {
        return {
          message: 'No matching knowledge found for this query. The topic may not be covered in the context tree.',
          results: [],
          totalFound: 0,
        }
      }

      // Term-based OOD: when AND search failed, check if significant query terms
      // are completely absent from the corpus. If unmatched terms exist and the
      // score is below the trusted threshold, the query is about an uncovered topic.
      if (
        andSearchFailed &&
        documentMap.size >= 50 &&
        searchResults[0].score < UNMATCHED_TERM_SCORE_THRESHOLD &&
        hasUnmatchedSignificantTerms(filteredWords, searchResults)
      ) {
        return {
          message: 'No matching knowledge found for this query. The topic may not be covered in the context tree.',
          results: [],
          totalFound: 0,
        }
      }

      const topScore = searchResults[0].score
      const scoreFloor = topScore * SCORE_GAP_RATIO
      const resultLimit = Math.min(limit, searchResults.length)

      for (let i = 0; i < resultLimit; i++) {
        const result = searchResults[i]

        // Score-gap filter: skip results too far below the top score
        if (result.score < scoreFloor) break

        const document = documentMap.get(result.id)

        if (document) {
          const enriched = this.enrichResult(
            {
              excerpt: extractExcerpt(document.content, query),
              path: document.path,
              score: Math.round(result.score * 100) / 100,
              title: document.title,
            },
            symbolTree, referenceIndex, documentMap,
          )

          // Apply kind/maturity filters if specified
          if (options?.includeKinds && enriched.symbolKind && !options.includeKinds.includes(enriched.symbolKind)) {
            continue
          }

          if (options?.excludeKinds && enriched.symbolKind && options.excludeKinds.includes(enriched.symbolKind)) {
            continue
          }

          if (options?.minMaturity && enriched.symbolKind) {
            const tierRank: Record<string, number> = { core: 3, draft: 1, validated: 2 }
            const symbol = symbolTree.symbolMap.get(document.path)
            const docMaturity = symbol?.metadata.maturity ?? 'draft'
            if ((tierRank[docMaturity] ?? 1) < (tierRank[options.minMaturity] ?? 1)) {
              continue
            }
          }

          results.push(enriched)
        }
      }
    }

    // Accumulate access hits for returned results (flushed during next index rebuild)
    // Disabled for benchmark: prevents feedback loop from distorting scores across queries
    // if (results.length > 0) {
    //   this.accumulateAccessHits(results.map((r) => r.path))
    // }

    return {
      message:
        results.length > 0
          ? `Found ${searchResults.length} result(s). Use read_file to view full content.`
          : 'No matching knowledge found. Try different search terms or check available topics with /query.',
      results,
      totalFound: searchResults.length,
    }
  }

  /**
   * Try to resolve the query as a symbolic path. Returns null if no path match found.
   */
  private trySymbolicSearch(
    query: string,
    symbolTree: MemorySymbolTree,
    referenceIndex: ReferenceIndex,
    documentMap: Map<string, IndexedDocument>,
    index: MiniSearch<IndexedDocument>,
    limit: number,
    options?: SearchOptions,
  ): null | SearchKnowledgeResult {
    const pathMatches = matchMemoryPath(symbolTree, query.split(/\s+/)[0].includes('/') ? query.split(/\s+/)[0] : query)

    if (pathMatches.length === 0) {
      return null
    }

    const topMatch = pathMatches[0].matchedSymbol

    // If the matched symbol is a leaf Context, return it directly
    if (topMatch.kind === MemorySymbolKind.Context) {
      const doc = documentMap.get(topMatch.path)
      if (!doc) {
        return null
      }

      const result = this.enrichResult(
        { excerpt: extractExcerpt(doc.content, query), path: doc.path, score: 1, title: doc.title },
        symbolTree, referenceIndex, documentMap,
      )

      this.accumulateAccessHits([doc.path])

      return {
        message: `Found exact match: ${topMatch.path}`,
        results: [result],
        totalFound: 1,
      }
    }

    // Matched a folder node (Domain/Topic/Subtopic) — check for remaining text query
    const queryParts = query.trim().split(/\s+/)
    const pathPart = queryParts[0].includes('/') ? queryParts[0] : topMatch.name
    const textPart = query.slice(query.indexOf(pathPart) + pathPart.length).trim()

    if (textPart) {
      // Scoped search: search text within the matched subtree
      return this.runTextSearch(textPart, documentMap, index, limit, topMatch.path, symbolTree, referenceIndex, options)
    }

    // No text part — return all children of the matched node
    const subtreeIds = getSubtreeDocumentIds(symbolTree, topMatch.path)
    const results: SearchKnowledgeResult['results'] = []

    for (const docId of subtreeIds) {
      if (results.length >= limit) break

      const doc = documentMap.get(docId)
      if (!doc) continue

      results.push(this.enrichResult(
        { excerpt: extractExcerpt(doc.content, query), path: doc.path, score: 0.9, title: doc.title },
        symbolTree, referenceIndex, documentMap,
      ))
    }

    if (results.length > 0) {
      this.accumulateAccessHits(results.map((r) => r.path))
    }

    return {
      message: `Found ${results.length} entries under ${topMatch.path}. Use read_file to view full content.`,
      results,
      totalFound: results.length,
    }
  }
}

/**
 * Factory function to create a SearchKnowledgeService instance.
 *
 * @param fileSystem - File system service
 * @param config - Optional configuration
 * @returns SearchKnowledgeService instance
 */
export function createSearchKnowledgeService(
  fileSystem: IFileSystem,
  config?: SearchKnowledgeServiceConfig,
): ISearchKnowledgeService {
  return new SearchKnowledgeService(fileSystem, config)
}
