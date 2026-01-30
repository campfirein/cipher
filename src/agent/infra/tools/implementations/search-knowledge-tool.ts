import MiniSearch from 'minisearch'
import {join} from 'node:path'
import {removeStopwords} from 'stopword'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR} from '../../../../server/constants.js'
import {ToolName} from '../../../core/domain/tools/constants.js'

const MAX_CONTEXT_TREE_FILES = 10_000
const CACHE_TTL_MS = 5000

const MINISEARCH_OPTIONS = {
  fields: ['title', 'content'] as string[],
  idField: 'id' as const,
  searchOptions: {
    boost: {title: 2},
    fuzzy: 0.2,
    prefix: true,
  },
  storeFields: ['title', 'path'] as string[],
}

const SearchKnowledgeInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe('Maximum number of results to return (default: 10)'),
    query: z.string().min(1).describe('Natural language query string to search for in the knowledge base'),
  })
  .strict()

interface IndexedDocument {
  content: string
  id: string
  mtime: number
  path: string
  title: string
}

interface SearchResult {
  excerpt: string
  path: string
  score: number
  title: string
}

interface CachedIndex {
  contextTreePath: string
  documentMap: Map<string, IndexedDocument>
  fileMtimes: Map<string, number>
  index: MiniSearch<IndexedDocument>
  lastValidatedAt: number
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

export interface SearchKnowledgeToolConfig {
  baseDirectory?: string
  cacheTtlMs?: number
}

function filterStopWords(query: string): string {
  const words = query.toLowerCase().split(/\s+/)
  const filtered = removeStopwords(words)
  return filtered.length > 0 ? filtered.join(' ') : query
}

function extractTitle(content: string, fallbackTitle: string): string {
  const match = /^# (.+)$/m.exec(content)
  return match ? match[1].trim() : fallbackTitle
}

function extractExcerpt(content: string, query: string, maxLength: number = 300): string {
  const relationsMatch = /^## Relations\n([\S\s]*?)(?=\n## |\n# |$)/m.exec(content)
  let cleanContent = content
  if (relationsMatch) {
    cleanContent = content.replace(relationsMatch[0], '').trim()
  }

  cleanContent = cleanContent.replace(/^# .+$/m, '').trim()

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)

  const lines = cleanContent.split('\n')
  let bestStartIndex = 0
  let bestScore = 0

  for (const [i, line] of lines.entries()) {
    const lineLower = line.toLowerCase()
    let score = 0
    for (const term of queryTerms) {
      if (lineLower.includes(term)) {
        score++
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestStartIndex = i
    }
  }

  let excerpt = ''
  for (const line of lines.slice(bestStartIndex)) {
    if (excerpt.length >= maxLength) break
    excerpt += line + '\n'
  }

  excerpt = excerpt.trim()
  if (excerpt.length > maxLength) {
    excerpt = excerpt.slice(0, maxLength).trim() + '...'
  } else if (bestStartIndex > 0 || excerpt.length < cleanContent.length) {
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
    }
  }

  const documentPromises = filesWithMtime.map(async ({mtime, path: filePath}) => {
    try {
      const fullPath = join(contextTreePath, filePath)
      const {content} = await fileSystem.readFile(fullPath)
      const title = extractTitle(content, filePath.replace(/\.md$/, '').split('/').pop() || filePath)

      return {
        content,
        id: filePath,
        mtime,
        path: filePath,
        title,
      }
    } catch {
      return null
    }
  })

  const results = await Promise.all(documentPromises)
  const documents = results.filter((doc): doc is IndexedDocument => doc !== null)

  const documentMap = new Map<string, IndexedDocument>()
  const fileMtimes = new Map<string, number>()
  for (const doc of documents) {
    documentMap.set(doc.id, doc)
    fileMtimes.set(doc.path, doc.mtime)
  }

  const index = new MiniSearch<IndexedDocument>(MINISEARCH_OPTIONS)
  index.addAll(documents)

  return {
    contextTreePath,
    documentMap,
    fileMtimes,
    index,
    lastValidatedAt: now,
  }
}

/**
 * Acquires the search index, using cached data when valid or building a fresh index.
 * Uses promise-based locking to prevent duplicate builds during parallel execution.
 *
 * @param state - Mutable state object for caching and locking
 * @param fileSystem - File system service
 * @param contextTreePath - Path to the context tree directory
 * @param ttlMs - Cache TTL in milliseconds
 * @returns The cached index or an error result
 */
async function acquireIndex(
  state: IndexState,
  fileSystem: IFileSystem,
  contextTreePath: string,
  ttlMs: number,
): Promise<CachedIndex | {error: true; result: {message: string; results: []; totalFound: 0}}> {
  const now = Date.now()

  // Fast path: TTL-based cache hit (no I/O needed)
  if (
    state.cachedIndex &&
    state.cachedIndex.contextTreePath === contextTreePath &&
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
        }
      }
    }

    const currentFiles = await findMarkdownFilesWithMtime(fileSystem, contextTreePath)

    // Re-check cache validity after getting file list (another call may have finished)
    if (
      state.cachedIndex &&
      state.cachedIndex.contextTreePath === contextTreePath &&
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

export function createSearchKnowledgeTool(fileSystem: IFileSystem, config: SearchKnowledgeToolConfig = {}): Tool {
  // Shared state for caching and locking across parallel executions
  const state: IndexState = {
    buildingPromise: undefined,
    cachedIndex: undefined,
  }

  return {
    description:
      'Search the curated knowledge base in .brv/context-tree/ for relevant topics. ' +
      'Use natural language queries to find knowledge about specific topics (e.g., "auth design", "API patterns"). ' +
      'Returns matching file paths, titles, and relevant excerpts.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {limit, query} = SearchKnowledgeInputSchema.parse(input)
      const baseDir = config.baseDirectory ?? process.cwd()
      const contextTreePath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
      const ttlMs = config.cacheTtlMs ?? CACHE_TTL_MS

      // Acquire index with parallel-safe locking
      const indexResult = await acquireIndex(state, fileSystem, contextTreePath, ttlMs)

      // Handle error case (context tree not initialized)
      if ('error' in indexResult) {
        return indexResult.result
      }

      const {documentMap, index} = indexResult

      if (documentMap.size === 0) {
        return {
          message: 'Context tree is empty. Use /curate to add knowledge.',
          results: [],
          totalFound: 0,
        }
      }

      const filteredQuery = filterStopWords(query)
      const searchResults = index.search(filteredQuery, {combineWith: 'OR'})

      const results: SearchResult[] = []
      const resultLimit = Math.min(limit, searchResults.length)

      for (let i = 0; i < resultLimit; i++) {
        const result = searchResults[i]
        const document = documentMap.get(result.id)

        if (document) {
          results.push({
            excerpt: extractExcerpt(document.content, query),
            path: document.path,
            score: Math.round(result.score * 100) / 100,
            title: document.title,
          })
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
    },
    id: ToolName.SEARCH_KNOWLEDGE,
    inputSchema: SearchKnowledgeInputSchema,
  }
}
