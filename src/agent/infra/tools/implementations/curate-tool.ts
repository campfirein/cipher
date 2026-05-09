import {basename, dirname, join, relative, resolve} from 'node:path'
import {z} from 'zod'

import type {ContextData} from '../../../../server/core/domain/knowledge/markdown-writer.js'
import type {IRuntimeSignalStore} from '../../../../server/core/interfaces/storage/i-runtime-signal-store.js'
import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {ILogger} from '../../../core/interfaces/i-logger.js'
import type {AbstractGenerationQueue} from '../../map/abstract-queue.js'

import {REVIEW_BACKUPS_DIR} from '../../../../server/constants.js'
import {DirectoryManager} from '../../../../server/core/domain/knowledge/directory-manager.js'
import {MarkdownWriter, parseCreatedAt} from '../../../../server/core/domain/knowledge/markdown-writer.js'
import {
  determineTier,
  mergeScoring,
  recordCurateUpdate,
} from '../../../../server/core/domain/knowledge/memory-scoring.js'
import {
  createDefaultRuntimeSignals,
  type RuntimeSignals,
} from '../../../../server/core/domain/knowledge/runtime-signals-schema.js'
import {warnSidecarFailure} from '../../../../server/core/domain/knowledge/sidecar-logging.js'
import {isExcludedFromSync} from '../../../../server/infra/context-tree/derived-artifact.js'
import {toSnakeCase} from '../../../../server/utils/file-helpers.js'
import {deriveImpactFromLoss, detectStructuralLoss} from '../../../core/domain/knowledge/conflict-detector.js'
import {resolveStructuralLoss} from '../../../core/domain/knowledge/conflict-resolver.js'
import {ToolName} from '../../../core/domain/tools/constants.js'
import {getCurrentReviewDisabled} from './curate-tool-task-context.js'

/**
 * Called after each successful context file write so callers can
 * enqueue abstract generation without coupling to AbstractGenerationQueue.
 */
type WriteCallback = (contextPath: string, content: string) => void

/**
 * Derive the sidecar relPath (forward-slash, relative to the context tree
 * root) from an absolute context-file path and the operation basePath.
 */
function relPathFromContextPath(contextPath: string, basePath: string): string {
  return relative(basePath, contextPath).split('\\').join('/')
}

/**
 * Preserve the original `createdAt` from the existing markdown frontmatter on
 * UPDATE. `createdAt` is immutable content metadata, not a runtime signal, so
 * it stays in the markdown source-of-truth. Falls back to a fresh timestamp
 * when the existing file has no `createdAt` (old files or those that never
 * had it).
 */
function existingCreatedAt(existingContent: null | string | undefined): string {
  if (!existingContent) return new Date().toISOString()
  return parseCreatedAt(existingContent) ?? new Date().toISOString()
}

const CURATE_SITE = 'curate-tool'

/**
 * Seed the sidecar with default signals for a newly-added file.
 * Best-effort: sidecar write failures never break the markdown operation.
 */
async function seedSidecarDefaults(
  store: IRuntimeSignalStore | undefined,
  relPath: string,
  logger?: ILogger,
): Promise<void> {
  if (!store) return
  try {
    await store.set(relPath, createDefaultRuntimeSignals())
  } catch (error) {
    warnSidecarFailure(logger, CURATE_SITE, 'seed', relPath, error)
  }
}

/**
 * Mirror a curate UPDATE into the sidecar.
 *
 * Applies `recordCurateUpdate`-equivalent bumps (importance +5, recency=1,
 * updateCount+1) and recomputes `maturity` via `determineTier` inside the
 * atomic updater so same-path contention does not lose writes.
 * `updatedAt` is intentionally NOT mirrored — it is a content timestamp
 * that stays in markdown frontmatter.
 */
async function mirrorCurateUpdate(
  store: IRuntimeSignalStore | undefined,
  relPath: string,
  logger?: ILogger,
): Promise<void> {
  if (!store) return
  try {
    await store.update(relPath, (current: RuntimeSignals): RuntimeSignals => {
      const bumped = recordCurateUpdate(current)
      return {
        ...current,
        importance: bumped.importance,
        maturity: determineTier(bumped.importance, current.maturity),
        recency: bumped.recency,
        updateCount: bumped.updateCount,
      }
    })
  } catch (error) {
    warnSidecarFailure(logger, CURATE_SITE, 'update', relPath, error)
  }
}

/**
 * Remove a path's sidecar entry after its markdown file was deleted or moved
 * (DELETE, MERGE source, archive). Best-effort.
 */
async function dropSidecar(
  store: IRuntimeSignalStore | undefined,
  relPath: string,
  logger?: ILogger,
): Promise<void> {
  if (!store) return
  try {
    await store.delete(relPath)
  } catch (error) {
    warnSidecarFailure(logger, CURATE_SITE, 'drop', relPath, error)
  }
}

/**
 * Operation types for curating knowledge topics.
 * Inspired by ACE Curator patterns.
 */
const OperationType = z.enum(['ADD', 'UPDATE', 'UPSERT', 'MERGE', 'DELETE'])
type OperationType = z.infer<typeof OperationType>

/**
 * Raw Concept schema for structured metadata and technical footprint.
 */
const RawConceptSchema = z.object({
  author: z.string().optional().describe('Author or source attribution (e.g., "meowso", "Team Security")'),
  changes: z
    .array(z.string())
    .optional()
    .describe('What changes are induced by this concept (e.g., code changes, process updates, market shifts)'),
  files: z
    .array(z.string())
    .optional()
    .describe('Related documents, source files, or resources (e.g., source code paths, reports, data files)'),
  flow: z.string().optional().describe('The process flow or workflow described by this concept'),
  patterns: z
    .array(
      z.object({
        description: z.string().describe('What this pattern matches or validates'),
        flags: z.string().optional().describe('Pattern flags (e.g., "gi" for regex)'),
        pattern: z.string().describe('The exact pattern string (e.g., regex pattern)'),
      }),
    )
    .optional()
    .describe('Regex or validation patterns related to this concept'),
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
      'Dependency or relationship information (e.g., prerequisite systems, required inputs, related components)',
    ),
  diagrams: z
    .array(
      z.object({
        content: z
          .string()
          .describe('The full diagram content (Mermaid code, PlantUML code, or ASCII art) - preserved verbatim'),
        title: z.string().optional().describe('Optional title or label for the diagram'),
        type: z.enum(['mermaid', 'plantuml', 'ascii', 'other']).describe('Diagram type for proper rendering'),
      }),
    )
    .optional()
    .describe('Diagrams found in source content - Mermaid, PlantUML, ASCII art, sequence diagrams. Preserve verbatim.'),
  examples: z.string().optional().describe('Concrete examples and use cases demonstrating the concept'),
  highlights: z
    .string()
    .optional()
    .describe(
      'Key highlights, capabilities, deliverables, or notable outcomes (e.g., "User permission can be stale for up to 300 seconds due to Redis cache")',
    ),
  rules: z.string().optional().describe('Exact rules, constraints, or guidelines - preserved verbatim from source'),
  structure: z
    .string()
    .optional()
    .describe('Structural or organizational documentation (e.g., file layout, data schema, process hierarchy)'),
})

/**
 * Fact schema for structured factual statements extracted during curation.
 */
const FactSchema = z.object({
  category: z
    .enum(['personal', 'project', 'preference', 'convention', 'team', 'environment', 'other'])
    .optional()
    .describe('Category of the fact (e.g., "personal", "project", "preference", "convention", "team", "environment")'),
  statement: z.string().describe('The full factual statement (e.g., "My name is Andy", "We use PostgreSQL 15")'),
  subject: z
    .string()
    .optional()
    .describe('What the fact is about in snake_case (e.g., "user_name", "database", "sprint_duration")'),
  value: z.string().optional().describe('The extracted value (e.g., "Andy", "PostgreSQL 15", "2 weeks")'),
})

/**
 * Content structure for ADD and UPDATE operations.
 */
const ContentSchema = z.object({
  facts: z
    .array(FactSchema)
    .optional()
    .describe(
      'Factual statements extracted from content (e.g., personal info, project facts, preferences, conventions)',
    ),
  keywords: z
    .array(z.string())
    .default([])
    .describe('Keywords for search and discovery (e.g., ["jwt", "refresh_token", "rotation"])'),
  narrative: NarrativeSchema.optional().describe('Narrative section with descriptive and structural context'),
  rawConcept: RawConceptSchema.optional().describe('Raw concept section with metadata and technical footprint'),
  relations: z
    .array(z.string())
    .optional()
    .describe('Related topics using domain/topic/title.md or domain/topic/subtopic/title.md notation'),
  snippets: z.array(z.string()).optional().describe('Code/text snippets'),
  tags: z
    .array(z.string())
    .default([])
    .describe('Tags for categorization and filtering (e.g., ["authentication", "security", "jwt"])'),
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
  scope: z
    .object({
      excluded: z
        .array(z.string())
        .optional()
        .describe(
          'What does NOT belong in this domain (e.g., ["Authorization and permission models", "User profile management"])',
        ),
      included: z
        .array(z.string())
        .describe(
          'What belongs in this domain (e.g., ["Login and signup flows", "Token-based authentication", "OAuth integrations"])',
        ),
    })
    .describe('Define what belongs and does not belong in this domain'),
  usage: z.string().optional().describe('How this domain should be used by agents and contributors'),
})

const TopicContextSchema = z.object({
  keyConcepts: z
    .array(z.string())
    .optional()
    .describe(
      'Key concepts covered in this topic (e.g., ["JWT tokens", "Refresh token rotation", "Token blacklisting"])',
    ),
  overview: z
    .string()
    .describe(
      'Describe what this topic covers and its main focus (e.g., "Covers all aspects of JWT-based authentication including token generation, validation, and refresh mechanisms")',
    ),
  relatedTopics: z
    .array(z.string())
    .optional()
    .describe(
      'Related topics and how they connect (e.g., ["authentication/session - for session-based alternatives", "security/encryption - for token signing"])',
    ),
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
    .describe(
      'How this subtopic relates to its parent topic (e.g., "Handles the token refresh aspect of JWT authentication")',
    ),
})

/**
 * Single operation schema for curating knowledge.
 */
const OperationSchema = z.object({
  confidence: z
    .enum(['high', 'low'])
    .default('low')
    .describe(
      'Your confidence in the accuracy and completeness of this operation. Use "high" when you have direct evidence from the source material; use "low" when the information is inferred, uncertain, or incomplete.',
    ),
  content: ContentSchema.optional().describe('Content for ADD/UPDATE operations'),
  domainContext: DomainContextSchema.optional().describe(
    'Domain-level context for new domains. When creating content in a NEW domain, provide this to auto-generate domain/context.md with purpose, scope, ownership, and usage. Only needed when the domain does not exist yet.',
  ),
  impact: z
    .enum(['high', 'low'])
    .default('high')
    .describe(
      'Estimated scope of impact of this knowledge change. "high": Changes that alter core decisions, strategies, tools, or established approaches. Any change that contradicts or reverses previously curated knowledge. Updates to existing knowledge that change its core substance. Deletions are always high impact. "low": New additions to previously undocumented topics, minor corrections, supplementary details like examples and clarifications, or updates that extend existing knowledge without changing its core substance.',
    ),
  mergeTarget: z.string().optional().describe('Target path for MERGE operation'),
  mergeTargetTitle: z.string().optional().describe('Title of the target file for MERGE operation'),
  path: z.string().describe('Path: domain/topic/title.md or domain/topic/subtopic/title.md'),
  reason: z
    .string()
    .describe(
      'The motivation and context behind this curation — the WHY, not the what. Describe the decision, event, conversation, or observation that made this knowledge worth capturing. Write it for a human reviewer: they will read this in the web inbox to decide whether to approve or modify the change. Example of a good reason: "After debating caching strategies in PR #42, the team chose Redis with a 5-minute TTL as a deliberate performance/freshness trade-off — future agents should know this was intentional." Bad example: "Updating caching documentation."',
    ),
  subtopicContext: SubtopicContextSchema.optional().describe(
    'Subtopic-level context for new subtopics. When creating content in a NEW subtopic, provide this to auto-generate subtopic/context.md with focus and parent relation. Only needed when the subtopic does not exist yet.',
  ),
  summary: z
    .string()
    .optional()
    .describe(
      'One-line semantic summary of what this knowledge file contains after this operation. For human reviewers to quickly grasp the content without reading the full document. Example: "Caching strategy using Redis with 5-min TTL and write-through invalidation". Required for ADD/UPDATE/UPSERT/MERGE, not needed for DELETE.',
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
type Content = z.infer<typeof ContentSchema>

/**
 * Filter out non-existent files from rawConcept.files and derived-artifact
 * paths from relations.
 */
async function filterValidFiles(content: Content): Promise<Content> {
  // Drop relations that won't be pushed — they'd be dangling refs on remote.
  const cleanedRelations = content.relations?.filter((r) => !isExcludedFromSync(r))
  const withCleanRelations: Content = cleanedRelations === content.relations
    ? content
    : {...content, relations: cleanedRelations}

  if (!withCleanRelations.rawConcept?.files || withCleanRelations.rawConcept.files.length === 0) {
    return withCleanRelations
  }

  const checks = await Promise.all(
    withCleanRelations.rawConcept.files.map(async (filePath) => {
      // Skip filesystem validation for URLs and document references
      if (filePath.includes('://')) return true
      // Skip entries that look like document references (no path separators, contain spaces)
      if (!filePath.includes('/') && !filePath.includes('\\') && filePath.includes(' ')) return true
      return DirectoryManager.fileExists(filePath)
    }),
  )

  const validFiles = withCleanRelations.rawConcept.files.filter((_, i) => checks[i])

  // Return content with filtered files (empty array if none exist)
  return {
    ...withCleanRelations,
    rawConcept: {
      ...withCleanRelations.rawConcept,
      files: validFiles.length > 0 ? validFiles : undefined,
    },
  }
}

/**
 * Input schema for curate tool.
 * Exported for use by CurateService in sandbox.
 */
export const CurateInputSchema = z.object({
  basePath: z.string().default('.brv/context-tree').describe('Base path for knowledge storage'),
  operations: z.array(OperationSchema).describe('Array of curate operations to apply'),
})

/**
 * Result of a single operation.
 * Exported for use by CurateService in sandbox.
 */
export interface OperationResult {
  /**
   * Additional file paths affected by this operation that need restoration on rejection.
   * MERGE: the source file path (deleted during merge).
   * Folder DELETE: all individual .md file paths backed up before deletion.
   */
  additionalFilePaths?: string[]
  /** LLM-assessed confidence in the accuracy and completeness of this operation. */
  confidence: 'high' | 'low'
  /** Full filesystem path to the created/modified file (for ADD/UPDATE/MERGE) or deleted file. */
  filePath?: string
  /** Scope of impact: DELETE is high, UPDATE is medium, others are low. */
  impact: 'high' | 'low'
  message?: string
  /** Whether this operation should be flagged for human review in the web inbox. */
  needsReview: boolean
  path: string
  /** Semantic summary of the file's content before this operation (for UPDATE/UPSERT/MERGE/DELETE). */
  previousSummary?: string
  /** Human-facing motivation: WHY this knowledge was curated. Shown in web review inbox. */
  reason: string
  status: 'failed' | 'success'
  /** Semantic summary of the file's content after this operation (for ADD/UPDATE/UPSERT/MERGE). */
  summary?: string
  type: OperationType
}

/**
 * Derive review metadata for a curate operation.
 * confidence and impact are LLM-provided (schema defaults applied by Zod when omitted).
 * needsReview:
 *   - DELETE always (irreversible)
 *   - high impact always (core decisions, strategy changes, contradictions)
 *   - low impact → no review (minor additions/corrections)
 */
function deriveReviewMetadata(
  type: OperationType,
  confidence: 'high' | 'low',
  impact: 'high' | 'low',
): {confidence: 'high' | 'low'; impact: 'high' | 'low'; needsReview: boolean} {
  const needsReview = type === 'DELETE' || impact === 'high'
  return {confidence, impact, needsReview}
}

/**
 * Output type for curate tool.
 * Exported for use by CurateService in sandbox.
 */
export interface CurateOutput {
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
 * Back up a file's content before curate overwrites or deletes it.
 *
 * First-write-wins: if a backup already exists for this path, this is a no-op.
 * This ensures the backup always reflects the snapshot version (state at last push),
 * even when multiple curate operations modify the same file between pushes.
 *
 * @param filePath - Absolute path to the context tree file being modified
 * @param basePath - Context tree base path (e.g., '.brv/context-tree')
 */
async function backupBeforeWrite(filePath: string, basePath: string, reviewDisabled: boolean): Promise<void> {
  // Honor `brv review --disable`: backups exist solely to support review rejection
  // (restore from backup). With reviews disabled, they are dead state — skip creation
  // so review-backups/ stays empty. Snapshot taken once at executeCurate top so all
  // ops in this tool call observe a consistent value even if the user toggles mid-task.
  if (reviewDisabled) return

  try {
    const brvDir = dirname(resolve(basePath))
    const relativePath = relative(resolve(basePath), resolve(filePath))
    const backupPath = join(brvDir, REVIEW_BACKUPS_DIR, relativePath)

    // First-write-wins: skip if backup already exists
    const backupExists = await DirectoryManager.fileExists(backupPath)
    if (backupExists) return

    // Read current content and save as backup
    const content = await DirectoryManager.readFile(filePath)
    await DirectoryManager.writeFileAtomic(backupPath, content)
  } catch {
    // Best-effort: backup failure must never block curate operations
  }
}

/**
 * Type guard: narrows an unknown JSON value to a shape that may carry the
 * `reviewDisabled` flag. Used as the fallback when the agent process has no
 * AsyncLocalStorage scope (direct sandbox callers without a TaskExecute).
 */
function hasReviewDisabledField(value: unknown): value is {reviewDisabled?: unknown} {
  return typeof value === 'object' && value !== null
}

/**
 * Reads `<brvDir>/config.json` and returns the `reviewDisabled` flag.
 * Returns false (review enabled) on any error so a missing/corrupt config never
 * silently swallows backups that protect the rejection path.
 */
async function isReviewDisabledForBrvDir(brvDir: string): Promise<boolean> {
  try {
    const raw = await DirectoryManager.readFile(join(brvDir, 'config.json'))
    const parsed: unknown = JSON.parse(raw)
    return hasReviewDisabledField(parsed) && parsed.reviewDisabled === true
  } catch {
    return false
  }
}

function generateDomainContextMarkdown(domainName: string, context: DomainContext): string {
  const sections: string[] = [`# Domain: ${domainName}`, '', '## Purpose', context.purpose, '', '## Scope']

  if (context.scope.included.length > 0) {
    sections.push('Included in this domain:', ...context.scope.included.map((item) => `- ${item}`), '')
  }

  if (context.scope.excluded && context.scope.excluded.length > 0) {
    sections.push('Excluded from this domain:', ...context.scope.excluded.map((item) => `- ${item}`), '')
  }

  if (context.ownership) {
    sections.push('## Ownership', context.ownership, '')
  }

  if (context.usage) {
    sections.push('## Usage', context.usage, '')
  }

  return sections.join('\n')
}

function generateTopicContextMarkdown(topicName: string, context: TopicContext): string {
  const sections: string[] = [`# Topic: ${topicName}`, '', '## Overview', context.overview, '']

  if (context.keyConcepts && context.keyConcepts.length > 0) {
    sections.push('## Key Concepts', ...context.keyConcepts.map((concept) => `- ${concept}`), '')
  }

  if (context.relatedTopics && context.relatedTopics.length > 0) {
    sections.push('## Related Topics', ...context.relatedTopics.map((topic) => `- ${topic}`), '')
  }

  return sections.join('\n')
}

function generateSubtopicContextMarkdown(subtopicName: string, context: SubtopicContext): string {
  const sections: string[] = [`# Subtopic: ${subtopicName}`, '', '## Focus', context.focus, '']

  if (context.parentRelation) {
    sections.push('## Parent Relation', context.parentRelation, '')
  }

  return sections.join('\n')
}

async function createDomainContextIfMissing(
  basePath: string,
  domain: string,
  domainContext?: DomainContext,
  onAfterWrite?: WriteCallback,
): Promise<{created: boolean; path?: string}> {
  const normalizedDomain = toSnakeCase(domain)
  const contextPath = join(basePath, normalizedDomain, 'context.md')

  const exists = await DirectoryManager.fileExists(contextPath)
  if (exists) {
    return {created: false}
  }

  if (!domainContext) {
    return {created: false}
  }

  const content = generateDomainContextMarkdown(normalizedDomain, domainContext)

  await DirectoryManager.writeFileAtomic(contextPath, content)
  onAfterWrite?.(contextPath, content)

  return {created: true, path: contextPath}
}

async function ensureTopicContextMd(
  basePath: string,
  domain: string,
  topic: string,
  topicContext?: TopicContext,
  onAfterWrite?: WriteCallback,
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

  if (!topicContext) {
    return {created: false}
  }

  const content = generateTopicContextMarkdown(normalizedTopic, topicContext)
  await DirectoryManager.writeFileAtomic(contextPath, content)
  onAfterWrite?.(contextPath, content)

  return {created: true, path: contextPath}
}

interface EnsureSubtopicContextMdOptions {
  basePath: string
  domain: string
  onAfterWrite?: WriteCallback
  subtopic: string
  subtopicContext?: SubtopicContext
  topic: string
}

/**
 * Ensure context.md exists at subtopic level.
 * Only creates context.md if LLM provides subtopicContext - no static templates.
 */
async function ensureSubtopicContextMd(
  options: EnsureSubtopicContextMdOptions,
): Promise<{created: boolean; path?: string}> {
  const {basePath, domain, onAfterWrite, subtopic, subtopicContext, topic} = options
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

  if (!subtopicContext) {
    return {created: false}
  }

  const content = generateSubtopicContextMarkdown(normalizedSubtopic, subtopicContext)
  await DirectoryManager.writeFileAtomic(contextPath, content)
  onAfterWrite?.(contextPath, content)

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
  onAfterWrite?: WriteCallback,
): Promise<void> {
  // Ensure topic-level context.md exists
  await ensureTopicContextMd(basePath, parsed.domain, parsed.topic, topicContext, onAfterWrite)

  // If subtopic exists, ensure subtopic-level context.md exists
  if (parsed.subtopic) {
    await ensureSubtopicContextMd({
      basePath,
      domain: parsed.domain,
      onAfterWrite,
      subtopic: parsed.subtopic,
      subtopicContext,
      topic: parsed.topic,
    })
  }
}

async function deleteDerivedSiblings(contextPath: string): Promise<void> {
  const siblingPaths = [
    contextPath.replace(/\.md$/, '.abstract.md'),
    contextPath.replace(/\.md$/, '.overview.md'),
  ]

  /* eslint-disable no-await-in-loop */
  for (const siblingPath of siblingPaths) {
    if (siblingPath === contextPath) continue
    if (await DirectoryManager.fileExists(siblingPath)) {
      await DirectoryManager.deleteFile(siblingPath)
    }
  }
  /* eslint-enable no-await-in-loop */
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
async function executeAdd(
  basePath: string,
  operation: Operation,
  onAfterWrite?: WriteCallback,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<OperationResult> {
  const {confidence, content, domainContext, impact, path, reason, subtopicContext, summary, title, topicContext} =
    operation
  const reviewMeta = deriveReviewMetadata('ADD', confidence, impact)

  if (!title) {
    return {
      ...reviewMeta,
      message: 'ADD operation requires a title',
      path,
      reason,
      status: 'failed',
      type: 'ADD',
    }
  }

  if (!content) {
    return {
      ...reviewMeta,
      message: 'ADD operation requires content',
      path,
      reason,
      status: 'failed',
      type: 'ADD',
    }
  }

  try {
    const parsed = parsePath(path)
    if (!parsed) {
      return {
        ...reviewMeta,
        message: `Invalid path format: ${path}. Expected domain/topic or domain/topic/subtopic`,
        path,
        reason,
        status: 'failed',
        type: 'ADD',
      }
    }

    const domainValidation = validateDomain(parsed.domain)
    if (!domainValidation.allowed) {
      return {
        ...reviewMeta,
        message: domainValidation.reason,
        path,
        reason,
        status: 'failed',
        type: 'ADD',
      }
    }

    await createDomainContextIfMissing(basePath, parsed.domain, domainContext, onAfterWrite)

    const domainPath = join(basePath, toSnakeCase(parsed.domain))
    const topicPath = join(domainPath, toSnakeCase(parsed.topic))
    const finalPath = parsed.subtopic ? join(topicPath, toSnakeCase(parsed.subtopic)) : topicPath

    // Filter out non-existent files from rawConcept.files
    const filteredContent = await filterValidFiles(content)

    const contextContent = MarkdownWriter.generateContext({
      facts: filteredContent.facts,
      keywords: filteredContent.keywords,
      name: title,
      narrative: filteredContent.narrative,
      rawConcept: filteredContent.rawConcept,
      reason,
      relations: filteredContent.relations,
      snippets: filteredContent.snippets ?? [],
      summary,
      tags: filteredContent.tags,
      timestamps: {createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()},
    })
    const filename = `${toSnakeCase(title)}.md`
    const contextPath = join(finalPath, filename)
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)
    onAfterWrite?.(contextPath, contextContent)

    // Dual-write: seed the sidecar with default signals for the new file.
    // Mirrors the default scoring applied to markdown frontmatter above.
    await seedSidecarDefaults(runtimeSignalStore, relPathFromContextPath(contextPath, basePath), logger)

    await ensureContextMd(basePath, parsed, topicContext, subtopicContext, onAfterWrite)

    return {
      ...reviewMeta,
      filePath: contextPath,
      message: `Created ${path}/${filename} with ${content.snippets?.length || 0} snippets. Reason: ${reason}`,
      path,
      reason,
      status: 'success',
      summary,
      type: 'ADD',
    }
  } catch (error) {
    return {
      ...reviewMeta,
      message: error instanceof Error ? error.message : String(error),
      path,
      reason,
      status: 'failed',
      type: 'ADD',
    }
  }
}

/**
 * Compute the maximum of two impact levels.
 */
function maxImpact(
  a: 'high' | 'low',
  b: 'high' | 'low',
): 'high' | 'low' {
  const rank = {high: 1, low: 0} as const
  return rank[a] >= rank[b] ? a : b
}

/**
 * Execute UPDATE operation - modify existing {title}.md
 */
async function executeUpdate(
  basePath: string,
  operation: Operation,
  reviewDisabled: boolean,
  onAfterWrite?: WriteCallback,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<OperationResult> {
  const {confidence, content, domainContext, impact, path, reason, subtopicContext, summary, title, topicContext} =
    operation
  // Used for early-exit validation failures (before structural loss can be assessed)
  const baseReviewMeta = deriveReviewMetadata('UPDATE', confidence, impact)

  if (!title) {
    return {
      ...baseReviewMeta,
      message: 'UPDATE operation requires a title',
      path,
      reason,
      status: 'failed',
      type: 'UPDATE',
    }
  }

  if (!content) {
    return {
      ...baseReviewMeta,
      message: 'UPDATE operation requires content',
      path,
      reason,
      status: 'failed',
      type: 'UPDATE',
    }
  }

  try {
    const parsed = parsePath(path)
    if (!parsed) {
      return {
        ...baseReviewMeta,
        message: `Invalid path format: ${path}. Expected domain/topic or domain/topic/subtopic`,
        path,
        reason,
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
        ...baseReviewMeta,
        message: `File does not exist: ${path}/${filename}`,
        path,
        reason,
        status: 'failed',
        type: 'UPDATE',
      }
    }

    await createDomainContextIfMissing(basePath, parsed.domain, domainContext, onAfterWrite)

    // Read existing file to detect structural loss
    const existingContent = await DirectoryManager.readFile(contextPath)

    // Markdown only carries content timestamps post-commit-5. The sidecar
    // handles all scoring (importance / recency / maturity / counts) via
    // `mirrorCurateUpdate` below, inside an atomic read-modify-write.
    const timestamps = {
      createdAt: existingCreatedAt(existingContent),
      updatedAt: new Date().toISOString(),
    }

    // Filter out non-existent files from rawConcept.files
    const filteredContent = await filterValidFiles(content)

    // Extract previous summary from existing file's frontmatter (for review UI)
    const existingParsed = existingContent ? MarkdownWriter.parseContent(existingContent, title) : null
    if (existingParsed?.relations?.length) {
      // Drop legacy dangling refs before conflict-detection; otherwise resolver unions them back.
      existingParsed.relations = existingParsed.relations.filter((r) => !isExcludedFromSync(r))
    }

    const previousSummary = existingParsed?.summary

    // Detect structural loss and auto-resolve: merge back anything the LLM dropped
    const proposedContextData = {
      facts: filteredContent.facts,
      keywords: filteredContent.keywords,
      name: title,
      narrative: filteredContent.narrative,
      rawConcept: filteredContent.rawConcept,
      relations: filteredContent.relations,
      snippets: filteredContent.snippets ?? [],
      tags: filteredContent.tags,
    }

    let resolvedContextData: ContextData = proposedContextData
    let elevatedImpact = impact

    if (existingParsed) {
      const loss = detectStructuralLoss(existingParsed, proposedContextData)
      const structuralImpact = deriveImpactFromLoss(loss)
      elevatedImpact = maxImpact(impact, structuralImpact)
      resolvedContextData = resolveStructuralLoss(existingParsed, proposedContextData, loss)
    }

    const reviewMeta = deriveReviewMetadata('UPDATE', confidence, elevatedImpact)

    const contextContent = MarkdownWriter.generateContext({
      ...resolvedContextData,
      reason,
      summary,
      timestamps,
    })
    await backupBeforeWrite(contextPath, basePath, reviewDisabled)
    await DirectoryManager.writeFileAtomic(contextPath, contextContent)
    onAfterWrite?.(contextPath, contextContent)

    // Dual-write: mirror the curate-update bumps (importance +5, recency=1,
    // updateCount+1, maturity retiered) into the sidecar. `updatedAt` stays
    // in markdown only — it is a content timestamp, not a runtime signal.
    await mirrorCurateUpdate(runtimeSignalStore, relPathFromContextPath(contextPath, basePath), logger)

    await ensureContextMd(basePath, parsed, topicContext, subtopicContext, onAfterWrite)

    return {
      ...reviewMeta,
      filePath: contextPath,
      message: `Updated ${path}/${filename}. Reason: ${reason}`,
      path,
      previousSummary,
      reason,
      status: 'success',
      summary,
      type: 'UPDATE',
    }
  } catch (error) {
    return {
      ...baseReviewMeta,
      message: error instanceof Error ? error.message : String(error),
      path,
      reason,
      status: 'failed',
      type: 'UPDATE',
    }
  }
}

/**
 * Execute UPSERT operation - automatically creates or updates based on file existence
 * This is the recommended operation type as it eliminates the need for pre-checks.
 */
async function executeUpsert(
  basePath: string,
  operation: Operation,
  reviewDisabled: boolean,
  onAfterWrite?: WriteCallback,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<OperationResult> {
  const {path, reason, title} = operation
  const reviewMeta = deriveReviewMetadata('UPSERT', operation.confidence, operation.impact)

  if (!title) {
    return {
      ...reviewMeta,
      message: 'UPSERT operation requires a title',
      path,
      reason,
      status: 'failed',
      type: 'UPSERT',
    }
  }

  if (!operation.content) {
    return {
      ...reviewMeta,
      message: 'UPSERT operation requires content',
      path,
      reason,
      status: 'failed',
      type: 'UPSERT',
    }
  }

  try {
    const parsed = parsePath(path)
    if (!parsed) {
      return {
        ...reviewMeta,
        message: `Invalid path format: ${path}. Expected domain/topic or domain/topic/subtopic`,
        path,
        reason,
        status: 'failed',
        type: 'UPSERT',
      }
    }

    const fullPath = buildFullPath(basePath, path)
    const filename = `${toSnakeCase(title)}.md`
    const contextPath = join(fullPath, filename)

    // Check if file exists to determine ADD vs UPDATE
    const exists = await DirectoryManager.fileExists(contextPath)

    if (exists) {
      // File exists - delegate to UPDATE logic
      const result = await executeUpdate(basePath, {...operation, type: 'UPDATE'}, reviewDisabled, onAfterWrite, runtimeSignalStore, logger)
      // Return with UPSERT type but indicate it was an update
      return {
        ...result,
        message: result.message?.replace('Updated', 'Upserted (updated existing)'),
        type: 'UPSERT',
      }
    }

    // File doesn't exist - delegate to ADD logic
    const result = await executeAdd(basePath, {...operation, type: 'ADD'}, onAfterWrite, runtimeSignalStore, logger)
    // Return with UPSERT type but indicate it was an add
    return {
      ...result,
      message: result.message?.replace('Created', 'Upserted (created new)'),
      type: 'UPSERT',
    }
  } catch (error) {
    return {
      ...reviewMeta,
      message: error instanceof Error ? error.message : String(error),
      path,
      reason,
      status: 'failed',
      type: 'UPSERT',
    }
  }
}

/**
 * Execute MERGE operation - combine source file into target file, delete source file
 */
async function executeMerge(
  basePath: string,
  operation: Operation,
  reviewDisabled: boolean,
  onAfterWrite?: WriteCallback,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<OperationResult> {
  const {
    confidence,
    domainContext,
    impact,
    mergeTarget,
    mergeTargetTitle,
    path,
    reason,
    subtopicContext,
    summary,
    title,
    topicContext,
  } = operation
  const reviewMeta = deriveReviewMetadata('MERGE', confidence, impact)

  if (!title) {
    return {
      ...reviewMeta,
      message: 'MERGE operation requires a title (source file)',
      path,
      reason,
      status: 'failed',
      type: 'MERGE',
    }
  }

  if (!mergeTarget) {
    return {
      ...reviewMeta,
      message: 'MERGE operation requires mergeTarget',
      path,
      reason,
      status: 'failed',
      type: 'MERGE',
    }
  }

  if (!mergeTargetTitle) {
    return {
      ...reviewMeta,
      message: 'MERGE operation requires mergeTargetTitle',
      path,
      reason,
      status: 'failed',
      type: 'MERGE',
    }
  }

  try {
    const sourceParsed = parsePath(path)
    const targetParsed = parsePath(mergeTarget)

    if (!sourceParsed || !targetParsed) {
      return {
        ...reviewMeta,
        message: `Invalid path format. Expected domain/topic or domain/topic/subtopic`,
        path,
        reason,
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
        ...reviewMeta,
        message: `Source file does not exist: ${path}/${sourceFilename}`,
        path,
        reason,
        status: 'failed',
        type: 'MERGE',
      }
    }

    if (!targetExists) {
      return {
        ...reviewMeta,
        message: `Target file does not exist: ${mergeTarget}/${targetFilename}`,
        path,
        reason,
        status: 'failed',
        type: 'MERGE',
      }
    }

    await createDomainContextIfMissing(basePath, sourceParsed.domain, domainContext, onAfterWrite)
    await createDomainContextIfMissing(basePath, targetParsed.domain, domainContext, onAfterWrite)

    const sourceContent = await DirectoryManager.readFile(sourceContextPath)
    const targetContent = await DirectoryManager.readFile(targetContextPath)

    // Extract previous summary from target file (for review UI)
    const targetParsedContent = MarkdownWriter.parseContent(targetContent, mergeTargetTitle)
    const previousSummary = targetParsedContent.summary

    // Backup both files before merge modifies target and deletes source
    await backupBeforeWrite(targetContextPath, basePath, reviewDisabled)
    await backupBeforeWrite(sourceContextPath, basePath, reviewDisabled)

    // Capture source sidecar signals BEFORE any destructive operation so a
    // mid-flow crash cannot leave the target unmerged with an orphaned
    // source entry. The sidecar merge happens after the markdown writes
    // succeed, using the captured snapshot.
    const sourceRelPath = relPathFromContextPath(sourceContextPath, basePath)
    const targetRelPath = relPathFromContextPath(targetContextPath, basePath)
    const sourceSignalsSnapshot = runtimeSignalStore
      ? await runtimeSignalStore.get(sourceRelPath)
      : null

    const mergedContent = MarkdownWriter.mergeContexts(sourceContent, targetContent, reason, summary)
    await DirectoryManager.writeFileAtomic(targetContextPath, mergedContent)
    onAfterWrite?.(targetContextPath, mergedContent)

    await DirectoryManager.deleteFile(sourceContextPath)
    await deleteDerivedSiblings(sourceContextPath)

    // Dual-write: merge sidecar signals using `mergeScoring` (the canonical
    // merge policy). Runs inside `update`'s atomic callback so a concurrent
    // access-hit flush on the target cannot lose bumps.
    //
    // The target-update and source-delete are wrapped in separate try/catch
    // blocks so an operator can tell which half failed. If update succeeds
    // but delete throws the source sidecar entry becomes an orphan (source
    // markdown is already gone, nothing will ever overwrite it). Tracked by
    // pruneOrphans in the backlog.
    if (runtimeSignalStore && sourceSignalsSnapshot) {
      let targetUpdated = false
      try {
        await runtimeSignalStore.update(targetRelPath, (current: RuntimeSignals): RuntimeSignals => {
          const merged = mergeScoring(sourceSignalsSnapshot, current)
          return {
            accessCount: merged.accessCount,
            importance: merged.importance,
            maturity: determineTier(merged.importance, merged.maturity),
            recency: merged.recency,
            updateCount: merged.updateCount,
          }
        })
        targetUpdated = true
      } catch (error) {
        // Best-effort — markdown merge already succeeded.
        warnSidecarFailure(logger, CURATE_SITE, 'merge-update', `${sourceRelPath} -> ${targetRelPath}`, error)
      }

      if (targetUpdated) {
        try {
          await runtimeSignalStore.delete(sourceRelPath)
        } catch (error) {
          // Source sidecar is now a permanent orphan until pruneOrphans runs.
          warnSidecarFailure(logger, CURATE_SITE, 'merge-delete', sourceRelPath, error)
        }
      }
    }

    await ensureContextMd(basePath, sourceParsed, topicContext, subtopicContext, onAfterWrite)
    await ensureContextMd(basePath, targetParsed, topicContext, subtopicContext, onAfterWrite)

    return {
      ...reviewMeta,
      additionalFilePaths: [sourceContextPath],
      filePath: targetContextPath,
      message: `Merged ${path}/${sourceFilename} into ${mergeTarget}/${targetFilename}. Reason: ${reason}`,
      path,
      previousSummary,
      reason,
      status: 'success',
      summary,
      type: 'MERGE',
    }
  } catch (error) {
    return {
      ...reviewMeta,
      message: error instanceof Error ? error.message : String(error),
      path,
      reason,
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
  reviewDisabled: boolean,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<OperationResult> {
  const {path, reason, title} = operation
  const reviewMeta = deriveReviewMetadata('DELETE', operation.confidence, operation.impact)

  try {
    const fullPath = buildFullPath(basePath, path)

    if (title) {
      // Delete specific file
      const filename = `${toSnakeCase(title)}.md`
      const filePath = join(fullPath, filename)

      const exists = await DirectoryManager.fileExists(filePath)
      if (!exists) {
        return {
          ...reviewMeta,
          message: `File does not exist: ${path}/${filename}`,
          path,
          reason,
          status: 'failed',
          type: 'DELETE',
        }
      }

      // Extract previous summary from file being deleted (for review UI)
      let previousSummary: string | undefined
      try {
        const existingContent = await DirectoryManager.readFile(filePath)
        if (existingContent) {
          previousSummary = MarkdownWriter.parseContent(existingContent, title).summary
        }
      } catch {
        // Best-effort: summary extraction failure must never block delete
      }

      await backupBeforeWrite(filePath, basePath, reviewDisabled)
      await DirectoryManager.deleteFile(filePath)
      await deleteDerivedSiblings(filePath)

      // Dual-write: drop the deleted file's sidecar entry so it does not
      // become an orphan.
      await dropSidecar(runtimeSignalStore, relPathFromContextPath(filePath, basePath), logger)

      return {
        ...reviewMeta,
        filePath,
        message: `Deleted ${path}/${filename}. Reason: ${reason}`,
        path,
        previousSummary,
        reason,
        status: 'success',
        type: 'DELETE',
      }
    }

    // Delete entire folder (when no title provided)
    const exists = await DirectoryManager.folderExists(fullPath)
    if (!exists) {
      return {
        ...reviewMeta,
        message: `Folder does not exist: ${path}`,
        path,
        reason,
        status: 'failed',
        type: 'DELETE',
      }
    }

    // Backup all markdown files in the folder before deleting
    const mdFiles = await DirectoryManager.listMarkdownFiles(fullPath)

    // Extract previous summary as bullet list of individual file summaries (for review UI)
    let previousSummary: string | undefined
    try {
      const contentFiles = mdFiles.filter((f) => {
        const name = basename(f)
        return name !== '_index.md' && name !== 'context.md'
      })
      const contents = await Promise.all(
        contentFiles.map(async (f) => ({content: await DirectoryManager.readFile(f), name: basename(f)})),
      )
      const bullets = contents
        .filter((c): c is {content: string; name: string} => c.content !== null && c.content !== undefined)
        .map((c) => ({name: c.name, summary: MarkdownWriter.parseContent(c.content, c.name.replace(/\.md$/, '')).summary}))
        .filter((c): c is {name: string; summary: string} => c.summary !== undefined)
        .map((c) => `- ${c.name.replace(/\.md$/, '').replaceAll('_', ' ')}: ${c.summary}`)

      if (bullets.length > 0) {
        previousSummary = bullets.join('\n')
      }
    } catch {
      // Best-effort: summary extraction failure must never block delete
    }

    await Promise.all(mdFiles.map((f) => backupBeforeWrite(f, basePath, reviewDisabled)))
    await DirectoryManager.deleteTopicRecursive(fullPath)

    // Dual-write: drop sidecar entries for every markdown file that was
    // deleted. Without this, folder deletes leak orphan signal entries.
    // Best-effort — the markdown delete has already succeeded.
    if (runtimeSignalStore) {
      await Promise.all(
        mdFiles.map((f) => dropSidecar(runtimeSignalStore, relPathFromContextPath(f, basePath), logger)),
      )
    }

    return {
      ...reviewMeta,
      additionalFilePaths: mdFiles,
      filePath: fullPath,
      message: `Deleted folder ${path}. Reason: ${reason}`,
      path,
      previousSummary,
      reason,
      status: 'success',
      type: 'DELETE',
    }
  } catch (error) {
    return {
      ...reviewMeta,
      message: error instanceof Error ? error.message : String(error),
      path,
      reason,
      status: 'failed',
      type: 'DELETE',
    }
  }
}

/**
 * Execute curate operations on knowledge topics.
 * Exported for use by CurateService in sandbox.
 */
export async function executeCurate(
  input: unknown,
  _context?: ToolExecutionContext,
  abstractQueue?: AbstractGenerationQueue,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<CurateOutput> {
  const parseResult = CurateInputSchema.safeParse(input)
  if (!parseResult.success) {
    return {
      applied: [
        {
          confidence: 'high',
          impact: 'low',
          message: `Invalid input: ${parseResult.error.message}`,
          needsReview: false,
          path: '',
          reason: '',
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

  // Prefer the daemon-stamped value (snapshotted at task-create on the daemon side,
  // forwarded via TaskExecute, opened as an AsyncLocalStorage scope in agent-process so
  // it propagates through any async chain — direct tool call, sandbox `tools.curate(...)`
  // via CurateService, or ingest-resource-tool). The `.brv/config.json` read is the
  // fall-back for callers outside any scope. Sharing one value across daemon
  // (CurateLogHandler) and agent (this tool) keeps reviewStatus and backups consistent:
  // without it, a user toggle mid-task could mark ops as pending review (daemon snapshot
  // held) while skipping backups (agent re-read picks up new value), making rejection
  // un-restorable.
  const scopedReviewDisabled = getCurrentReviewDisabled()
  const reviewDisabled = scopedReviewDisabled ?? (await isReviewDisabledForBrvDir(dirname(resolve(basePath))))

  const onAfterWrite: undefined | WriteCallback = abstractQueue
    ? (contextPath, content) => abstractQueue.enqueue({contextPath, fullContent: content})
    : undefined

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
        result = await executeAdd(basePath, operation, onAfterWrite, runtimeSignalStore, logger)

        if (result.status === 'success') summary.added++

        break
      }

      case 'DELETE': {
        result = await executeDelete(basePath, operation, reviewDisabled, runtimeSignalStore, logger)

        if (result.status === 'success') summary.deleted++

        break
      }

      case 'MERGE': {
        result = await executeMerge(basePath, operation, reviewDisabled, onAfterWrite, runtimeSignalStore, logger)

        if (result.status === 'success') summary.merged++

        break
      }

      case 'UPDATE': {
        result = await executeUpdate(basePath, operation, reviewDisabled, onAfterWrite, runtimeSignalStore, logger)

        if (result.status === 'success') summary.updated++

        break
      }

      case 'UPSERT': {
        result = await executeUpsert(basePath, operation, reviewDisabled, onAfterWrite, runtimeSignalStore, logger)

        // UPSERT counts as either added or updated based on what happened
        if (result.status === 'success') {
          if (result.message?.includes('created new')) {
            summary.added++
          } else {
            summary.updated++
          }
        }

        break
      }

      default: {
        // Exhaustive type check - TypeScript will error if any case is missed
        const exhaustiveCheck: never = operation.type
        result = {
          confidence: 'high',
          impact: 'low',
          message: `Unknown operation type: ${exhaustiveCheck}`,
          needsReview: false,
          path: operation.path,
          reason: operation.reason,
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

export function createCurateTool(
  workingDirectory?: string,
  abstractQueue?: AbstractGenerationQueue,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Tool {
  return {
    description: `Curate knowledge topics with atomic operations. This tool manages the knowledge structure using four operation types and supports a two-part context model: Raw Concept + Narrative.

**Content Structure (Two-Part Model + Facts):**
- **rawConcept**: Captures essential metadata and context footprint
  - task: What is being documented
  - changes: Array of changes or updates (e.g., code changes, process updates, market shifts)
  - files: Related documents, source files, or resources
  - flow: The process flow or workflow
  - timestamp: When created/modified (ISO 8601 format)
- **narrative**: Captures descriptive and structural context
  - structure: Structural or organizational documentation
  - dependencies: Dependency or relationship information
  - highlights: Key highlights, capabilities, deliverables, or notable outcomes
  - diagrams: Array of diagrams with {type: "mermaid"|"plantuml"|"ascii"|"other", content: string, title?: string} - preserve verbatim
- **facts**: Array of factual statements extracted from content
  - statement (required): The full fact text (e.g., "My name is Andy", "We use PostgreSQL 15")
  - category (optional): "personal", "project", "preference", "convention", "team", "environment", "other"
  - subject (optional): What the fact is about in snake_case (e.g., "user_name", "database")
  - value (optional): The extracted value (e.g., "Andy", "PostgreSQL 15")
- **snippets**: Code/text snippets (legacy support)
- **relations**: Related topics using @domain/topic notation

**Operations:**
1. **ADD** - Create new titled context file in domain/topic/subtopic
   - Requires: path, title, content, confidence, impact, reason
   - Relations must be in the format of "domain/topic/title.md" or "domain/topic/subtopic/title.md"
   - Example with Raw Concept + Narrative:
     {
       type: "ADD",
       path: "structure/caching",
       title: "Redis User Permissions",
       confidence: "high",
       impact: "medium",
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
           highlights: "# Authorization\\n- User permission can be stale for up to 300 seconds"
         },
         relations: ["structure/api-endpoints/validation.md", "structure/api-endpoints/error-handling/retry-logic.md"]
       },
       reason: "Introduced after team discussion in PR #42: chose Redis over in-process cache to share state across replicas. The 5-minute staleness was a deliberate trade-off, not an oversight — future agents should not 'fix' it."
     }
   - Creates: structure/caching/redis_user_permissions.md

2. **UPDATE** - Modify existing titled context file (full replacement)
   - Requires: path, title, content, confidence, impact, reason
   - Relations must be in the format of "domain/topic/title.md" or "domain/topic/subtopic/title.md"
   - Supports same content structure as ADD
   - reason example: \`"Token expiry was changed from 1h to 15min in the security audit (Jira SEC-204). Updated to reflect the new default and the reasoning: shorter TTL reduces blast radius of leaked tokens."\`

3. **MERGE** - Combine source file into target file, delete source
   - Requires: path (source), title (source file), mergeTarget (destination path), mergeTargetTitle (destination file), confidence, impact, reason
   - Example: { type: "MERGE", path: "code_style/old_topic", title: "Old Guide", mergeTarget: "code_style/new_topic", mergeTargetTitle: "New Guide", confidence: "high", impact: "medium", reason: "Both files cover the same conventions; merging keeps a single source of truth and avoids contradictions." }
   - Raw concepts and narratives are intelligently merged

4. **DELETE** - Remove specific file or entire folder
   - Requires: path, title (optional), confidence, impact, reason
   - With title: deletes specific file; without title: deletes entire folder
   - Example: { type: "DELETE", path: "auth/legacy", title: "Session Token Flow", confidence: "high", impact: "high", reason: "Session-based auth was fully replaced by JWT in v2.0 (PR #88). Keeping this would mislead future agents into thinking sessions are still in use." }

**Review Metadata (per operation — always provide these):**
- **confidence**: How confident you are in the accuracy/completeness of this knowledge.
  - \`"high"\`: You have direct evidence from the source material, codebase, or conversation.
  - \`"low"\`: The information is inferred, partially known, or uncertain.
- **impact**: The scope of this knowledge change.
  - \`"high"\`: A deletion, or a major architectural/structural change.
  - \`"medium"\`: A significant update to existing knowledge.
  - \`"low"\`: A new addition or minor update.
- **reason**: The human-readable motivation for this curation. This is the most important review field — a human reviewer will read it in the web inbox to decide whether to approve, edit, or reject the change.
  - **Capture the WHY, not the what.** The what is already encoded in type, path, title, and content. The reason should answer: *What triggered this? What decision was made? What context would be lost without this knowledge?*
  - **Write for a future human or agent reader**, not for yourself in the moment. Ask: "If someone reads this 6 months from now with no context, will they understand why this knowledge exists and why it should not be changed?"
  - **Include trade-offs and intent.** If a decision was deliberate (a performance trade-off, a rejected alternative, a known limitation), say so explicitly — this prevents future agents from "fixing" something that was intentional.
  - Good: \`"Decided in PR #42 to use Redis over in-process cache to share state across replicas. The 5-min staleness is a deliberate trade-off — do not optimize it away."\`
  - Good: \`"Session auth was fully removed in v2.0; keeping this doc would mislead future agents into thinking it's still active."\`
  - Bad: \`"Updating caching docs"\` — describes the operation, not the motivation
  - Bad: \`"New pattern"\` — vague, gives a reviewer nothing to evaluate
- Low-confidence or DELETE operations are automatically flagged for human review in the web inbox after \`brv push\`.

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
- Examples of good domain names: architecture, market_trends, risk_analysis, portfolio_management, error_handling
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
- Domain context.md is only created when domainContext is explicitly provided. No automatic template generation.

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
- Topic context.md is only created when topicContext is explicitly provided. No automatic template generation.

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
- Subtopic context.md is only created when subtopicContext is explicitly provided. No automatic template generation.

**Backward Compatibility:** Existing context entries using only snippets and relations continue to work.

**Output:** Returns applied operations with status (success/failed), filePath (for created/modified files), and a summary of counts.`,

    async execute(input: unknown, context?: ToolExecutionContext): Promise<CurateOutput> {
      if (workingDirectory) {
        // Resolve relative basePath against working directory before executing
        const parseResult = CurateInputSchema.safeParse(input)
        if (parseResult.success) {
          parseResult.data.basePath = resolve(workingDirectory, parseResult.data.basePath)

          return executeCurate(parseResult.data, context, abstractQueue, runtimeSignalStore, logger)
        }
      }

      return executeCurate(input, context, abstractQueue, runtimeSignalStore, logger)
    },

    id: ToolName.CURATE,
    inputSchema: CurateInputSchema,
  }
}
