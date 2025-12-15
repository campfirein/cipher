import { join } from 'node:path'
import { z } from 'zod'

import type { Tool, ToolExecutionContext } from '../../../../core/domain/cipher/tools/types.js'

import {BRV_DIR, CONTEXT_FILE, CONTEXT_TREE_DIR} from '../../../../constants.js'
import { ToolName } from '../../../../core/domain/cipher/tools/constants.js'
import { DirectoryManager } from '../../../../core/domain/knowledge/directory-manager.js'
import { parseRelations } from '../../../../core/domain/knowledge/relation-parser.js'

/**
 * Input schema for finding knowledge topics.
 * Supports pattern matching, scoping, depth control, and pagination.
 */
const FindKnowledgeTopicsInputSchema = z.object({
  basePath: z
    .string()
    .default(`${BRV_DIR}/${CONTEXT_TREE_DIR}`)
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

  // Relation traversal
  followRelations: z
    .boolean()
    .default(false)
    .describe('Automatically fetch related topics referenced in Relations section'),

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

  relationDepth: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe('How many levels deep to follow relations (default: 1, max: 3)'),

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
    relations?: string[]
    subtopics?: Array<{
      contentPreview?: string
      name: string
      path: string
      relations?: string[]
    }>
    topic: string
  }>
  total: number
}

type SubtopicEntry = {
  contentPreview?: string
  name: string
  path: string
  relations?: string[]
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
 * Read and parse relations from a context.md file.
 */
async function readRelations(filePath: string): Promise<string[]> {
  try {
    const content = await DirectoryManager.readFile(filePath)
    return parseRelations(content)
  } catch {
    return []
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
  if (subtopicParts.length <= 1 || subtopicParts.at(-1) !== CONTEXT_FILE) {
    return null
  }

  const subtopicName = subtopicParts[0]

  // Apply subtopic pattern filter if specified (case-insensitive)
  if (subtopicPattern && !subtopicName.toLowerCase().includes(subtopicPattern.toLowerCase())) {
    return null
  }

  const subtopicEntry: SubtopicEntry = {
    name: subtopicName,
    path: `${BRV_DIR}/${CONTEXT_TREE_DIR}/${domainName}/${topicName}/${subtopicName}/${CONTEXT_FILE}` // Full path
  }

  // Include subtopic content preview if requested
  if (includeContent) {
    subtopicEntry.contentPreview = await readContentPreview(subtopicFile)
  }

  // Always parse relations to enable relation traversal
  const relations = await readRelations(subtopicFile)
  if (relations.length > 0) {
    subtopicEntry.relations = relations
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

  // Normalize all strings to lowercase for case-insensitive matching
  const normalizedDomainName = domainName.toLowerCase()
  const normalizedTopicName = topicName.toLowerCase()

  // Apply domain scoping filter (exact match, case-insensitive)
  if (domain && normalizedDomainName !== domain.toLowerCase()) return false

  // Apply pattern filters (substring matching, case-insensitive)
  if (domainPattern && !normalizedDomainName.includes(domainPattern.toLowerCase())) return false
  if (topicPattern && !normalizedTopicName.includes(topicPattern.toLowerCase())) return false

  return true
}

/**
 * Collect relations from subtopics.
 */
function collectSubtopicRelations(subtopics: Array<{relations?: string[]}>): string[] {
  const relations: string[] = []

  for (const subtopic of subtopics) {
    if (subtopic.relations) {
      relations.push(...subtopic.relations)
    }
  }

  return relations
}

/**
 * Collect all relation paths from a set of results.
 */
function collectAllRelations(results: FindKnowledgeTopicsOutput['results']): Set<string> {
  const allRelations = new Set<string>()

  for (const result of results) {
    if (result.relations) {
      for (const rel of result.relations) allRelations.add(rel)
    }

    if (result.subtopics) {
      const subtopicRelations = collectSubtopicRelations(result.subtopics)
      for (const rel of subtopicRelations) allRelations.add(rel)
    }
  }

  return allRelations
}

/**
 * Fetch related topics by following relation references.
 * Recursively traverses relations up to the specified depth.
 */
async function fetchRelatedTopics(params: {
  basePath: string
  currentDepth: number
  includeContent: boolean
  maxDepth: number
  relationPaths: string[]
  seenPaths: Set<string>
}): Promise<FindKnowledgeTopicsOutput['results']> {
  const {basePath, currentDepth, includeContent, maxDepth, relationPaths, seenPaths} = params

  if (currentDepth > maxDepth || relationPaths.length === 0) {
    return []
  }

  const relatedTopics: FindKnowledgeTopicsOutput['results'] = []

  for (const relationPath of relationPaths) {
    // Avoid circular references
    if (seenPaths.has(relationPath)) continue
    seenPaths.add(relationPath)

    const parts = relationPath.split('/')
    if (parts.length < 2 || parts.length > 3) continue

    const [domainName, topicName] = parts
    const contextPath = join(basePath, ...parts, CONTEXT_FILE)

    try {
      // eslint-disable-next-line no-await-in-loop
      const fileExists = await DirectoryManager.fileExists(contextPath)
      if (!fileExists) continue

      const entry: FindKnowledgeTopicsOutput['results'][number] = {
        domain: domainName,
        path: `${basePath}/${relationPath}/${CONTEXT_FILE}`,
        topic: topicName,
      }

      // Include content preview if requested
      if (includeContent) {
        // eslint-disable-next-line no-await-in-loop
        entry.contentPreview = await readContentPreview(contextPath)
      }

      // Parse relations from this topic
      // eslint-disable-next-line no-await-in-loop
      const nestedRelations = await readRelations(contextPath)
      if (nestedRelations.length > 0) {
        entry.relations = nestedRelations

        // Recursively fetch nested relations if depth allows
        if (currentDepth < maxDepth) {
          // eslint-disable-next-line no-await-in-loop
          const nestedTopics = await fetchRelatedTopics({
            basePath,
            currentDepth: currentDepth + 1,
            includeContent,
            maxDepth,
            relationPaths: nestedRelations,
            seenPaths,
          })
          relatedTopics.push(...nestedTopics)
        }
      }

      relatedTopics.push(entry)
    } catch {
      // Skip missing or invalid relations
      continue
    }
  }

  return relatedTopics
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
    followRelations,
    includeContent,
    includeSubtopics,
    limit,
    offset,
    relationDepth,
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
      if (fileName !== CONTEXT_FILE) continue
      if (parts.length === 2) continue // Skip domain context.md files because they don't have much info

      
      // Handle subtopic pattern filtering (case-insensitive)
      if (isSubtopic) {
        const subtopicName = rest[0]
        if (subtopicPattern && !subtopicName.toLowerCase().includes(subtopicPattern.toLowerCase())) continue

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
        path: `${basePath}/${domainName}/${topicName}/${CONTEXT_FILE}`,
        topic: topicName,
      }

      // Include content preview if requested
      if (includeContent) {
        // eslint-disable-next-line no-await-in-loop
        entry.contentPreview = await readContentPreview(filePath)
      }

      // Always parse relations to enable relation traversal
      // eslint-disable-next-line no-await-in-loop
      const topicRelations = await readRelations(filePath)
      if (topicRelations.length > 0) {
        entry.relations = topicRelations
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

    // Follow relations if requested
    if (followRelations && paginatedResults.length > 0) {
      const maxDepth = Math.min(relationDepth ?? 1, 3) // Cap at 3 to prevent excessive traversal
      const allRelations = collectAllRelations(paginatedResults)

      // Fetch related topics recursively
      if (allRelations.size > 0) {
        const relatedTopics = await fetchRelatedTopics({
          basePath,
          currentDepth: 1,
          includeContent,
          maxDepth,
          relationPaths: [...allRelations],
          seenPaths: seenTopics, // Reuse seenTopics to avoid duplicates
        })

        // Append related topics to results
        paginatedResults.push(...relatedTopics)
      }
    }

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
    description: `Search and filter knowledge topics in the context tree structure with relation support.

This tool helps discover what knowledge has been stored and navigate the domain/topic hierarchy. It works similarly to find_symbol but for knowledge organization, with the ability to follow relations between topics.

**Use cases:**
- Discover what knowledge topics exist in a domain
- Find topics matching specific patterns
- Navigate the knowledge hierarchy via relations
- Retrieve context for specific areas
- Check what has been documented
- Follow related topics for comprehensive context

**Search capabilities:**
- Pattern matching on domain, topic, and subtopic names (substring matching)
- Scope searches to specific domains (exact match)
- Optional subtopic inclusion (depth control)
- Optional content preview (500 character limit)
- Pagination for large result sets
- Relation traversal (automatically fetch related topics up to 3 levels deep)

**Examples:**
- Find all topics in "testing" domain: {domain: "testing"}
- Find topics about "eslint": {topicPattern: "eslint"}
- Find subtopics with "config": {subtopicPattern: "config", includeSubtopics: true}
- Get content previews: {domain: "architecture", includeContent: true}
- Follow relations: {topicPattern: "auth", followRelations: true, relationDepth: 2}
- Paginate results: {limit: 10, offset: 0}

**Returns:**
- total: Total number of matching topics (before relation traversal)
- results: Array of topic entries with domain, topic name, optional relations, subtopics, and content with complete paths`,
    execute: executeFindKnowledgeTopics,

    id: ToolName.FIND_KNOWLEDGE_TOPICS,
    inputSchema: FindKnowledgeTopicsInputSchema,
  }
}
