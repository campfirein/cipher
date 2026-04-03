import MiniSearch from 'minisearch'
import {realpath, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {removeStopwords} from 'stopword'

import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../sandbox/tools-sdk.js'

import {
  BRV_DIR,
  CONTEXT_FILE_EXTENSION,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DIR,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_PERFORMANCE_LOG_FILE,
  OVERVIEW_EXTENSION,
  SUMMARY_INDEX_FILE,
} from '../../../../server/constants.js'
import {
  type FrontmatterScoring,
  parseFrontmatterScoring,
  upsertScoringInContent,
} from '../../../../server/core/domain/knowledge/markdown-writer.js'
import {
  applyDecay,
  applyDefaultScoring,
  compoundScore,
  determineTier,
  recordAccessHits,
} from '../../../../server/core/domain/knowledge/memory-scoring.js'
import {
  computeDomainFactors,
  computePerformanceFactors,
  extractDomain,
  lookupParentFactor,
} from '../../../../server/core/domain/knowledge/performance-correlation.js'
import { isArchiveStub, isDerivedArtifact } from '../../../../server/infra/context-tree/derived-artifact.js'
import {ExperienceStore} from '../../../../server/infra/context-tree/experience-store.js'
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
const SCORE_GAP_RATIO = 0.7

/** Minimum normalized score for the top result. Below this, the query is considered out-of-domain */
const MINIMUM_RELEVANCE_SCORE = 0.45

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

/**
 * Propagate BM25 scores upward to parent domain/topic nodes.
 *
 * For each matched result, walks the parent chain and computes a decayed boost
 * (score * propagationFactor per level). New summary entries are added for
 * parent nodes that have a _index.md in summaryMap but are not already in results.
 *
 * @param results - Already-enriched search results (gap-ratio filtered)
 * @param symbolTree - Symbol tree for parent-chain traversal
 * @param summaryMap - Map of _index.md file paths → SummaryDocLike (for excerpt/metadata)
 * @param documentMap - Indexed documents for resolving context.md fallback summaries
 * @param propagationFactor - Score multiplier per level up (default 0.55)
 * @param perfFactors - Optional performance-correlation factors for parent summary boosts
 * @returns New parent entries only — caller merges and re-sorts
 */
function propagateScoresToParents(
  results: Array<{bm25Score: number; path: string}>,
  symbolTree: MemorySymbolTree,
  summaryMap: Map<string, SummaryDocLike>,
  documentMap: Map<string, IndexedDocument>,
  propagationFactor = 0.55,
  perfFactors?: {domainFactors: Map<string, number>; pathFactors: Map<string, number>},
): SearchKnowledgeResult['results'] {
  const boosts = new Map<string, number>()

  for (const r of results) {
    const symbol = symbolTree.symbolMap.get(r.path)
    let parent = symbol?.parent
    let factor = propagationFactor
    while (parent) {
      const cur = boosts.get(parent.path) ?? 0
      boosts.set(parent.path, Math.max(cur, r.bm25Score * factor))
      parent = parent.parent
      factor *= propagationFactor
    }
  }

  const existingPaths = new Set(results.map((r) => r.path))
  const boosted: SearchKnowledgeResult['results'] = []

  for (const [parentPath, score] of boosts.entries()) {
    if (existingPaths.has(parentPath)) continue
    const doc = getSummarySource(parentPath, summaryMap, documentMap)
    if (!doc) continue

    // Propagate the strongest child BM25 signal upward, then apply the parent
    // summary's own scoring exactly once. This avoids double-counting lifecycle
    // weights that are already baked into child compound scores.
    // Performance boost applied to parent importance (Ship 2).
    const parentImportance = doc.scoring?.importance ?? 50
    const parentPerfFactor = perfFactors
      ? lookupParentFactor(parentPath, perfFactors.pathFactors, perfFactors.domainFactors)
      : 0
    const boostedParentImportance = Math.min(100, parentImportance * (1 + parentPerfFactor))
    const finalScore = doc.scoring
      ? compoundScore(score, boostedParentImportance, doc.scoring.recency ?? 0.5, doc.scoring.maturity ?? 'draft')
      : score

    boosted.push({
      backlinkCount: 0,
      excerpt: doc.excerpt,
      path: parentPath,
      score: finalScore,
      symbolKind: 'summary',
      title: parentPath,
    })
  }

  return boosted
}

/** Numeric rank for maturity tiers — used for minMaturity filtering in both BM25 and propagated results. */
const MATURITY_TIER_RANK: Record<string, number> = {core: 3, draft: 1, validated: 2}

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
  /** Path to .overview.md sibling, if it exists at index-build time */
  overviewPath?: string
  path: string
  scoring: FrontmatterScoring
  title: string
}

interface SummarySource {
  excerpt: string
  path: string
  scoring?: SummaryDocLike['scoring']
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

function getSummaryAccessPath(
  path: string,
  summaryMap: Map<string, SummaryDocLike>,
  documentMap: Map<string, IndexedDocument>,
): string {
  return getSummarySource(path, summaryMap, documentMap)?.path ?? `${path}/${SUMMARY_INDEX_FILE}`
}

function getSummarySource(
  path: string,
  summaryMap: Map<string, SummaryDocLike>,
  documentMap: Map<string, IndexedDocument>,
): SummarySource | undefined {
  const summaryDoc = summaryMap.get(`${path}/${SUMMARY_INDEX_FILE}`)
  if (summaryDoc) {
    return {
      excerpt: summaryDoc.excerpt ?? '',
      path: summaryDoc.path,
      scoring: summaryDoc.scoring,
    }
  }

  const contextDoc = documentMap.get(`${path}/context.md`)
  if (contextDoc) {
    return {
      excerpt: extractExcerpt(contextDoc.content, contextDoc.title),
      path: contextDoc.path,
      scoring: contextDoc.scoring,
    }
  }

  return undefined
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

function stripMarkdownFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
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

  // Partition files: _index.md → summaryFiles, .overview.md → overviewFiles (for cache
  // invalidation + sibling detection), other derived artifacts → skip, rest → indexable
  const summaryFiles: Array<{mtime: number; path: string}> = []
  const overviewFiles: Array<{mtime: number; path: string}> = []
  const indexableFiles: Array<{mtime: number; path: string}> = []

  // Track all known paths for sibling detection (e.g. .overview.md presence check)
  const knownPaths = new Set(filesWithMtime.map((f) => f.path))

  for (const file of filesWithMtime) {
    const fileName = file.path.split('/').at(-1) ?? ''
    if (fileName === SUMMARY_INDEX_FILE) {
      summaryFiles.push(file)
    } else if (file.path.endsWith(OVERVIEW_EXTENSION)) {
      // Track mtimes so cache invalidates when a new .overview.md appears; not BM25-indexed
      overviewFiles.push(file)
    } else if (!isDerivedArtifact(file.path)) {
      // Includes regular .md files AND .stub.md files (stubs are searchable)
      indexableFiles.push(file)
    }
    // .full.md, .abstract.md, and _manifest.json are skipped (isDerivedArtifact returns true)
  }

  // Read indexable documents for BM25 index
  const documentPromises = indexableFiles.map(async ({mtime, path: filePath}) => {
    try {
      const fullPath = join(contextTreePath, filePath)
      const {content} = await fileSystem.readFile(fullPath)
      const title = extractTitle(content, filePath.replace(/\.md$/, '').split('/').pop() || filePath)
      const scoring = parseFrontmatterScoring(content) ?? applyDefaultScoring()

      // Check if a .overview.md sibling exists (written by abstract generation queue)
      const overviewRelPath = filePath.replace(/\.md$/, OVERVIEW_EXTENSION)
      const overviewPath = knownPaths.has(overviewRelPath) ? overviewRelPath : undefined

      return {
        content,
        id: filePath,
        mtime,
        ...(overviewPath !== undefined && { overviewPath }),
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

      // Persist frontmatter scoring so propagateScoresToParents can apply hotness/tier boosts
      const frontmatter = parseFrontmatterScoring(content)
      const scoring = frontmatter
        ? {importance: frontmatter.importance, maturity: frontmatter.maturity, recency: frontmatter.recency}
        : undefined

      return {
        condensationOrder: fm.condensation_order,
        excerpt: stripMarkdownFrontmatter(content).slice(0, 400),
        path: filePath,
        scoring,
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

  // Track .overview.md mtimes so the cache invalidates when a new overview is written
  for (const ov of overviewFiles) {
    fileMtimes.set(ov.path, ov.mtime)
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
  onBeforeBuild?: (contextTreePath: string) => Promise<boolean>,
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

    let allFiles = await findMarkdownFilesWithMtime(fileSystem, contextTreePath)
    // Exclude non-indexable derived artifacts (.full.md) so that currentFiles
    // matches what buildFreshIndex tracks in fileMtimes. Without this filter,
    // isCacheValid() sees a size mismatch once archives exist, causing cache thrash.
    // _index.md is kept (tracked for summary staleness), .stub.md is kept (BM25 indexed).
    // Keep _index.md (summary tracking) and .overview.md (sibling detection for overviewPath).
    // .full.md, .abstract.md, and _manifest.json remain excluded.
    let currentFiles = allFiles.filter(
      (f) =>
        !isDerivedArtifact(f.path) ||
        f.path.split('/').at(-1) === SUMMARY_INDEX_FILE ||
        f.path.endsWith(OVERVIEW_EXTENSION),
    )

    // Flush pending access hits before reusing a stale-enough cache entry.
    // The flush updates frontmatter on disk, so refresh mtimes before the cache-valid check.
    if (onBeforeBuild) {
      const wroteScoringUpdates = await onBeforeBuild(contextTreePath)
      if (wroteScoringUpdates) {
        allFiles = await findMarkdownFilesWithMtime(fileSystem, contextTreePath)
        currentFiles = allFiles.filter(
          (f) =>
            !isDerivedArtifact(f.path) ||
            f.path.split('/').at(-1) === SUMMARY_INDEX_FILE ||
            f.path.endsWith(OVERVIEW_EXTENSION),
        )
      }
    }

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
  private readonly experienceStore: ExperienceStore
  private readonly fileSystem: IFileSystem
  /** In-flight flush promise shared across concurrent callers so they all receive the same scoring map. */
  private flushingPromise: Promise<Map<string, FrontmatterScoring>> | undefined
  private readonly pendingAccessHits: Map<string, number> = new Map()
  /** Cached performance factors with mtime-based staleness */
  private perfFactorCache?: {domainFactors: Map<string, number>; mtime: number; pathFactors: Map<string, number>}
  private readonly state: IndexState = {
    buildingPromise: undefined,
    cachedIndex: undefined,
  }

  constructor(fileSystem: IFileSystem, config: SearchKnowledgeServiceConfig = {}) {
    this.fileSystem = fileSystem
    this.baseDirectory = config.baseDirectory ?? process.cwd()
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.experienceStore = new ExperienceStore(this.baseDirectory)
  }

  /**
   * Flush accumulated access hits to disk by updating frontmatter scoring.
   * Called at the start of every search() so hits persist even during stable-cache
   * steady state (not only when the index is rebuilt).
   *
   * If another flush is already in progress, returns the same in-flight Promise so
   * concurrent callers wait on the same I/O batch and all receive identical scoring
   * data to apply as an in-memory patch.  This prevents one concurrent search from
   * running ranking against pre-flush scoring while another has already flushed.
   *
   * Returns the updated FrontmatterScoring per relative path for every file that was
   * successfully flushed, so callers can patch the in-memory index without a rebuild.
   * Best-effort: per-file errors are swallowed.
   */
  async flushAccessHits(contextTreePath: string): Promise<Map<string, FrontmatterScoring>> {
    // If a flush is already in flight, join it — this call's hits will be included in
    // the next flush cycle once pendingAccessHits grows again.
    if (this.flushingPromise) {
      return this.flushingPromise
    }

    if (this.pendingAccessHits.size === 0) {
      return new Map()
    }

    const hits = new Map(this.pendingAccessHits)
    // Best-effort: access hits captured for this flush may be lost on I/O errors
    // because we drain the pending map before writes complete.
    this.pendingAccessHits.clear()

    // Store the promise SYNCHRONOUSLY before any await so concurrent calls can join it.
    this.flushingPromise = (async () => {
      const flushed = new Map<string, FrontmatterScoring>()
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
          const newContent = upsertScoringInContent(content, finalScoring)
          await this.fileSystem.writeFile(fullPath, newContent)
          flushed.set(relPath, finalScoring)
        } catch {
          // Best-effort — swallow per-file errors
        }
      })

      await Promise.allSettled(tasks)

      return flushed
    })()

    try {
      return await this.flushingPromise
    } finally {
      this.flushingPromise = undefined
    }
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
    const resolvedBaseDirectory = await realpath(this.baseDirectory).catch(() => this.baseDirectory)
    const contextTreePath = join(resolvedBaseDirectory, BRV_DIR, CONTEXT_TREE_DIR)

    // Flush accumulated access hits to disk before acquiring the index so that scoring
    // updates persist even when the cache stays valid (no rebuild triggered).
    const flushedScoring = await this.flushAccessHits(contextTreePath)

    // Acquire index with parallel-safe locking
    const indexResult = await acquireIndex(this.state, this.fileSystem, contextTreePath, this.cacheTtlMs)

    // Patch the in-memory documentMap and symbolTree with just-flushed scoring so that
    // the current search (and subsequent TTL-window searches) reflect up-to-date
    // importance and maturity — without waiting for the next full index rebuild.
    // Both surfaces must stay in sync: documentMap drives ranking, symbolTree drives
    // overview output and minMaturity filtering.
    // updatedAt is preserved from the existing scoring: access hits must not reset the
    // recency clock (only curation writes update that field).
    if (!('error' in indexResult) && flushedScoring.size > 0) {
      for (const [relPath, scoring] of flushedScoring) {
        const doc = indexResult.documentMap.get(relPath)
        if (doc) {
          doc.scoring = {
            ...scoring,
            updatedAt: scoring.updatedAt ?? doc.scoring?.updatedAt,
          }
        }

        const symbol = indexResult.symbolTree.symbolMap.get(relPath)
        if (symbol) {
          symbol.metadata = {
            ...symbol.metadata,
            importance: scoring.importance ?? symbol.metadata.importance,
            maturity: scoring.maturity ?? symbol.metadata.maturity,
          }
        }
      }
    }

    // Handle error case (context tree not initialized)
    if ('error' in indexResult) {
      return indexResult.result
    }

    const { documentMap, index, referenceIndex, summaryMap, symbolTree } = indexResult

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
      const symbolicResult = await this.trySymbolicSearch(
        query, symbolTree, referenceIndex, documentMap, index, limit, summaryMap, options,
      )

      if (symbolicResult) {
        return symbolicResult
      }
    }

    // Parse query for potential scope prefix (e.g. "auth jwt refresh" → scope=auth, text="jwt refresh")
    const parsed = parseSymbolicQuery(query, symbolTree)
    const effectiveScope = options?.scope ?? parsed.scopePath
    const effectiveQuery = parsed.scopePath ? parsed.textQuery : query

    // Load performance factors for retrieval boost (Ship 2)
    const perfFactors = await this.getPerformanceFactors()

    // Run text-based MiniSearch (existing pipeline), optionally scoped to a subtree
    const textResult = this.runTextSearch(
      effectiveQuery || query, documentMap, index, limit, effectiveScope, symbolTree, referenceIndex, summaryMap, options, perfFactors,
    )

    // If scoped search returned nothing and we had a scope, fall back to global search
    if (textResult.results.length === 0 && effectiveScope && effectiveQuery) {
      return this.runTextSearch(query, documentMap, index, limit, undefined, symbolTree, referenceIndex, summaryMap, options, perfFactors)
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

    const doc = documentMap.get(result.path)
    const overviewPath = doc?.overviewPath
    const isContextSummary = doc?.path.endsWith('/context.md') || doc?.path === 'context.md'
    const summaryPath = isContextSummary
      ? doc?.path.slice(0, -'/context.md'.length) || doc?.path || result.path
      : result.path

    return {
      ...result,
      ...(archiveFullPath && { archiveFullPath }),
      ...(overviewPath && { overviewPath }),
      backlinkCount: backlinks?.length ?? 0,
      ...(isContextSummary && {path: summaryPath}),
      relatedPaths: backlinks?.slice(0, 3),
      symbolKind: isContextSummary ? 'summary' : symbolKind,
      symbolPath: isContextSummary ? summaryPath : symbol?.path,
    }
  }

  /**
   * Get cached performance factors, recomputing only if the log file changed.
   * Uses file stat (mtime) to avoid reading the full JSONL on every search.
   * Returns empty maps when insufficient data (graceful degradation).
   */
  private async getPerformanceFactors(): Promise<{domainFactors: Map<string, number>; pathFactors: Map<string, number>}> {
    const empty = {domainFactors: new Map<string, number>(), pathFactors: new Map<string, number>()}

    try {
      const logPath = join(
        this.baseDirectory,
        BRV_DIR,
        CONTEXT_TREE_DIR,
        EXPERIENCE_DIR,
        EXPERIENCE_PERFORMANCE_DIR,
        EXPERIENCE_PERFORMANCE_LOG_FILE,
      )

      // Check file mtime without reading content — fast stat-only path
      let fileMtime: number
      try {
        const stats = await stat(logPath)
        fileMtime = stats.mtimeMs
      } catch {
        // File doesn't exist yet — no performance data
        return empty
      }

      // Return cached factors if log file hasn't changed
      if (this.perfFactorCache && this.perfFactorCache.mtime >= fileMtime) {
        return this.perfFactorCache
      }

      // File changed — read and recompute
      const log = await this.experienceStore.readPerformanceLog()

      const pathFactors = computePerformanceFactors(log)
      const domainFactors = computeDomainFactors(log)
      this.perfFactorCache = {domainFactors, mtime: fileMtime, pathFactors}

      return {domainFactors, pathFactors}
    } catch {
      return empty
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
    summaryMap: Map<string, SummaryDocLike>,
    options?: SearchOptions,
    perfFactors?: {domainFactors: Map<string, number>; pathFactors: Map<string, number>},
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
    // Decay uses frontmatter updatedAt (written only on curation, not on access-hit flushes)
    // so that access-hit file rewrites do not reset the recency clock.
    const now = Date.now()
    const searchResults = rawResults.map((r) => {
      const doc = documentMap.get(r.id)
      const scoring = doc?.scoring ?? applyDefaultScoring()
      // Prefer frontmatter updatedAt over file mtime: access-hit writes update mtime but
      // do NOT update updatedAt, so recency decays correctly for frequently-accessed files.
      const parsedUpdatedAtMs = scoring.updatedAt ? new Date(scoring.updatedAt).getTime() : Number.NaN
      const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : (doc?.mtime ?? now)
      const daysSince = Math.max(0, (now - updatedAtMs) / 86_400_000)
      const decayed = applyDecay(scoring, daysSince)
      const bm25 = normalizeScore(r.score)

      // Apply performance correlation boost (Ship 2)
      const baseImportance = decayed.importance ?? 50
      const perfFactor = perfFactors?.pathFactors.get(r.id) ?? perfFactors?.domainFactors.get(extractDomain(r.id)) ?? 0
      const boostedImportance = Math.min(100, baseImportance * (1 + perfFactor))

      return {
        ...r,
        bm25Score: bm25,
        score: compoundScore(bm25, boostedImportance, decayed.recency ?? 1, decayed.maturity ?? 'draft'),
      }
    })
    let topBm25 = 0
    for (const result of searchResults) {
      if (result.bm25Score > topBm25) topBm25 = result.bm25Score
    }

    searchResults.sort((a, b) => b.score - a.score)

    const results: SearchKnowledgeResult['results'] = []
    const propagationInputs: Array<{bm25Score: number; path: string}> = []

    let scoreFloor: number | undefined

    if (searchResults.length > 0) {
      // OOD detection: if the best lexical candidate's raw BM25 score is below
      // the minimum floor, the query has no meaningful lexical match in the knowledge base.
      // Uses bm25 (not compound score) so importance/recency bonuses don't mask irrelevance.
      // Only apply for corpora with enough documents for reliable BM25 scoring.
      if (documentMap.size >= 50 && topBm25 < MINIMUM_RELEVANCE_SCORE) {
        return {
          message: 'No matching knowledge found for this query. The topic may not be covered in the context tree.',
          results: [],
          totalFound: 0,
        }
      }

      // Term-based OOD: when AND search failed, check if significant query terms
      // are completely absent from the corpus. If unmatched terms exist and the
      // BM25 score is below the trusted threshold, the query is about an uncovered topic.
      // Uses bm25 (not compound score) to keep thresholds independent of scoring bonuses.
      if (
        andSearchFailed &&
        documentMap.size >= 50 &&
        topBm25 < UNMATCHED_TERM_SCORE_THRESHOLD &&
        hasUnmatchedSignificantTerms(filteredWords, searchResults)
      ) {
        return {
          message: 'No matching knowledge found for this query. The topic may not be covered in the context tree.',
          results: [],
          totalFound: 0,
        }
      }

      const topScore = searchResults[0].score
      scoreFloor = topScore * SCORE_GAP_RATIO
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
            const docMaturity = enriched.symbolKind === 'summary'
              ? getSummarySource(enriched.path, summaryMap, documentMap)?.scoring?.maturity
                ?? symbolTree.symbolMap.get(enriched.path)?.metadata.maturity
                ?? 'draft'
              : symbolTree.symbolMap.get(document.path)?.metadata.maturity ?? 'draft'
            if ((MATURITY_TIER_RANK[docMaturity] ?? 1) < (MATURITY_TIER_RANK[options.minMaturity] ?? 1)) {
              continue
            }
          }

          results.push(enriched)
          propagationInputs.push({
            bm25Score: result.bm25Score,
            path: enriched.path,
          })
        }
      }
    }

    // Propagate scores upward to parent domain/topic nodes (hierarchical retrieval)
    const propagated = propagateScoresToParents(propagationInputs, symbolTree, summaryMap, documentMap, 0.55, perfFactors)
    for (const p of propagated) {
      if (scoreFloor !== undefined && p.score < scoreFloor) continue
      if (options?.includeKinds && p.symbolKind && !options.includeKinds.includes(p.symbolKind)) continue
      if (options?.excludeKinds && p.symbolKind && options.excludeKinds.includes(p.symbolKind)) continue
      if (options?.minMaturity && p.symbolKind === 'summary') {
        const summaryDoc = getSummarySource(p.path, summaryMap, documentMap)
        const summaryMaturity = summaryDoc?.scoring?.maturity ?? 'draft'
        if ((MATURITY_TIER_RANK[summaryMaturity] ?? 1) < (MATURITY_TIER_RANK[options.minMaturity] ?? 1)) continue
      }

      results.push(p)
    }

    if (propagated.length > 0) {
      results.sort((a, b) => b.score - a.score)
      // Trim back to the caller-requested limit after propagated entries are merged in.
      if (results.length > limit) results.splice(limit)
    }

    // Accumulate access hits for returned results (flushed during next index rebuild).
    // Synthetic 'summary' results carry folder-style paths (e.g. 'auth') that are not
    // real files; map them to their _index.md so flushAccessHits can read and update them.
    if (results.length > 0) {
      const accessPaths = results.map((r) => (r.symbolKind === 'summary'
        ? getSummaryAccessPath(r.path, summaryMap, documentMap)
        : r.path))
      this.accumulateAccessHits(accessPaths)

      // Set canonical path on each result for downstream correlation tracking
      for (const [i, result] of results.entries()) {
        result.canonicalPath = accessPaths[i]
      }
    }

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
  private async trySymbolicSearch(
    query: string,
    symbolTree: MemorySymbolTree,
    referenceIndex: ReferenceIndex,
    documentMap: Map<string, IndexedDocument>,
    index: MiniSearch<IndexedDocument>,
    limit: number,
    summaryMap: Map<string, SummaryDocLike>,
    options?: SearchOptions,
  ): Promise<null | SearchKnowledgeResult> {
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
      result.canonicalPath = doc.path

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
      const perfFactors = await this.getPerformanceFactors()

      return this.runTextSearch(
        textPart,
        documentMap,
        index,
        limit,
        topMatch.path,
        symbolTree,
        referenceIndex,
        summaryMap,
        options,
        perfFactors,
      )
    }

    // No text part — return all children of the matched node
    const subtreeIds = getSubtreeDocumentIds(symbolTree, topMatch.path)
    const results: SearchKnowledgeResult['results'] = []
    const accessHitPaths: string[] = []
    const summaryDoc = getSummarySource(topMatch.path, summaryMap, documentMap)

    if (summaryDoc) {
      results.push({
        backlinkCount: 0,
        canonicalPath: summaryDoc.path,
        excerpt: summaryDoc.excerpt,
        path: topMatch.path,
        score: 1,
        symbolKind: 'summary',
        symbolPath: topMatch.path,
        title: topMatch.name,
      })
      accessHitPaths.push(summaryDoc.path)
    }

    for (const docId of subtreeIds) {
      if (results.length >= limit) break

      const doc = documentMap.get(docId)
      if (!doc) continue

      const enriched = this.enrichResult(
        { excerpt: extractExcerpt(doc.content, query), path: doc.path, score: 0.9, title: doc.title },
        symbolTree, referenceIndex, documentMap,
      )
      enriched.canonicalPath = doc.path
      results.push(enriched)
      accessHitPaths.push(doc.path)
    }

    if (accessHitPaths.length > 0) {
      this.accumulateAccessHits(accessHitPaths)
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
