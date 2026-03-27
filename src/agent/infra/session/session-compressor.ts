import {randomUUID} from 'node:crypto'

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
const MIN_BOUNDARY_RATIO = 0.6

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
    if (messages.length < minMessages) {
      return {created: 0, merged: 0, skipped: 0}
    }

    const digest = this.serializeMessages(messages)
    if (!digest.trim()) {
      return {created: 0, merged: 0, skipped: 0}
    }

    // Step 1: Extract draft memories via LLM
    const drafts = await this.extractDrafts(digest, commandType)
    if (drafts.length === 0) {
      return {created: 0, merged: 0, skipped: 0}
    }

    // Step 2: Load the most recently updated agent memories for deduplication.
    // MemoryManager.list() sorts by updatedAt DESC before applying the limit.
    const existing = await this.memoryManager.list({limit: 60, source: 'agent'})

    // Step 3: Deduplicate
    const actions = await this.deduplicator.deduplicate(drafts, existing)

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

      const parsed = JSON.parse(responseText.trim()) as Array<{
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
      let text = ''
      if (typeof msg.content === 'string') {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((p) => 'text' in p && typeof p.text === 'string')
          .map((p) => (p as {text: string}).text)
          .join(' ')
      }

      if (text.trim()) {
        lines.push(`[${role}]: ${text.slice(0, 2000)}`)
      }
    }

    return lines.join('\n\n')
  }
}
