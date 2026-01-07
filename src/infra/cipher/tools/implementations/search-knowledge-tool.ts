import MiniSearch from 'minisearch'
import {join} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {IFileSystem} from '../../../../core/interfaces/cipher/i-file-system.js'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR} from '../../../../constants.js'
import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for search knowledge tool.
 */
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

/**
 * Represents an indexed document in the knowledge base.
 */
interface IndexedDocument {
  /** File content */
  content: string
  /** Unique document ID (file path) */
  id: string
  /** File modification time for cache invalidation */
  mtime: number
  /** Relative path from context-tree root */
  path: string
  /** Extracted title from first heading or filename */
  title: string
}

/**
 * Search result returned to the agent.
 */
interface SearchResult {
  /** Relevant content snippet from the file */
  excerpt: string
  /** Path to the file relative to context-tree */
  path: string
  /** Search relevance score (higher is better) */
  score: number
  /** Title of the knowledge topic */
  title: string
}

/**
 * Cached index data with modification tracking.
 */
interface CachedIndex {
  /** Context tree path this cache was built for */
  contextTreePath: string
  /** Map of document IDs to documents for O(1) lookup */
  documentMap: Map<string, IndexedDocument>
  /** Map of file paths to modification times for invalidation checking */
  fileMtimes: Map<string, number>
  /** MiniSearch index instance */
  index: MiniSearch<IndexedDocument>
}

/**
 * Configuration options for the tool.
 */
export interface SearchKnowledgeToolConfig {
  /** Base directory (defaults to process.cwd()) */
  baseDirectory?: string
}

/**
 * Extracts the title from markdown content.
 * Looks for the first level-1 heading (# Title).
 */
function extractTitle(content: string, fallbackTitle: string): string {
  const match = /^# (.+)$/m.exec(content)
  return match ? match[1].trim() : fallbackTitle
}

/**
 * Extracts a relevant excerpt around matched terms.
 * Returns the first ~300 characters that contain query-relevant content.
 */
function extractExcerpt(content: string, query: string, maxLength: number = 300): string {
  // Remove relations section if present
  const relationsMatch = /^## Relations\n([\S\s]*?)(?=\n## |\n# |$)/m.exec(content)
  let cleanContent = content
  if (relationsMatch) {
    cleanContent = content.replace(relationsMatch[0], '').trim()
  }

  // Remove the title heading for excerpt
  cleanContent = cleanContent.replace(/^# .+$/m, '').trim()

  // Try to find a section containing query terms
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)

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

  // Build excerpt starting from best matching line
  let excerpt = ''
  for (const line of lines.slice(bestStartIndex)) {
    if (excerpt.length >= maxLength) break
    excerpt += line + '\n'
  }

  // Trim and add ellipsis if truncated
  excerpt = excerpt.trim()
  if (excerpt.length > maxLength) {
    excerpt = excerpt.slice(0, maxLength).trim() + '...'
  } else if (bestStartIndex > 0 || excerpt.length < cleanContent.length) {
    excerpt += '...'
  }

  return excerpt || cleanContent.slice(0, maxLength) + (cleanContent.length > maxLength ? '...' : '')
}

/**
 * Finds all markdown files in a directory using IFileSystem.
 * Uses globFiles for file discovery and returns paths with modification times.
 */
async function findMarkdownFilesWithMtime(
  fileSystem: IFileSystem,
  contextTreePath: string,
): Promise<Array<{mtime: number; path: string}>> {
  try {
    const globResult = await fileSystem.globFiles(`**/*${CONTEXT_FILE_EXTENSION}`, {
      cwd: contextTreePath,
      includeMetadata: true, // Need metadata for mtime
      maxResults: 10_000,
      respectGitignore: false, // Context tree should not respect gitignore
    })

    // Return relative paths with modification times
    return globResult.files.map((f) => {
      // globFiles returns absolute paths, convert to relative
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
    // Silently return empty array when glob fails (e.g., directory doesn't exist).
    // This is intentional: the caller handles the empty case by showing "context tree empty" message.
    return []
  }
}

/**
 * Checks if the cached index is still valid by comparing file modification times.
 *
 * @param cache - The cached index
 * @param currentFiles - Current files with their modification times
 * @returns true if cache is valid, false if it needs to be rebuilt
 */
function isCacheValid(cache: CachedIndex, currentFiles: Array<{mtime: number; path: string}>): boolean {
  // Check if file count changed
  if (cache.fileMtimes.size !== currentFiles.length) {
    return false
  }

  // Check if any file was modified or new files were added
  for (const file of currentFiles) {
    const cachedMtime = cache.fileMtimes.get(file.path)
    if (cachedMtime === undefined || cachedMtime !== file.mtime) {
      return false
    }
  }

  return true
}

/**
 * Builds a fresh search index from all markdown files in the context tree.
 */
async function buildFreshIndex(
  fileSystem: IFileSystem,
  contextTreePath: string,
  filesWithMtime: Array<{mtime: number; path: string}>,
): Promise<CachedIndex> {
  // Early termination if no files found
  if (filesWithMtime.length === 0) {
    const index = new MiniSearch<IndexedDocument>({
      fields: ['title', 'content'],
      idField: 'id',
      searchOptions: {
        boost: {title: 2},
        fuzzy: 0.2,
        prefix: true,
      },
      storeFields: ['title', 'path'],
    })
    return {
      contextTreePath,
      documentMap: new Map(),
      fileMtimes: new Map(),
      index,
    }
  }

  // Read all files concurrently
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
      // Skip unreadable files (e.g., permission denied, encoding issues).
      // This is intentional: we prefer partial results over failing the entire search.
      // The file will be retried on next search if the issue is transient.
      return null
    }
  })

  const results = await Promise.all(documentPromises)
  const documents = results.filter((doc): doc is IndexedDocument => doc !== null)

  // Build maps for O(1) lookup and cache validation
  const documentMap = new Map<string, IndexedDocument>()
  const fileMtimes = new Map<string, number>()
  for (const doc of documents) {
    documentMap.set(doc.id, doc)
    fileMtimes.set(doc.path, doc.mtime)
  }

  // Create search index with fuzzy matching
  const index = new MiniSearch<IndexedDocument>({
    fields: ['title', 'content'],
    idField: 'id',
    searchOptions: {
      boost: {title: 2}, // Title matches are more important
      fuzzy: 0.2, // Allow some typo tolerance
      prefix: true, // Enable prefix matching
    },
    storeFields: ['title', 'path'],
  })

  // Add all documents to the index
  index.addAll(documents)

  return {
    contextTreePath,
    documentMap,
    fileMtimes,
    index,
  }
}

/**
 * Creates the search knowledge tool.
 *
 * Searches the curated knowledge base in `.brv/context-tree/` using
 * fuzzy/semantic search powered by MiniSearch. This allows agents to
 * find relevant topics without knowing exact file paths.
 *
 * Features:
 * - Fuzzy matching with typo tolerance
 * - Title boosting (title matches rank higher)
 * - Prefix matching for partial words
 * - Index caching with file modification time checking
 *
 * @param fileSystem - File system service for file operations
 * @param config - Optional configuration
 * @returns Configured search knowledge tool
 */
export function createSearchKnowledgeTool(fileSystem: IFileSystem, config: SearchKnowledgeToolConfig = {}): Tool {
  // In-memory cache for the search index
  // Persists across multiple tool invocations within the same session
  let cachedIndex: CachedIndex | null = null

  return {
    description:
      'Search the curated knowledge base in .brv/context-tree/ for relevant topics. ' +
      'Use natural language queries to find knowledge about specific topics (e.g., "auth design", "API patterns"). ' +
      'Returns matching file paths, titles, and relevant excerpts.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      // Parse input to apply defaults
      const parsed = SearchKnowledgeInputSchema.parse(input)
      const {limit, query} = parsed
      const baseDir = config.baseDirectory ?? process.cwd()
      const contextTreePath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

      // Check if context tree exists by attempting to list it
      try {
        await fileSystem.listDirectory(contextTreePath)
      } catch {
        return {
          message: 'Context tree not initialized. Run /init to create it.',
          results: [],
          totalFound: 0,
        }
      }

      // Get current files with modification times
      const currentFiles = await findMarkdownFilesWithMtime(fileSystem, contextTreePath)

      // Check if we can use the cached index
      let indexData: CachedIndex
      if (cachedIndex && cachedIndex.contextTreePath === contextTreePath && isCacheValid(cachedIndex, currentFiles)) {
        // Use cached index
        indexData = cachedIndex
      } else {
        // Build fresh index and cache it
        indexData = await buildFreshIndex(fileSystem, contextTreePath, currentFiles)
        cachedIndex = indexData
      }

      const {documentMap, index} = indexData

      if (documentMap.size === 0) {
        return {
          message: 'Context tree is empty. Use /curate to add knowledge.',
          results: [],
          totalFound: 0,
        }
      }

      // Perform the search
      const searchResults = index.search(query, {
        combineWith: 'OR',
      })

      // Format results using O(1) Map lookup
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
