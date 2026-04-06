import {randomUUID} from 'node:crypto'

import type {Memory} from '../../core/domain/memory/types.js'
import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'
import type {InternalMessage} from '../../core/interfaces/message-types.js'
import type {DraftMemory,MemoryDeduplicator} from '../memory/memory-deduplicator.js'
import type {MemoryManager} from '../memory/memory-manager.js'

import {streamToText} from '../llm/stream-to-text.js'

/**
 * Result of a session compression pass.
 */
export interface CompressionResult {
  created: number
  merged: number
  skipped: number
}

/**
 * Five extraction categories for ByteRover session memories.
 */
const CATEGORIES = ['DECISIONS', 'ENTITIES', 'PATTERNS', 'PREFERENCES', 'SKILLS'] as const

const SYSTEM_PROMPT = `You are a session memory extractor for ByteRover, a code intelligence tool.
Extract reusable memories from the conversation in exactly these 5 categories:
- PATTERNS: reusable code or workflow patterns discovered
- PREFERENCES: user style/naming/structure decisions
- ENTITIES: key files, modules, APIs, dependencies discovered
- DECISIONS: architectural choices (always extract, even if already known — immutable log)
- SKILLS: tool invocation recipes that worked

Return ONLY a JSON array of memory objects:
[{"category": "PATTERNS", "content": "...", "tags": ["optional"]}, ...]

Extract 0-3 memories per category. Skip categories with nothing new. Be concise (max 200 chars per memory).`

const MAX_DIGEST_CHARS = 12_000
const FALLBACK_DIGEST_PREVIEW_CHARS = 4000
const MIN_BOUNDARY_RATIO = 0.6
const SOURCE_PATH_PATTERN = /\b(?:src|app|lib|packages|docs|test|tests)\/[A-Za-z0-9_./-]+\b/g

function truncateDigestAtBoundary(digest: string, maxChars: number = MAX_DIGEST_CHARS): string {
  if (digest.length <= maxChars) {
    return digest
  }

  const clipped = digest.slice(0, maxChars)
  const boundary = clipped.lastIndexOf('\n\n')
  // Prefer a natural message boundary when it falls reasonably close to the cap.
  return boundary >= Math.floor(maxChars * MIN_BOUNDARY_RATIO) ? clipped.slice(0, boundary) : clipped
}

/**
 * Extracts and persists memories from a completed task session.
 *
 * Flow:
 * 1. Serialize session messages into a text digest
 * 2. LLM call: extract 5-category draft memories
 * 3. Load existing agent memories for deduplication
 * 4. Apply deduplication decisions (CREATE/MERGE/SKIP)
 */
export class SessionCompressor {
  constructor(
    private readonly deduplicator: MemoryDeduplicator,
    private readonly generator: IContentGenerator,
    private readonly memoryManager: MemoryManager,
  ) {}

  /**
   * Compress a session into persistent memories.
   *
   * @param messages - Session message history
   * @param commandType - Session command type (e.g. 'curate', 'query')
   * @param options - Compression options
   * @param options.minMessages - Minimum message count required before compression runs
   * @returns Summary of actions taken
   */
  async compress(
    messages: InternalMessage[],
    commandType: string,
    options?: {minMessages?: number},
  ): Promise<CompressionResult> {
    const minMessages = options?.minMessages ?? 4
    const hasAssistantContent = messages.some((message) => (
      message.role === 'assistant' &&
      getMessageText(message).trim().length > 0
    ))
    const effectiveMinMessages = commandType.startsWith('curate') && hasAssistantContent
      ? Math.min(minMessages, 1)
      : minMessages
    if (messages.length < effectiveMinMessages) {
      return {created: 0, merged: 0, skipped: 0}
    }

    const digest = this.serializeMessages(messages)
    if (!digest.trim()) {
      return {created: 0, merged: 0, skipped: 0}
    }

    // Step 1: Extract draft memories via LLM
    const useFallbackDraftsFirst = shouldPreferFallbackDrafts(commandType)
    let drafts = useFallbackDraftsFirst ? this.buildFallbackDrafts(digest, commandType) : await this.extractDrafts(digest, commandType)
    let usedFallbackDrafts = useFallbackDraftsFirst && drafts.length > 0
    if (drafts.length === 0) {
      drafts = this.buildFallbackDrafts(digest, commandType)
      usedFallbackDrafts = drafts.length > 0
    }

    if (drafts.length === 0) {
      return {created: 0, merged: 0, skipped: 0}
    }

    // Step 2: Load the most recently updated agent memories for deduplication.
    // MemoryManager.list() sorts by updatedAt DESC before applying the limit.
    const existing = await this.memoryManager.list({limit: 60, source: 'agent'})

    // Step 3: Deduplicate
    const actions = usedFallbackDrafts
      ? this.deduplicateFallbackDrafts(drafts, existing)
      : await this.deduplicator.deduplicate(drafts, existing)

    // Step 4: Apply decisions
    let created = 0
    let merged = 0
    let skipped = 0

    /* eslint-disable no-await-in-loop */
    for (const action of actions) {
      try {
        if (action.action === 'CREATE') {
          await this.memoryManager.create({
            content: action.memory.content,
            metadata: {category: action.memory.category, source: 'agent'},
            tags: action.memory.tags,
          })
          created++
        } else if (action.action === 'MERGE') {
          await this.memoryManager.update(action.targetId, {content: action.mergedContent})
          merged++
        } else {
          skipped++
        }
      } catch (error) {
        // Fail-open: skip individual memory errors
        const msg = error instanceof Error ? error.message : String(error)
        console.debug(`[SessionCompressor] Failed to apply ${action.action} action: ${msg}`)
        skipped++
      }
    }
    /* eslint-enable no-await-in-loop */

    return {created, merged, skipped}
  }

  private buildFallbackDrafts(digest: string, commandType: string): DraftMemory[] {
    if (!commandType.startsWith('curate')) {
      return []
    }

    const preview = digest.slice(0, FALLBACK_DIGEST_PREVIEW_CHARS)
    const fingerprint = computeFingerprint(preview)
    const sourcePaths = [...new Set((preview.match(SOURCE_PATH_PATTERN) ?? []).filter((path) => !path.startsWith('.brv/')))]
    const moduleLabel = deriveModuleLabel(sourcePaths)
    const tags = moduleLabel === 'the working module' ? undefined : [moduleLabel]

    return [
      {
        category: 'DECISIONS',
        content: `Session ${fingerprint}: curated ${moduleLabel} knowledge into the context tree.`,
        tags,
      },
      {
        category: 'DECISIONS',
        content: `Session ${fingerprint}: preserved ${moduleLabel} findings as durable knowledge instead of chat-only context.`,
        tags,
      },
      {
        category: 'PATTERNS',
        content: `Session ${fingerprint}: used recon -> extraction -> curate apply workflow for ${moduleLabel}.`,
        tags,
      },
      {
        category: 'PATTERNS',
        content: `Session ${fingerprint}: separated durable notes from raw source snippets while curating ${moduleLabel}.`,
        tags,
      },
      {
        category: 'SKILLS',
        content: `Session ${fingerprint}: start ${commandType} with tools.curation.recon, then mapExtract, then verify applied file paths.`,
        tags,
      },
      {
        category: 'ENTITIES',
        content: `${moduleLabel} is an actively curated module surfaced during ${commandType}.`,
        tags,
      },
    ]
  }

  private deduplicateFallbackDrafts(drafts: DraftMemory[], existing: Memory[]) {
    const dedupCategories = ['ENTITIES', 'PATTERNS', 'SKILLS'] as const
    const existingKeys = new Map<string, Set<string>>()
    for (const category of dedupCategories) {
      existingKeys.set(
        category,
        new Set(
          existing
            .filter((memory) => getMemoryCategory(memory) === category)
            .map((memory) => normalizeForFallbackDedup(memory.content, category)),
        ),
      )
    }

    return drafts.map((memory) => {
      // DECISIONS always CREATE — temporal audit records that should accumulate
      if (memory.category === 'DECISIONS') {
        return {action: 'CREATE', memory} as const
      }

      const categorySet = existingKeys.get(memory.category)
      if (!categorySet) {
        return {action: 'CREATE', memory} as const
      }

      const key = normalizeForFallbackDedup(memory.content, memory.category)
      if (categorySet.has(key)) {
        return {action: 'SKIP', memory} as const
      }

      categorySet.add(key)
      return {action: 'CREATE', memory} as const
    })
  }

  private async extractDrafts(digest: string, commandType: string): Promise<DraftMemory[]> {
    try {
      const truncatedDigest = truncateDigestAtBoundary(digest)
      const prompt = `## Session Type: ${commandType}

## Conversation
${truncatedDigest}

Extract reusable memories from this session.`

      // Use streaming — ChatGPT OAuth Codex endpoint requires stream: true
      const responseText = await streamToText(this.generator, {
        config: {maxTokens: 1000, temperature: 0},
        contents: [{content: prompt, role: 'user'}],
        model: 'default',
        systemPrompt: SYSTEM_PROMPT,
        taskId: randomUUID(),
      })

      // Strip markdown code fences — some providers wrap JSON in ```json ... ```
      const jsonText = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

      const parsed = JSON.parse(jsonText) as Array<{
        category: string
        content: string
        tags?: string[]
      }>

      if (!Array.isArray(parsed)) return []

      return parsed
        .filter((item) => CATEGORIES.includes(item.category as (typeof CATEGORIES)[number]) && item.content?.trim())
        .map((item) => ({
          category: item.category,
          content: item.content.trim(),
          tags: item.tags,
        }))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.debug(`[SessionCompressor] Failed to extract drafts (${commandType}): ${msg}`)

      return []
    }
  }

  private serializeMessages(messages: InternalMessage[]): string {
    const lines: string[] = []
    for (const msg of messages) {
      const role = msg.role?.toUpperCase() ?? 'UNKNOWN'
      const text = getMessageText(msg)

      if (text.trim()) {
        lines.push(`[${role}]: ${text.slice(0, 2000)}`)
      }
    }

    return lines.join('\n\n')
  }
}

function getMessageText(message: InternalMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  if (!Array.isArray(message.content)) {
    return ''
  }

  return message.content
    .filter((part) => 'text' in part && typeof part.text === 'string')
    .map((part) => (part as {text: string}).text)
    .join(' ')
}

function computeFingerprint(text: string): string {
  /* eslint-disable no-bitwise, unicorn/prefer-code-point */
  let hash = 0
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  /* eslint-enable no-bitwise, unicorn/prefer-code-point */

  return hash.toString(16).padStart(8, '0').slice(0, 8)
}

function deriveModuleLabel(sourcePaths: string[]): string {
  if (sourcePaths.length === 0) {
    return 'the working module'
  }

  const firstPath = sourcePaths[0]
  const segments = firstPath.split('/').filter(Boolean)
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`
  }

  return firstPath
}

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replaceAll(/\s+/g, ' ')
}

function normalizeForFallbackDedup(content: string, category: string): string {
  let normalized = normalizeMemoryContent(content)
  // PATTERNS and SKILLS are session-fingerprinted ("Session abc123: ...").
  // Strip the prefix so repeated curate sessions on the same module are detected as duplicates.
  if (category === 'PATTERNS' || category === 'SKILLS') {
    normalized = normalized.replace(/^session\s+\S+:\s*/, '')
  }

  return normalized
}

function getMemoryCategory(memory: Memory): string | undefined {
  if (!memory.metadata || typeof memory.metadata !== 'object') {
    return undefined
  }

  const {category} = (memory.metadata as Record<string, unknown>)
  return typeof category === 'string' ? category : undefined
}

// Curate sessions always use deterministic fallback drafts instead of LLM extraction.
// Fallback drafts are faster (no LLM call), cheaper, and produce consistent categorized
// memories that can be deduped via string matching. LLM extraction is reserved for
// non-curate sessions (e.g., query) where conversation content is unpredictable.
function shouldPreferFallbackDrafts(commandType: string): boolean {
  return commandType.startsWith('curate')
}
