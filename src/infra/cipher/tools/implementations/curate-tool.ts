import {join} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'
import {DirectoryManager} from '../../../../core/domain/knowledge/directory-manager.js'
import {MarkdownWriter} from '../../../../core/domain/knowledge/markdown-writer.js'
import {sanitizeFolderName} from '../../../../utils/file-helpers.js'

/**
 * Operation types for curating knowledge topics.
 * Inspired by ACE Curator patterns.
 */
const OperationType = z.enum(['ADD', 'UPDATE', 'MERGE', 'DELETE'])
type OperationType = z.infer<typeof OperationType>

/**
 * Content structure for ADD and UPDATE operations.
 */
const ContentSchema = z.object({
  relations: z
    .array(z.string())
    .optional()
    .describe('Related topics using @domain/topic or @domain/topic/subtopic notation'),
  snippets: z.array(z.string()).optional().describe('Code/text snippets'),
})

/**
 * Single operation schema for curating knowledge.
 */
const OperationSchema = z.object({
  content: ContentSchema.optional().describe('Content for ADD/UPDATE operations'),
  mergeTarget: z.string().optional().describe('Target path for MERGE operation'),
  path: z.string().describe('Path: domain/topic or domain/topic/subtopic'),
  reason: z.string().describe('Reasoning for this operation'),
  type: OperationType.describe('Operation type: ADD, UPDATE, MERGE, or DELETE'),
})

type Operation = z.infer<typeof OperationSchema>

/**
 * Input schema for curate tool.
 */
const CurateInputSchema = z.object({
  basePath: z.string().default('.brv/context-tree').describe('Base path for knowledge storage'),
  operations: z.array(OperationSchema).describe('Array of curate operations to apply'),
})

type CurateInput = z.infer<typeof CurateInputSchema>

/**
 * Result of a single operation.
 */
interface OperationResult {
  message?: string
  path: string
  status: 'failed' | 'success'
  type: OperationType
}

/**
 * Output type for curate tool.
 */
interface CurateOutput {
  applied: OperationResult[]
  summary: {
    added: number
    deleted: number
    failed: number
    merged: number
    updated: number
  }
}

/**
 * Parse a path into domain, topic, and optional subtopic.
 */
function parsePath(path: string): null | {domain: string; subtopic?: string; topic: string} {
  const parts = path.split('/')
  if (parts.length < 2 || parts.length > 3) {
    return null
  }

  return {
    domain: parts[0],
    subtopic: parts[2],
    topic: parts[1],
  }
}

/**
 * Build the full filesystem path from base path and knowledge path.
 */
function buildFullPath(basePath: string, knowledgePath: string): string {
  const parsed = parsePath(knowledgePath)
  if (!parsed) {
    throw new Error(`Invalid path format: ${knowledgePath}`)
  }

  const domainPath = join(basePath, sanitizeFolderName(parsed.domain))
  const topicPath = join(domainPath, sanitizeFolderName(parsed.topic))

  if (parsed.subtopic) {
    return join(topicPath, sanitizeFolderName(parsed.subtopic))
  }

  return topicPath
}

/**
 * Execute ADD operation - create new domain/topic/subtopic with context.md
 */
async function executeAdd(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {content, path, reason} = operation

  if (!content) {
    return {
      message: 'ADD operation requires content',
      path,
      status: 'failed',
      type: 'ADD',
    }
  }

  try {
    const parsed = parsePath(path)
    if (!parsed) {
      return {
        message: `Invalid path format: ${path}. Expected domain/topic or domain/topic/subtopic`,
        path,
        status: 'failed',
        type: 'ADD',
      }
    }

    // Ensure base structure exists
    await DirectoryManager.ensureKnowledgeStructure(basePath)

    // Create domain folder
    const domainPath = join(basePath, sanitizeFolderName(parsed.domain))
    await DirectoryManager.createOrUpdateDomain(domainPath)

    // Create topic folder
    const topicPath = join(domainPath, sanitizeFolderName(parsed.topic))
    await DirectoryManager.createOrUpdateTopic(topicPath)

    // Determine final path (topic or subtopic)
    let finalPath = topicPath
    if (parsed.subtopic) {
      finalPath = join(topicPath, sanitizeFolderName(parsed.subtopic))
      await DirectoryManager.createOrUpdateTopic(finalPath)
    }

    // Generate and write context.md
    const contextContent = MarkdownWriter.generateContext({
      name: parsed.subtopic || parsed.topic,
      relations: content.relations,
      snippets: content.snippets || [],
    })
    const contextPath = join(finalPath, 'context.md')
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)

    return {
      message: `Created ${path} with ${content.snippets?.length || 0} snippets. Reason: ${reason}`,
      path,
      status: 'success',
      type: 'ADD',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      path,
      status: 'failed',
      type: 'ADD',
    }
  }
}

/**
 * Execute UPDATE operation - modify existing context.md
 */
async function executeUpdate(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {content, path, reason} = operation

  if (!content) {
    return {
      message: 'UPDATE operation requires content',
      path,
      status: 'failed',
      type: 'UPDATE',
    }
  }

  try {
    const fullPath = buildFullPath(basePath, path)
    const contextPath = join(fullPath, 'context.md')

    // Check if topic exists
    const exists = await DirectoryManager.fileExists(contextPath)
    if (!exists) {
      return {
        message: `Topic does not exist: ${path}`,
        path,
        status: 'failed',
        type: 'UPDATE',
      }
    }

    // Generate and write updated context.md (full replacement)
    const parsed = parsePath(path)
    const contextContent = MarkdownWriter.generateContext({
      name: parsed?.subtopic || parsed?.topic || path,
      relations: content.relations,
      snippets: content.snippets || [],
    })
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)

    return {
      message: `Updated ${path}. Reason: ${reason}`,
      path,
      status: 'success',
      type: 'UPDATE',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      path,
      status: 'failed',
      type: 'UPDATE',
    }
  }
}

/**
 * Execute MERGE operation - combine source into target, delete source
 */
async function executeMerge(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {mergeTarget, path, reason} = operation

  if (!mergeTarget) {
    return {
      message: 'MERGE operation requires mergeTarget',
      path,
      status: 'failed',
      type: 'MERGE',
    }
  }

  try {
    const sourcePath = buildFullPath(basePath, path)
    const targetPath = buildFullPath(basePath, mergeTarget)
    const sourceContextPath = join(sourcePath, 'context.md')
    const targetContextPath = join(targetPath, 'context.md')

    // Check if both exist
    const sourceExists = await DirectoryManager.fileExists(sourceContextPath)
    const targetExists = await DirectoryManager.fileExists(targetContextPath)

    if (!sourceExists) {
      return {
        message: `Source topic does not exist: ${path}`,
        path,
        status: 'failed',
        type: 'MERGE',
      }
    }

    if (!targetExists) {
      return {
        message: `Target topic does not exist: ${mergeTarget}`,
        path,
        status: 'failed',
        type: 'MERGE',
      }
    }

    // Read both contexts
    const sourceContent = await DirectoryManager.readFile(sourceContextPath)
    const targetContent = await DirectoryManager.readFile(targetContextPath)

    // Merge the contexts using MarkdownWriter
    const mergedContent = MarkdownWriter.mergeContexts(sourceContent, targetContent)
    await DirectoryManager.writeFileAtomic(targetContextPath, mergedContent)

    // Delete source folder
    await DirectoryManager.deleteTopicRecursive(sourcePath)

    return {
      message: `Merged ${path} into ${mergeTarget}. Reason: ${reason}`,
      path,
      status: 'success',
      type: 'MERGE',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      path,
      status: 'failed',
      type: 'MERGE',
    }
  }
}

/**
 * Execute DELETE operation - remove topic/subtopic folder recursively
 */
async function executeDelete(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {path, reason} = operation

  try {
    const fullPath = buildFullPath(basePath, path)
    const contextPath = join(fullPath, 'context.md')

    // Check if topic exists
    const exists = await DirectoryManager.fileExists(contextPath)
    if (!exists) {
      return {
        message: `Topic does not exist: ${path}`,
        path,
        status: 'failed',
        type: 'DELETE',
      }
    }

    // Delete folder recursively
    await DirectoryManager.deleteTopicRecursive(fullPath)

    return {
      message: `Deleted ${path}. Reason: ${reason}`,
      path,
      status: 'success',
      type: 'DELETE',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      path,
      status: 'failed',
      type: 'DELETE',
    }
  }
}

/**
 * Execute curate operations on knowledge topics.
 */
async function executeCurate(
  input: unknown,
  _context?: ToolExecutionContext,
): Promise<CurateOutput> {
  const {basePath, operations} = input as CurateInput

  const applied: OperationResult[] = []
  const summary = {
    added: 0,
    deleted: 0,
    failed: 0,
    merged: 0,
    updated: 0,
  }

  // Process operations sequentially to maintain consistency
  /* eslint-disable no-await-in-loop -- Sequential processing required for dependent operations */
  for (const operation of operations) {
    let result: OperationResult

    switch (operation.type) {
      case 'ADD': {
        result = await executeAdd(basePath, operation)

        if (result.status === 'success') summary.added++

        break
      }

      case 'DELETE': {
        result = await executeDelete(basePath, operation)

        if (result.status === 'success') summary.deleted++

        break
      }

      case 'MERGE': {
        result = await executeMerge(basePath, operation)

        if (result.status === 'success') summary.merged++

        break
      }

      case 'UPDATE': {
        result = await executeUpdate(basePath, operation)

        if (result.status === 'success') summary.updated++

        break
      }

      default: {
        result = {
          message: `Unknown operation type: ${(operation as Operation).type}`,
          path: operation.path,
          status: 'failed',
          type: operation.type,
        }
      }
    }

    if (result.status === 'failed') {
      summary.failed++
    }

    applied.push(result)
  }
  /* eslint-enable no-await-in-loop */

  return {applied, summary}
}

/**
 * Creates the curate tool.
 *
 * This tool manages knowledge topics with atomic operations (ADD, UPDATE, MERGE, DELETE).
 * It applies patterns from the ACE Curator for intelligent knowledge curation.
 *
 * @returns Configured curate tool
 */
export function createCurateTool(): Tool {
  return {
    description: `Curate knowledge topics with atomic operations. This tool manages the knowledge structure using four operation types:

**Operations:**
1. **ADD** - Create new domain/topic/subtopic with context.md
   - Requires: path, content (snippets and/or relations), reason
   - Example: { type: "ADD", path: "code_style/error-handling", content: { snippets: ["..."], relations: ["logging/basics"] }, reason: "New pattern identified" }

2. **UPDATE** - Modify existing context.md (full replacement)
   - Requires: path, content, reason
   - Example: { type: "UPDATE", path: "code_style/error-handling", content: { snippets: ["Updated content"] }, reason: "Improved guidance" }

3. **MERGE** - Combine source topic into target, delete source
   - Requires: path (source), mergeTarget (destination), reason
   - Example: { type: "MERGE", path: "code_style/old-topic", mergeTarget: "code_style/new-topic", reason: "Consolidating duplicates" }

4. **DELETE** - Remove topic/subtopic folder recursively
   - Requires: path, reason
   - Example: { type: "DELETE", path: "code_style/deprecated-topic", reason: "No longer relevant" }

**Path format:** domain/topic or domain/topic/subtopic

**Output:** Returns applied operations with status (success/failed) and a summary of counts.`,

    execute: executeCurate,

    id: ToolName.CURATE,
    inputSchema: CurateInputSchema,
  }
}
