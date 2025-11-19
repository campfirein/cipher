import { join } from 'node:path'
import { z } from 'zod'

import type { Tool, ToolExecutionContext } from '../../../../core/domain/cipher/tools/types.js'

import { ToolName } from '../../../../core/domain/cipher/tools/constants.js'
import { DirectoryManager } from '../../../../core/domain/knowledge/directory-manager.js'

/**
 * Input schema for finding knowledge topics.
 * Supports pattern matching, scoping, depth control, and pagination.
 */
const FindKnowledgeTopicsInputSchema = z.object({
  basePath: z
    .string()
    .default('.brv/context-tree')
    .describe('Base path to context tree structure'),

  // Scoping
  domain: z
    .string()
    .optional()
    .describe('Restrict search to specific domain (exact match)'),
  // Search filters (substring matching)
  domainPattern: z
    .string()
    .optional()
    .describe('Domain name pattern for substring matching'),
  includeContent: z
    .boolean()
    .default(false)
    .describe('Include content preview from context.md files'),

  // Depth control
  includeSubtopics: z
    .boolean()
    .default(false)
    .describe('Include subtopic details in results'),

  // Pagination
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of results to return'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of results to skip'),

  subtopicPattern: z
    .string()
    .optional()
    .describe('Subtopic name pattern for substring matching'),
  topicPattern: z
    .string()
    .optional()
    .describe('Topic name pattern for substring matching'),
})

type FindKnowledgeTopicsInput = z.infer<typeof FindKnowledgeTopicsInputSchema>

/**
 * Output structure for find knowledge topics results.
 */
interface FindKnowledgeTopicsOutput {
  results: Array<{
    contentPreview?: string
    domain: string
    path: string
    subtopics?: Array<{
      contentPreview?: string
      name: string
      path: string
    }>
    topic: string
  }>
  total: number
}

type SubtopicEntry = {
  contentPreview?: string
  name: string
  path: string
}

/**
 * Read content preview from a file, truncating to 500 characters if needed.
 */
async function readContentPreview(filePath: string): Promise<string> {
  try {
    const content = await DirectoryManager.readFile(filePath)
    return content.length > 500 ? content.slice(0, 500) + '...' : content
  } catch {
    return '[Content unavailable]'
  }
}

/**
 * Process a single subtopic file and return its entry.
 */
async function processSubtopicFile(params: {
  domainName: string
  includeContent: boolean
  subtopicFile: string
  subtopicPattern: string | undefined
  topicName: string
  topicPath: string
}): Promise<null | SubtopicEntry> {
  const {domainName, includeContent, subtopicFile, subtopicPattern, topicName, topicPath} = params

  const subtopicRelativePath = subtopicFile.replace(topicPath, '').replace(/^\//, '')
  const subtopicParts = subtopicRelativePath.split('/')

  // Check if this is a subtopic context.md (not the topic's own context.md)
  if (subtopicParts.length <= 1 || subtopicParts.at(-1) !== 'context.md') {
    return null
  }

  const subtopicName = subtopicParts[0]

  // Apply subtopic pattern filter if specified
  if (subtopicPattern && !subtopicName.includes(subtopicPattern)) {
    return null
  }

  const subtopicEntry: SubtopicEntry = {
    name: subtopicName,
    path: `${domainName}/${topicName}/${subtopicName}`,
  }

  // Include subtopic content preview if requested
  if (includeContent) {
    subtopicEntry.contentPreview = await readContentPreview(subtopicFile)
  }

  return subtopicEntry
}

/**
 * Collect all subtopics for a given topic.
 */
async function collectSubtopics(params: {
  basePath: string
  domainName: string
  includeContent: boolean
  subtopicPattern: string | undefined
  topicName: string
}): Promise<SubtopicEntry[]> {
  const {basePath, domainName, includeContent, subtopicPattern, topicName} = params

  const topicPath = join(basePath, domainName, topicName)
  const subtopicFiles = await DirectoryManager.listMarkdownFiles(topicPath)
  const subtopics: SubtopicEntry[] = []

  for (const subtopicFile of subtopicFiles) {
    // eslint-disable-next-line no-await-in-loop
    const subtopicEntry = await processSubtopicFile({
      domainName,
      includeContent,
      subtopicFile,
      subtopicPattern,
      topicName,
      topicPath,
    })

    if (subtopicEntry) {
      subtopics.push(subtopicEntry)
    }
  }

  return subtopics
}

/**
 * Check if a topic matches the filter criteria.
 */
function matchesFilters(params: {
  domain: string | undefined
  domainName: string
  domainPattern: string | undefined
  topicName: string
  topicPattern: string | undefined
}): boolean {
  const {domain, domainName, domainPattern, topicName, topicPattern} = params

  // Apply domain scoping filter (exact match)
  if (domain && domainName !== domain) return false

  // Apply pattern filters (substring matching)
  if (domainPattern && !domainName.includes(domainPattern)) return false
  if (topicPattern && !topicName.includes(topicPattern)) return false

  return true
}

/**
 * Execute the find knowledge topics operation.
 * Searches the context tree structure and applies filters.
 *
 * @param input - Validated input parameters
 * @param _context - Tool execution context (unused)
 * @returns Structured results with total count and paginated data
 */
async function executeFindKnowledgeTopics(
  input: unknown,
  _context?: ToolExecutionContext,
): Promise<FindKnowledgeTopicsOutput> {
  const {
    basePath,
    domain,
    domainPattern,
    includeContent,
    includeSubtopics,
    limit,
    offset,
    subtopicPattern,
    topicPattern,
  } = input as FindKnowledgeTopicsInput

  const results: FindKnowledgeTopicsOutput['results'] = []
  const seenTopics = new Set<string>() // Track unique topic paths to avoid duplicates

  try {
    // List all markdown files in the context tree
    const mdFiles = await DirectoryManager.listMarkdownFiles(basePath)

    // Process each markdown file
    for (const filePath of mdFiles) {
      // Extract relative path from base
      const relativePath = filePath.replace(basePath, '').replace(/^\//, '')
      const parts = relativePath.split('/')

      // Context tree structure: domain/topic/context.md or domain/topic/subtopic/context.md
      if (parts.length < 2) continue // Need at least domain/file

      const [domainName, topicName, ...rest] = parts
      const isSubtopic = rest.length > 1 // Has subtopic folder

      // Skip if not a context.md file (only process context files)
      const fileName = parts.at(-1)
      if (fileName !== 'context.md') continue

      // Handle subtopic pattern filtering
      if (isSubtopic) {
        const subtopicName = rest[0]
        if (subtopicPattern && !subtopicName.includes(subtopicPattern)) continue

        // Skip subtopics for now - we'll collect them when processing their parent topic
        continue
      }

      // Apply filters
      if (
        !matchesFilters({
          domain,
          domainName,
          domainPattern,
          topicName,
          topicPattern,
        })
      ) {
        continue
      }

      // Create unique key for this topic to avoid duplicates
      const topicKey = `${domainName}/${topicName}`
      if (seenTopics.has(topicKey)) continue
      seenTopics.add(topicKey)

      // Build result entry for this topic
      const entry: FindKnowledgeTopicsOutput['results'][number] = {
        domain: domainName,
        path: `${domainName}/${topicName}`,
        topic: topicName,
      }

      // Include content preview if requested
      if (includeContent) {
        // eslint-disable-next-line no-await-in-loop
        entry.contentPreview = await readContentPreview(filePath)
      }

      // Include subtopics if requested
      if (includeSubtopics) {
        // eslint-disable-next-line no-await-in-loop
        const subtopics = await collectSubtopics({
          basePath,
          domainName,
          includeContent,
          subtopicPattern,
          topicName,
        })

        if (subtopics.length > 0) {
          entry.subtopics = subtopics
        }
      }

      results.push(entry)
    }

    // Apply pagination
    const total = results.length
    const effectiveOffset = offset ?? 0
    const paginatedResults = limit
      ? results.slice(effectiveOffset, effectiveOffset + limit)
      : results.slice(effectiveOffset)

    return {
      results: paginatedResults,
      total,
    }
  } catch {
    // If base path doesn't exist or other errors, return empty results
    return {
      results: [],
      total: 0,
    }
  }
}

/**
 * Factory function to create the find knowledge topics tool.
 *
 * @returns Configured Tool instance
 */
export function createFindKnowledgeTopicsTool(): Tool {
  return {
    description: `Search and filter knowledge topics in the context tree structure.

This tool helps discover what knowledge has been stored and navigate the domain/topic hierarchy. It works similarly to find_symbol but for knowledge organization.

**Use cases:**
- Discover what knowledge topics exist in a domain
- Find topics matching specific patterns
- Navigate the knowledge hierarchy
- Retrieve context for specific areas
- Check what has been documented

**Search capabilities:**
- Pattern matching on domain, topic, and subtopic names (substring matching)
- Scope searches to specific domains (exact match)
- Optional subtopic inclusion (depth control)
- Optional content preview (500 character limit)
- Pagination for large result sets

**Examples:**
- Find all topics in "testing" domain: {domain: "testing"}
- Find topics about "eslint": {topicPattern: "eslint"}
- Find subtopics with "config": {subtopicPattern: "config", includeSubtopics: true}
- Get content previews: {domain: "architecture", includeContent: true}
- Paginate results: {limit: 10, offset: 0}

**Returns:**
- total: Total number of matching topics
- results: Array of topic entries with domain, topic name, path, and optional subtopics/content`,

    execute: executeFindKnowledgeTopics,

    id: ToolName.FIND_KNOWLEDGE_TOPICS,
    inputSchema: FindKnowledgeTopicsInputSchema,
  }
}
