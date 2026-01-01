import * as fs from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'
import {DirectoryManager} from '../../../../core/domain/knowledge/directory-manager.js'
import {MarkdownWriter} from '../../../../core/domain/knowledge/markdown-writer.js'
import {toSnakeCase} from '../../../../utils/file-helpers.js'

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
  mergeTargetTitle: z.string().optional().describe('Title of the target file for MERGE operation'),
  path: z.string().describe('Path: domain/topic or domain/topic/subtopic'),
  reason: z.string().describe('Reasoning for this operation'),
  title: z.string().optional().describe('Title for the context file (saved as {title}.md in snake_case). Required for ADD/UPDATE/MERGE, optional for DELETE'),
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
  /** Full filesystem path to the created/modified file (for ADD/UPDATE/MERGE) */
  filePath?: string
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
 * Get existing domain names from the context tree.
 * Returns domain folder names that exist in the context tree.
 */
async function getExistingDomains(basePath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(basePath, {withFileTypes: true})
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    // Directory doesn't exist yet
    return []
  }
}

/**
 * Validate domain name format.
 * Dynamic domains are allowed - no predefined list or limits.
 * The agent is responsible for creating semantically meaningful domains.
 */
async function validateDomain(
  basePath: string,
  domainName: string,
): Promise<{allowed: boolean; existingDomains: string[]; reason?: string}> {
  const normalizedDomain = toSnakeCase(domainName)
  const existingDomains = await getExistingDomains(basePath)

  // Validate domain name format (must be non-empty and valid for filesystem)
  if (!normalizedDomain || normalizedDomain.length === 0) {
    return {
      allowed: false,
      existingDomains,
      reason: 'Domain name cannot be empty.',
    }
  }

  // Check for invalid characters in domain name
  if (!/^[\w-]+$/.test(normalizedDomain)) {
    return {
      allowed: false,
      existingDomains,
      reason: `Domain name "${normalizedDomain}" contains invalid characters. Use only letters, numbers, underscores, and hyphens.`,
    }
  }

  // All valid domain names are allowed - dynamic domain creation enabled
  return {allowed: true, existingDomains}
}

/**
 * Build the full filesystem path from base path and knowledge path.
 * Returns the folder path (not including filename).
 */
function buildFullPath(basePath: string, knowledgePath: string): string {
  const parsed = parsePath(knowledgePath)
  if (!parsed) {
    throw new Error(`Invalid path format: ${knowledgePath}`)
  }

  const domainPath = join(basePath, toSnakeCase(parsed.domain))
  const topicPath = join(domainPath, toSnakeCase(parsed.topic))

  if (parsed.subtopic) {
    return join(topicPath, toSnakeCase(parsed.subtopic))
  }

  return topicPath
}

/**
 * Execute ADD operation - create new domain/topic/subtopic with {title}.md
 */
async function executeAdd(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {content, path, reason, title} = operation

  if (!title) {
    return {
      message: 'ADD operation requires a title',
      path,
      status: 'failed',
      type: 'ADD',
    }
  }

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

    // Validate domain before creating
    const domainValidation = await validateDomain(basePath, parsed.domain)
    if (!domainValidation.allowed) {
      return {
        message: domainValidation.reason,
        path,
        status: 'failed',
        type: 'ADD',
      }
    }

    // Build the final folder path (topic or subtopic)
    const domainPath = join(basePath, toSnakeCase(parsed.domain))
    const topicPath = join(domainPath, toSnakeCase(parsed.topic))
    const finalPath = parsed.subtopic ? join(topicPath, toSnakeCase(parsed.subtopic)) : topicPath

    // Generate and write {title}.md (snake_case filename)
    // Note: writeFileAtomic creates parent directories as needed, avoiding empty folder creation
    const contextContent = MarkdownWriter.generateContext({
      name: title,
      relations: content.relations,
      snippets: content.snippets || [],
    })
    const filename = `${toSnakeCase(title)}.md`
    const contextPath = join(finalPath, filename)
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)

    return {
      filePath: contextPath,
      message: `Created ${path}/${filename} with ${content.snippets?.length || 0} snippets. Reason: ${reason}`,
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
 * Execute UPDATE operation - modify existing {title}.md
 */
async function executeUpdate(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {content, path, reason, title} = operation

  if (!title) {
    return {
      message: 'UPDATE operation requires a title',
      path,
      status: 'failed',
      type: 'UPDATE',
    }
  }

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
    const filename = `${toSnakeCase(title)}.md`
    const contextPath = join(fullPath, filename)

    // Check if the specific titled file exists
    const exists = await DirectoryManager.fileExists(contextPath)
    if (!exists) {
      return {
        message: `File does not exist: ${path}/${filename}`,
        path,
        status: 'failed',
        type: 'UPDATE',
      }
    }

    // Generate and write updated content (full replacement)
    const contextContent = MarkdownWriter.generateContext({
      name: title,
      relations: content.relations,
      snippets: content.snippets || [],
    })
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)

    return {
      filePath: contextPath,
      message: `Updated ${path}/${filename}. Reason: ${reason}`,
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
 * Execute MERGE operation - combine source file into target file, delete source file
 */
async function executeMerge(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {mergeTarget, mergeTargetTitle, path, reason, title} = operation

  if (!title) {
    return {
      message: 'MERGE operation requires a title (source file)',
      path,
      status: 'failed',
      type: 'MERGE',
    }
  }

  if (!mergeTarget) {
    return {
      message: 'MERGE operation requires mergeTarget',
      path,
      status: 'failed',
      type: 'MERGE',
    }
  }

  if (!mergeTargetTitle) {
    return {
      message: 'MERGE operation requires mergeTargetTitle',
      path,
      status: 'failed',
      type: 'MERGE',
    }
  }

  try {
    const sourceFolderPath = buildFullPath(basePath, path)
    const targetFolderPath = buildFullPath(basePath, mergeTarget)

    const sourceFilename = `${toSnakeCase(title)}.md`
    const targetFilename = `${toSnakeCase(mergeTargetTitle)}.md`

    const sourceContextPath = join(sourceFolderPath, sourceFilename)
    const targetContextPath = join(targetFolderPath, targetFilename)

    // Check if both files exist
    const sourceExists = await DirectoryManager.fileExists(sourceContextPath)
    const targetExists = await DirectoryManager.fileExists(targetContextPath)

    if (!sourceExists) {
      return {
        message: `Source file does not exist: ${path}/${sourceFilename}`,
        path,
        status: 'failed',
        type: 'MERGE',
      }
    }

    if (!targetExists) {
      return {
        message: `Target file does not exist: ${mergeTarget}/${targetFilename}`,
        path,
        status: 'failed',
        type: 'MERGE',
      }
    }

    // Read both files
    const sourceContent = await DirectoryManager.readFile(sourceContextPath)
    const targetContent = await DirectoryManager.readFile(targetContextPath)

    // Merge the contents using MarkdownWriter
    const mergedContent = MarkdownWriter.mergeContexts(sourceContent, targetContent)
    await DirectoryManager.writeFileAtomic(targetContextPath, mergedContent)

    // Delete source file (not the entire folder, just the file)
    await DirectoryManager.deleteFile(sourceContextPath)

    return {
      filePath: targetContextPath,
      message: `Merged ${path}/${sourceFilename} into ${mergeTarget}/${targetFilename}. Reason: ${reason}`,
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
 * Execute DELETE operation - remove specific file or entire folder
 * If title is provided, deletes specific file; if omitted, deletes entire folder
 */
async function executeDelete(
  basePath: string,
  operation: Operation,
): Promise<OperationResult> {
  const {path, reason, title} = operation

  try {
    const fullPath = buildFullPath(basePath, path)

    if (title) {
      // Delete specific file
      const filename = `${toSnakeCase(title)}.md`
      const filePath = join(fullPath, filename)

      const exists = await DirectoryManager.fileExists(filePath)
      if (!exists) {
        return {
          message: `File does not exist: ${path}/${filename}`,
          path,
          status: 'failed',
          type: 'DELETE',
        }
      }

      await DirectoryManager.deleteFile(filePath)

      return {
        message: `Deleted ${path}/${filename}. Reason: ${reason}`,
        path,
        status: 'success',
        type: 'DELETE',
      }
    }

    // Delete entire folder (when no title provided)
    const exists = await DirectoryManager.folderExists(fullPath)
    if (!exists) {
      return {
        message: `Folder does not exist: ${path}`,
        path,
        status: 'failed',
        type: 'DELETE',
      }
    }

    await DirectoryManager.deleteTopicRecursive(fullPath)

    return {
      message: `Deleted folder ${path}. Reason: ${reason}`,
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
1. **ADD** - Create new titled context file in domain/topic/subtopic
   - Requires: path, title, content (snippets and/or relations), reason
   - Example: { type: "ADD", path: "code_style/error_handling", title: "Best Practices", content: { snippets: ["..."], relations: ["logging/basics"] }, reason: "New pattern" }
   - Creates: code_style/error_handling/best_practices.md

2. **UPDATE** - Modify existing titled context file (full replacement)
   - Requires: path, title, content, reason
   - Example: { type: "UPDATE", path: "code_style/error_handling", title: "Best Practices", content: { snippets: ["Updated"] }, reason: "Improved" }

3. **MERGE** - Combine source file into target file, delete source
   - Requires: path (source), title (source file), mergeTarget (destination path), mergeTargetTitle (destination file), reason
   - Example: { type: "MERGE", path: "code_style/old_topic", title: "Old Guide", mergeTarget: "code_style/new_topic", mergeTargetTitle: "New Guide", reason: "Consolidating" }

4. **DELETE** - Remove specific file or entire folder
   - Requires: path, title (optional), reason
   - With title: deletes specific file; without title: deletes entire folder
   - Example (file): { type: "DELETE", path: "code_style/deprecated", title: "Old Guide", reason: "No longer relevant" }
   - Example (folder): { type: "DELETE", path: "code_style/deprecated", title: "", reason: "Removing topic" }

**Path format:** domain/topic or domain/topic/subtopic (uses snake_case automatically)
**File naming:** Titles are converted to snake_case (e.g., "Best Practices" -> "best_practices.md")

**Dynamic Domain Creation:**
- Domains are created dynamically based on the context being curated
- Choose domain names that are semantically meaningful and descriptive
- Domain names should be concise (1-3 words), use snake_case format
- Examples of good domain names: authentication, api_design, data_models, error_handling, ui_components
- Before creating a new domain, check if existing domains could be reused
- Group related topics under the same domain for better organization

**Domain Naming Guidelines:**
- Use noun-based names that describe the category (e.g., "authentication" not "how_to_authenticate")
- Avoid overly generic names (e.g., "misc", "other", "general")
- Avoid overly specific names that only fit one topic
- Keep domain count reasonable by consolidating related concepts

**Output:** Returns applied operations with status (success/failed), filePath (for created/modified files), and a summary of counts.`,

    execute: executeCurate,

    id: ToolName.CURATE,
    inputSchema: CurateInputSchema,
  }
}
