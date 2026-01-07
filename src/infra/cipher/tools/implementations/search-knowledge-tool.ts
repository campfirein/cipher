import {readdir, readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR} from '../../../../constants.js'
import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * MiniSearch type for the index instance.
 * We use a generic interface since the actual type varies between ESM/CJS.
 */
interface MiniSearchIndex<T> {
  addAll(documents: T[]): void
  search(query: string, options?: {combineWith?: 'AND' | 'OR'}): Array<{id: string; score: number}>
}

/**
 * MiniSearch constructor type.
 */
interface MiniSearchConstructor {
  new <T>(options: {
    fields: string[]
    idField: string
    searchOptions?: {
      boost?: Record<string, number>
      fuzzy?: boolean | number
      prefix?: boolean
    }
    storeFields?: string[]
  }): MiniSearchIndex<T>
}

/**
 * Dynamically import MiniSearch to handle ESM/CJS differences.
 */
async function getMiniSearch(): Promise<MiniSearchConstructor> {
  const module = await import('minisearch')
  // Handle both ESM and CJS exports
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MiniSearch = (module as any).default ?? module
  return MiniSearch as MiniSearchConstructor
}

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
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)

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
 * Recursively finds all markdown files in a directory.
 */
async function findMarkdownFiles(dir: string, basePath: string = ''): Promise<string[]> {
  try {
    const entries = await readdir(dir, {withFileTypes: true})

    // Filter to non-hidden entries
    const visibleEntries = entries.filter((entry) => !entry.name.startsWith('.'))

    // Process all entries concurrently
    const results = await Promise.all(
      visibleEntries.map(async (entry) => {
        const fullPath = join(dir, entry.name)
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          return findMarkdownFiles(fullPath, relativePath)
        }

        if (entry.name.endsWith(CONTEXT_FILE_EXTENSION)) {
          return [relativePath]
        }

        return []
      }),
    )

    return results.flat()
  } catch {
    // Directory doesn't exist or can't be read
    return []
  }
}

/**
 * Builds the search index from all markdown files in the context tree.
 */
async function buildIndex(contextTreePath: string): Promise<{documents: IndexedDocument[]; index: MiniSearchIndex<IndexedDocument>}> {
  const MiniSearch = await getMiniSearch()
  const files = await findMarkdownFiles(contextTreePath)

  // Read all files concurrently
  const documentPromises = files.map(async (filePath) => {
    try {
      const fullPath = join(contextTreePath, filePath)
      const content = await readFile(fullPath, 'utf8')
      const title = extractTitle(content, filePath.replace(/\.md$/, '').split('/').pop() || filePath)

      return {
        content,
        id: filePath,
        path: filePath,
        title,
      }
    } catch {
      // Skip files that can't be read
      return null
    }
  })

  const results = await Promise.all(documentPromises)
  const documents = results.filter((doc): doc is IndexedDocument => doc !== null)

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

  return {documents, index}
}

/**
 * Creates the search knowledge tool.
 *
 * Searches the curated knowledge base in `.brv/context-tree/` using
 * fuzzy/semantic search powered by MiniSearch. This allows agents to
 * find relevant topics without knowing exact file paths.
 *
 * @param config - Optional configuration
 * @returns Configured search knowledge tool
 */
export function createSearchKnowledgeTool(config: SearchKnowledgeToolConfig = {}): Tool {
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

      // Check if context tree exists
      try {
        await stat(contextTreePath)
      } catch {
        return {
          message: 'Context tree not initialized. Run /init to create it.',
          results: [],
          totalFound: 0,
        }
      }

      // Build the search index
      const {documents, index} = await buildIndex(contextTreePath)

      if (documents.length === 0) {
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

      // Format results
      const results: SearchResult[] = []
      const resultLimit = Math.min(limit, searchResults.length)

      for (let i = 0; i < resultLimit; i++) {
        const result = searchResults[i]
        const document = documents.find((d) => d.id === result.id)

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
