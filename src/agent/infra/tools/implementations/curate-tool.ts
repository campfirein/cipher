import type {Dirent} from 'node:fs'

import {readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'

import {ToolName} from '../../../core/domain/tools/constants.js'
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
 * Raw Concept schema for structured metadata and technical footprint.
 */
const RawConceptSchema = z.object({
  changes: z.array(z.string()).optional().describe('What changes in the codebase are induced by this concept'),
  files: z.array(z.string()).optional().describe('Which files are related to this concept'),
  flow: z.string().optional().describe('What is the flow included in this concept'),
  task: z.string().optional().describe('What is the task related to this concept'),
  timestamp: z
    .string()
    .optional()
    .describe('When the concept was created or modified (ISO 8601 format, e.g., 2025-03-18)'),
})

/**
 * Narrative schema for descriptive and structural context.
 */
const NarrativeSchema = z.object({
  dependencies: z
    .string()
    .optional()
    .describe(
      'Dependency management information (e.g., "Singleton, init when service starts, hard dependency in smoke test")',
    ),
  features: z
    .string()
    .optional()
    .describe(
      'Feature documentation for this concept (e.g., "User permission can be stale for up to 300 seconds due to Redis cache")',
    ),
  structure: z.string().optional().describe('Code structure documentation (e.g., "clients/redis_client.go")'),
})

/**
 * Content structure for ADD and UPDATE operations.
 */
const ContentSchema = z.object({
  narrative: NarrativeSchema.optional().describe('Narrative section with descriptive and structural context'),
  rawConcept: RawConceptSchema.optional().describe('Raw concept section with metadata and technical footprint'),
  relations: z
    .array(z.string())
    .optional()
    .describe('Related topics using domain/topic/title.md or domain/topic/subtopic/title.md notation'),
  snippets: z.array(z.string()).optional().describe('Code/text snippets'),
})

/**
 * Domain context schema for domain-level context.md files.
 * Provides metadata about a domain's purpose, scope, ownership, and usage.
 */
const DomainContextSchema = z.object({
  ownership: z
    .string()
    .optional()
    .describe('Which system, team, or layer owns this domain (e.g., "Platform Security Team")'),
  purpose: z
    .string()
    .describe(
      'Describe what this domain represents and why it exists (e.g., "Contains all knowledge related to user and service authentication mechanisms")',
    ),
  scope: z.object({
    excluded: z
      .array(z.string())
      .optional()
      .describe('What does NOT belong in this domain (e.g., ["Authorization and permission models", "User profile management"])'),
    included: z
      .array(z.string())
      .describe('What belongs in this domain (e.g., ["Login and signup flows", "Token-based authentication", "OAuth integrations"])'),
  }).describe('Define what belongs and does not belong in this domain'),
  usage: z
    .string()
    .optional()
    .describe('How this domain should be used by agents and contributors'),
})

const TopicContextSchema = z.object({
  keyConcepts: z
    .array(z.string())
    .optional()
    .describe('Key concepts covered in this topic (e.g., ["JWT tokens", "Refresh token rotation", "Token blacklisting"])'),
  overview: z
    .string()
    .describe(
      'Describe what this topic covers and its main focus (e.g., "Covers all aspects of JWT-based authentication including token generation, validation, and refresh mechanisms")',
    ),
  relatedTopics: z
    .array(z.string())
    .optional()
    .describe('Related topics and how they connect (e.g., ["authentication/session - for session-based alternatives", "security/encryption - for token signing"])'),
})

const SubtopicContextSchema = z.object({
  focus: z
    .string()
    .describe(
      'Describe the specific focus of this subtopic (e.g., "Focuses on refresh token rotation strategy and invalidation mechanisms")',
    ),
  parentRelation: z
    .string()
    .optional()
    .describe('How this subtopic relates to its parent topic (e.g., "Handles the token refresh aspect of JWT authentication")'),
})

/**
 * Single operation schema for curating knowledge.
 */
const OperationSchema = z.object({
  content: ContentSchema.optional().describe('Content for ADD/UPDATE operations'),
  domainContext: DomainContextSchema.optional().describe(
    'Domain-level context for new domains. When creating content in a NEW domain, provide this to auto-generate domain/context.md with purpose, scope, ownership, and usage. Only needed when the domain does not exist yet.',
  ),
  mergeTarget: z.string().optional().describe('Target path for MERGE operation'),
  mergeTargetTitle: z.string().optional().describe('Title of the target file for MERGE operation'),
  path: z.string().describe('Path: domain/topic/title.md or domain/topic/subtopic/title.md'),
  reason: z.string().describe('Reasoning for this operation'),
  subtopicContext: SubtopicContextSchema.optional().describe(
    'Subtopic-level context for new subtopics. When creating content in a NEW subtopic, provide this to auto-generate subtopic/context.md with focus and parent relation. Only needed when the subtopic does not exist yet.',
  ),
  title: z
    .string()
    .optional()
    .describe(
      'Title for the context file (saved as {title}.md in snake_case). Required for ADD/UPDATE/MERGE, optional for DELETE',
    ),
  topicContext: TopicContextSchema.optional().describe(
    'Topic-level context for new topics. When creating content in a NEW topic, provide this to auto-generate topic/context.md with overview, key concepts, and related topics. Only needed when the topic does not exist yet.',
  ),
  type: OperationType.describe('Operation type: ADD, UPDATE, MERGE, or DELETE'),
})

type Operation = z.infer<typeof OperationSchema>
type DomainContext = z.infer<typeof DomainContextSchema>
type TopicContext = z.infer<typeof TopicContextSchema>
type SubtopicContext = z.infer<typeof SubtopicContextSchema>

/**
 * Input schema for curate tool.
 */
const CurateInputSchema = z.object({
  basePath: z.string().default('.brv/context-tree').describe('Base path for knowledge storage'),
  operations: z.array(OperationSchema).describe('Array of curate operations to apply'),
})

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

function generateDomainContextMarkdown(domainName: string, context: DomainContext): string {
  const sections: string[] = [
    `# Domain: ${domainName}`,
    '',
    '## Purpose',
    context.purpose,
    '',
    '## Scope',
  ]

  if (context.scope.included.length > 0) {
    sections.push(
      'Included in this domain:',
      ...context.scope.included.map((item) => `- ${item}`),
      '',
    )
  }

  if (context.scope.excluded && context.scope.excluded.length > 0) {
    sections.push(
      'Excluded from this domain:',
      ...context.scope.excluded.map((item) => `- ${item}`),
      '',
    )
  }

  if (context.ownership) {
    sections.push('## Ownership', context.ownership, '')
  }

  if (context.usage) {
    sections.push('## Usage', context.usage, '')
  }

  return sections.join('\n')
}

function generateMinimalDomainContextMarkdown(domainName: string): string {
  return `# Domain: ${domainName}

## Purpose
Describe what this domain represents and why it exists.

## Scope
Define what belongs in this domain and what does not.

## Ownership
Which system, team, or layer owns this domain.

## Usage
How this domain should be used by agents and contributors.
`
}

function generateMinimalTopicContextMarkdown(topicName: string): string {
  return `# Topic: ${topicName}

## Overview
Describe what this topic covers and its key concepts.

## Related Topics
List related topics and how they connect to this one.
`
}

function generateTopicContextMarkdown(topicName: string, context: TopicContext): string {
  const sections: string[] = [
    `# Topic: ${topicName}`,
    '',
    '## Overview',
    context.overview,
    '',
  ]

  if (context.keyConcepts && context.keyConcepts.length > 0) {
    sections.push(
      '## Key Concepts',
      ...context.keyConcepts.map((concept) => `- ${concept}`),
      '',
    )
  }

  if (context.relatedTopics && context.relatedTopics.length > 0) {
    sections.push(
      '## Related Topics',
      ...context.relatedTopics.map((topic) => `- ${topic}`),
      '',
    )
  }

  return sections.join('\n')
}

function generateMinimalSubtopicContextMarkdown(subtopicName: string): string {
  return `# Subtopic: ${subtopicName}

## Overview
Describe what this subtopic covers and its specific focus.
`
}

function generateSubtopicContextMarkdown(subtopicName: string, context: SubtopicContext): string {
  const sections: string[] = [
    `# Subtopic: ${subtopicName}`,
    '',
    '## Focus',
    context.focus,
    '',
  ]

  if (context.parentRelation) {
    sections.push('## Parent Relation', context.parentRelation, '')
  }

  return sections.join('\n')
}

async function createDomainContextIfMissing(
  basePath: string,
  domain: string,
  domainContext?: DomainContext,
): Promise<{created: boolean; path?: string}> {
  const normalizedDomain = toSnakeCase(domain)
  const contextPath = join(basePath, normalizedDomain, 'context.md')

  const exists = await DirectoryManager.fileExists(contextPath)
  if (exists) {
    return {created: false}
  }

  const content = domainContext
    ? generateDomainContextMarkdown(normalizedDomain, domainContext)
    : generateMinimalDomainContextMarkdown(normalizedDomain)

  await DirectoryManager.writeFileAtomic(contextPath, content)

  return {created: true, path: contextPath}
}

async function ensureTopicContextMd(
  basePath: string,
  domain: string,
  topic: string,
  topicContext?: TopicContext,
): Promise<{created: boolean; path?: string}> {
  const normalizedDomain = toSnakeCase(domain)
  const normalizedTopic = toSnakeCase(topic)
  const topicPath = join(basePath, normalizedDomain, normalizedTopic)
  const contextPath = join(topicPath, 'context.md')

  // Check if topic folder exists first
  const folderExists = await DirectoryManager.folderExists(topicPath)
  if (!folderExists) {
    return {created: false}
  }

  // Check if context.md already exists
  const exists = await DirectoryManager.fileExists(contextPath)
  if (exists) {
    return {created: false}
  }

  const content = topicContext
    ? generateTopicContextMarkdown(normalizedTopic, topicContext)
    : generateMinimalTopicContextMarkdown(normalizedTopic)
  await DirectoryManager.writeFileAtomic(contextPath, content)

  return {created: true, path: contextPath}
}

interface EnsureSubtopicContextMdOptions {
  basePath: string
  domain: string
  subtopic: string
  subtopicContext?: SubtopicContext
  topic: string
}

/**
 * Ensure context.md exists at subtopic level.
 * Creates a context.md with LLM-provided content if available, otherwise creates a minimal template.
 */
async function ensureSubtopicContextMd(options: EnsureSubtopicContextMdOptions): Promise<{created: boolean; path?: string}> {
  const {basePath, domain, subtopic, subtopicContext, topic} = options
  const normalizedDomain = toSnakeCase(domain)
  const normalizedTopic = toSnakeCase(topic)
  const normalizedSubtopic = toSnakeCase(subtopic)
  const subtopicPath = join(basePath, normalizedDomain, normalizedTopic, normalizedSubtopic)
  const contextPath = join(subtopicPath, 'context.md')

  // Check if subtopic folder exists first
  const folderExists = await DirectoryManager.folderExists(subtopicPath)
  if (!folderExists) {
    return {created: false}
  }

  // Check if context.md already exists
  const exists = await DirectoryManager.fileExists(contextPath)
  if (exists) {
    return {created: false}
  }

  const content = subtopicContext
    ? generateSubtopicContextMarkdown(normalizedSubtopic, subtopicContext)
    : generateMinimalSubtopicContextMarkdown(normalizedSubtopic)
  await DirectoryManager.writeFileAtomic(contextPath, content)

  return {created: true, path: contextPath}
}

/**
 * Ensure context.md exists at all levels for a given path (topic and subtopic).
 * This is called during ADD operations to create context.md files with LLM-provided content.
 */
async function ensureContextMd(
  basePath: string,
  parsed: {domain: string; subtopic?: string; topic: string},
  topicContext?: TopicContext,
  subtopicContext?: SubtopicContext,
): Promise<void> {
  // Ensure topic-level context.md exists
  await ensureTopicContextMd(basePath, parsed.domain, parsed.topic, topicContext)

  // If subtopic exists, ensure subtopic-level context.md exists
  if (parsed.subtopic) {
    await ensureSubtopicContextMd({
      basePath,
      domain: parsed.domain,
      subtopic: parsed.subtopic,
      subtopicContext,
      topic: parsed.topic,
    })
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
 * Validate domain name format.
 * Dynamic domains are allowed - no predefined list or limits.
 * The agent is responsible for creating semantically meaningful domains.
 */
function validateDomain(domainName: string): {allowed: boolean; reason?: string} {
  const normalizedDomain = toSnakeCase(domainName)

  // Validate domain name format (must be non-empty and valid for filesystem)
  if (!normalizedDomain || normalizedDomain.length === 0) {
    return {
      allowed: false,
      reason: 'Domain name cannot be empty.',
    }
  }

  // Check for invalid characters in domain name
  if (!/^[\w-]+$/.test(normalizedDomain)) {
    return {
      allowed: false,
      reason: `Domain name "${normalizedDomain}" contains invalid characters. Use only letters, numbers, underscores, and hyphens.`,
    }
  }

  // All valid domain names are allowed - dynamic domain creation enabled
  return {allowed: true}
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
async function executeAdd(basePath: string, operation: Operation): Promise<OperationResult> {
  const {content, domainContext, path, reason, subtopicContext, title, topicContext} = operation

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

    const domainValidation = validateDomain(parsed.domain)
    if (!domainValidation.allowed) {
      return {
        message: domainValidation.reason,
        path,
        status: 'failed',
        type: 'ADD',
      }
    }

    await createDomainContextIfMissing(basePath, parsed.domain, domainContext)

    const domainPath = join(basePath, toSnakeCase(parsed.domain))
    const topicPath = join(domainPath, toSnakeCase(parsed.topic))
    const finalPath = parsed.subtopic ? join(topicPath, toSnakeCase(parsed.subtopic)) : topicPath

    const contextContent = MarkdownWriter.generateContext({
      name: title,
      narrative: content.narrative,
      rawConcept: content.rawConcept,
      relations: content.relations,
      snippets: content.snippets ?? [],
    })
    const filename = `${toSnakeCase(title)}.md`
    const contextPath = join(finalPath, filename)
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)

    await ensureContextMd(basePath, parsed, topicContext, subtopicContext)

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
async function executeUpdate(basePath: string, operation: Operation): Promise<OperationResult> {
  const {content, domainContext, path, reason, subtopicContext, title, topicContext} = operation

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
    const parsed = parsePath(path)
    if (!parsed) {
      return {
        message: `Invalid path format: ${path}. Expected domain/topic or domain/topic/subtopic`,
        path,
        status: 'failed',
        type: 'UPDATE',
      }
    }

    const fullPath = buildFullPath(basePath, path)
    const filename = `${toSnakeCase(title)}.md`
    const contextPath = join(fullPath, filename)

    const exists = await DirectoryManager.fileExists(contextPath)
    if (!exists) {
      return {
        message: `File does not exist: ${path}/${filename}`,
        path,
        status: 'failed',
        type: 'UPDATE',
      }
    }

    await createDomainContextIfMissing(basePath, parsed.domain, domainContext)

    const contextContent = MarkdownWriter.generateContext({
      name: title,
      narrative: content.narrative,
      rawConcept: content.rawConcept,
      relations: content.relations,
      snippets: content.snippets ?? [],
    })
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)

    await ensureContextMd(basePath, parsed, topicContext, subtopicContext)

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
async function executeMerge(basePath: string, operation: Operation): Promise<OperationResult> {
  const {domainContext, mergeTarget, mergeTargetTitle, path, reason, subtopicContext, title, topicContext} = operation

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
    const sourceParsed = parsePath(path)
    const targetParsed = parsePath(mergeTarget)

    if (!sourceParsed || !targetParsed) {
      return {
        message: `Invalid path format. Expected domain/topic or domain/topic/subtopic`,
        path,
        status: 'failed',
        type: 'MERGE',
      }
    }

    const sourceFolderPath = buildFullPath(basePath, path)
    const targetFolderPath = buildFullPath(basePath, mergeTarget)

    const sourceFilename = `${toSnakeCase(title)}.md`
    const targetFilename = `${toSnakeCase(mergeTargetTitle)}.md`

    const sourceContextPath = join(sourceFolderPath, sourceFilename)
    const targetContextPath = join(targetFolderPath, targetFilename)

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

    await createDomainContextIfMissing(basePath, sourceParsed.domain, domainContext)
    await createDomainContextIfMissing(basePath, targetParsed.domain, domainContext)

    const sourceContent = await DirectoryManager.readFile(sourceContextPath)
    const targetContent = await DirectoryManager.readFile(targetContextPath)

    const mergedContent = MarkdownWriter.mergeContexts(sourceContent, targetContent)
    await DirectoryManager.writeFileAtomic(targetContextPath, mergedContent)

    await DirectoryManager.deleteFile(sourceContextPath)

    await ensureContextMd(basePath, sourceParsed, topicContext, subtopicContext)
    await ensureContextMd(basePath, targetParsed, topicContext, subtopicContext)

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
async function executeDelete(basePath: string, operation: Operation): Promise<OperationResult> {
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
async function executeCurate(input: unknown, _context?: ToolExecutionContext): Promise<CurateOutput> {
  const parseResult = CurateInputSchema.safeParse(input)
  if (!parseResult.success) {
    return {
      applied: [
        {
          message: `Invalid input: ${parseResult.error.message}`,
          path: '',
          status: 'failed',
          type: 'ADD',
        },
      ],
      summary: {
        added: 0,
        deleted: 0,
        failed: 1,
        merged: 0,
        updated: 0,
      },
    }
  }

  const {basePath, operations} = parseResult.data

  const touchedDomains = new Set<string>()
  for (const op of operations) {
    const parsed = parsePath(op.path)
    if (parsed) {
      touchedDomains.add(toSnakeCase(parsed.domain))
    }

    if (op.type === 'MERGE' && op.mergeTarget) {
      const targetParsed = parsePath(op.mergeTarget)
      if (targetParsed) {
        touchedDomains.add(toSnakeCase(targetParsed.domain))
      }
    }
  }

  await backfillDomainContextFiles(basePath, touchedDomains)

  const applied: OperationResult[] = []
  const summary = {
    added: 0,
    deleted: 0,
    failed: 0,
    merged: 0,
    updated: 0,
  }
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
        // Exhaustive type check - TypeScript will error if any case is missed
        const exhaustiveCheck: never = operation.type
        result = {
          message: `Unknown operation type: ${exhaustiveCheck}`,
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

export async function backfillDomainContextFiles(
  basePath: string,
  excludeDomains: Set<string> = new Set(),
): Promise<string[]> {
  const createdPaths: string[] = []

  const baseExists = await DirectoryManager.folderExists(basePath)
  if (!baseExists) {
    return createdPaths
  }

  let entries: Dirent[]
  try {
    entries = await readdir(basePath, {withFileTypes: true})
  } catch {
    return createdPaths
  }

  const domains = entries.filter((entry: Dirent) => entry.isDirectory())

  /* eslint-disable no-await-in-loop */
  for (const domain of domains) {
    if (excludeDomains.has(domain.name)) {
      continue
    }

    const contextPath = join(basePath, domain.name, 'context.md')
    const exists = await DirectoryManager.fileExists(contextPath)

    if (!exists) {
      const mdFiles = await DirectoryManager.listMarkdownFiles(join(basePath, domain.name))
      if (mdFiles.length > 0) {
        const content = generateMinimalDomainContextMarkdown(domain.name)
        await DirectoryManager.writeFileAtomic(contextPath, content)
        createdPaths.push(contextPath)
      }
    }
  }

  return createdPaths
}

export function createCurateTool(): Tool {
  return {
    description: `Curate knowledge topics with atomic operations. This tool manages the knowledge structure using four operation types and supports a two-part context model: Raw Concept + Narrative.

**Content Structure (Two-Part Model):**
- **rawConcept**: Captures essential metadata and technical footprint
  - task: What is the task related to this concept
  - changes: Array of changes induced in the codebase
  - files: Array of related files
  - flow: The execution flow of this concept
  - timestamp: When created/modified (ISO 8601 format)
- **narrative**: Captures descriptive and structural context
  - structure: Code structure documentation
  - dependencies: Dependency management information
  - features: Feature documentation
- **snippets**: Code/text snippets (legacy support)
- **relations**: Related topics using @domain/topic notation

**Operations:**
1. **ADD** - Create new titled context file in domain/topic/subtopic
   - Requires: path, title, content (snippets and/or relations), reason
   - Relations must be in the format of "domain/topic/title.md" or "domain/topic/subtopic/title.md"
   - Example with Raw Concept + Narrative:
     {
       type: "ADD",
       path: "structure/caching",
       title: "Redis User Permissions",
       content: {
         rawConcept: {
           task: "Introduce Redis cache for getUserPermissions(userId)",
           changes: ["Cached result using remote Redis", "Redis client: singleton"],
           files: ["services/permission_service.go", "clients/redis_client.go"],
           flow: "getUserPermissions -> check Redis -> on miss query DB -> store result -> return",
           timestamp: "2025-03-18"
         },
         narrative: {
           structure: "# Redis client\\n- clients/redis_client.go",
           dependencies: "# Redis client\\n- Singleton, init when service starts",
           features: "# Authorization\\n- User permission can be stale for up to 300 seconds"
         },
         relations: ["structure/api-endpoints/validation.md", "structure/api-endpoints/error-handling/retry-logic.md"]
       },
       reason: "New caching pattern"
     }
   - Creates: structure/caching/redis_user_permissions.md

2. **UPDATE** - Modify existing titled context file (full replacement)
   - Requires: path, title, content, reason
   - Relations must be in the format of "domain/topic/title.md" or "domain/topic/subtopic/title.md"
   - Supports same content structure as ADD

3. **MERGE** - Combine source file into target file, delete source
   - Requires: path (source), title (source file), mergeTarget (destination path), mergeTargetTitle (destination file), reason
   - Example: { type: "MERGE", path: "code_style/old_topic", title: "Old Guide", mergeTarget: "code_style/new_topic", mergeTargetTitle: "New Guide", reason: "Consolidating" }
   - Raw concepts and narratives are intelligently merged

4. **DELETE** - Remove specific file or entire folder
   - Requires: path, title (optional), reason
   - With title: deletes specific file; without title: deletes entire folder

**CRITICAL - Path vs Title separation:**
- "path" = folder location only (domain/topic or domain/topic/subtopic) - NEVER include file extension suffixes 
- "title" = the context name (becomes {title}.md file automatically)
- The system auto-generates the .md file from title - DO NOT put .md or _md anywhere in path

**Path format:** domain/topic OR domain/topic/subtopic (2-3 segments, NO filename, NO extension)
**File naming:** Title is auto-converted to snake_case and .md is auto-appended (e.g., title "Best Practices" -> best_practices.md)

**Good path examples:**
- path: "authentication/jwt", title: "Token Refresh" -> creates authentication/jwt/token_refresh.md
- path: "api_design/error_handling", title: "Retry Logic" -> creates api_design/error_handling/retry_logic.md
- path: "database/migrations/versioning", title: "Schema Changes" -> creates database/migrations/versioning/schema_changes.md

**Bad path examples (NEVER DO THIS):**
- "code_style/error_handling_md" - WRONG: _md suffix in path
- "code_style/error_handling.md" - WRONG: .md extension in path
- "authentication/jwt/token_refresh.md" - WRONG: filename in path (use title parameter instead)
- "authentication/jwt/token_refresh_md" - WRONG: _md suffix (this is NOT how to specify filename)
- "api/auth/jwt/tokens" - WRONG: 4 levels deep (max 3 allowed)
- "a/b" - WRONG: too vague, use descriptive names

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

**Automatic Domain Context (context.md):**
- When any operation (ADD/UPDATE/MERGE) touches a domain for the first time, a context.md file is automatically created at the domain root
- This context.md describes the domain's purpose, scope, ownership, and usage guidelines
- **IMPORTANT**: When creating content in a NEW domain, provide the \`domainContext\` field with:
  - \`purpose\` (required): What this domain represents and why it exists
  - \`scope.included\` (required): Array of what belongs in this domain
  - \`scope.excluded\` (optional): Array of what does NOT belong in this domain
  - \`ownership\` (optional): Which team/system owns this domain
  - \`usage\` (optional): How this domain should be used
- Example with domainContext:
  {
    type: "ADD",
    path: "authentication/jwt",
    title: "Token Handling",
    content: { ... },
    domainContext: {
      purpose: "Contains all knowledge related to user and service authentication mechanisms used across the platform.",
      scope: {
        included: ["Login and signup flows", "Token-based authentication (JWT, refresh tokens)", "OAuth integrations", "Session handling"],
        excluded: ["Authorization and permission models", "User profile management"]
      },
      ownership: "Platform Security Team",
      usage: "Use this domain for documenting authentication flows, token handling, and identity verification patterns."
    },
    reason: "Documenting JWT token handling"
  }
- If domainContext is not provided for a new domain, a minimal template is created that can be updated later

**Topic Context (context.md at topic level):**
- When creating content in a NEW topic, provide the \`topicContext\` field to auto-generate topic/context.md
- **IMPORTANT**: When creating content in a NEW topic, provide the \`topicContext\` field with:
  - \`overview\` (required): What this topic covers and its main focus
  - \`keyConcepts\` (optional): Array of key concepts covered in this topic
  - \`relatedTopics\` (optional): Array of related topics and how they connect
- Example with topicContext:
  {
    type: "ADD",
    path: "authentication/jwt",
    title: "Token Handling",
    content: { ... },
    topicContext: {
      overview: "Covers all aspects of JWT-based authentication including token generation, validation, and refresh mechanisms.",
      keyConcepts: ["JWT tokens", "Refresh token rotation", "Token blacklisting", "Token validation middleware"],
      relatedTopics: ["authentication/session - for session-based alternatives", "security/encryption - for token signing"]
    },
    reason: "Documenting JWT token handling"
  }
- If topicContext is not provided for a new topic, a minimal template is created that can be updated later

**Subtopic Context (context.md at subtopic level):**
- When creating content in a NEW subtopic, provide the \`subtopicContext\` field to auto-generate subtopic/context.md
- **IMPORTANT**: When creating content in a NEW subtopic, provide the \`subtopicContext\` field with:
  - \`focus\` (required): The specific focus of this subtopic
  - \`parentRelation\` (optional): How this subtopic relates to its parent topic
- Example with subtopicContext:
  {
    type: "ADD",
    path: "authentication/jwt/refresh_tokens",
    title: "Rotation Strategy",
    content: { ... },
    subtopicContext: {
      focus: "Focuses on refresh token rotation strategy and invalidation mechanisms to prevent token reuse attacks.",
      parentRelation: "Handles the token refresh aspect of JWT authentication, specifically how old tokens are invalidated when new ones are issued."
    },
    reason: "Documenting refresh token rotation"
  }
- If subtopicContext is not provided for a new subtopic, a minimal template is created that can be updated later

**Backward Compatibility:** Existing context entries using only snippets and relations continue to work.

**Output:** Returns applied operations with status (success/failed), filePath (for created/modified files), and a summary of counts.`,

    execute: executeCurate,

    id: ToolName.CURATE,
    inputSchema: CurateInputSchema,
  }
}
