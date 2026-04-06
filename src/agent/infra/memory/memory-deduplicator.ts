import {randomUUID} from 'node:crypto'

import type {Memory} from '../../core/domain/memory/types.js'
import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'

import {streamToText} from '../llm/stream-to-text.js'

/**
 * A draft memory extracted from a session, before deduplication.
 */
export interface DraftMemory {
  category: string
  content: string
  tags?: string[]
}

/**
 * Deduplication decision for a single draft memory.
 */
export type DeduplicationAction =
  | {action: 'CREATE'; memory: DraftMemory}
  | {action: 'MERGE'; memory: DraftMemory; mergedContent: string; targetId: string}
  | {action: 'SKIP'; memory: DraftMemory}

const SYSTEM_PROMPT = `You are a memory deduplication assistant. Given a new draft memory and a list of existing memories, decide one of:
- CREATE: the draft is new and should be stored as-is
- MERGE: the draft overlaps with an existing memory; provide merged content
- SKIP: the draft is already covered by an existing memory

Respond with ONLY a JSON object:
{"action": "CREATE"}
{"action": "MERGE", "targetId": "<id>", "mergedContent": "<combined content>"}
{"action": "SKIP"}`

const DEDUPLICATION_CONCURRENCY = 4

/**
 * LLM-based deduplicator for agent-extracted memories.
 *
 * For each draft, checks against existing memories via an LLM call.
 * DECISIONS category drafts always result in CREATE (immutable log).
 */
export class MemoryDeduplicator {
  constructor(private readonly generator: IContentGenerator) {}

  /**
   * Deduplicate a list of draft memories against existing stored memories.
   *
   * @param drafts - Draft memories to check
   * @param existing - Existing memories to compare against
   * @returns Deduplication action for each draft
   */
  async deduplicate(drafts: DraftMemory[], existing: Memory[]): Promise<DeduplicationAction[]> {
    if (existing.length === 0) {
      return drafts.map((memory) => ({action: 'CREATE', memory}))
    }

    const actions = Array.from<DeduplicationAction>({length: drafts.length})
    const concurrency = Math.min(DEDUPLICATION_CONCURRENCY, drafts.length)

    const worker = async (workerIndex: number): Promise<void> => {
      for (let draftIndex = workerIndex; draftIndex < drafts.length; draftIndex += concurrency) {
        const draft = drafts[draftIndex]
        if (draft.category === 'DECISIONS') {
          actions[draftIndex] = {action: 'CREATE', memory: draft}
          continue
        }

        // eslint-disable-next-line no-await-in-loop
        actions[draftIndex] = await this.deduplicateSingle(draft, existing)
      }
    }

    await Promise.all(
      Array.from({length: concurrency}, async (_, workerIndex) => worker(workerIndex)),
    )

    return actions
  }

  private async deduplicateSingle(draft: DraftMemory, existing: Memory[]): Promise<DeduplicationAction> {
    const existingSummary = existing
      .map((m) => `[id:${m.id}] ${m.content.slice(0, 300)}`)
      .join('\n---\n')

    const prompt = `## Draft Memory (category: ${draft.category})
${draft.content}

## Existing Memories
${existingSummary}

Decide: CREATE, MERGE (with targetId and mergedContent), or SKIP.`

    try {
      // Use streaming — ChatGPT OAuth Codex endpoint requires stream: true
      const responseText = await streamToText(this.generator, {
        config: {maxTokens: 300, temperature: 0},
        contents: [{content: prompt, role: 'user'}],
        model: 'default',
        systemPrompt: SYSTEM_PROMPT,
        taskId: randomUUID(),
      })

      // Strip markdown code fences — some providers wrap JSON in ```json ... ```
      const jsonText = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

      const parsed = JSON.parse(jsonText) as {
        action: 'CREATE' | 'MERGE' | 'SKIP'
        mergedContent?: string
        targetId?: string
      }

      const targetExists = parsed.targetId ? existing.some((memory) => memory.id === parsed.targetId) : false

      if (parsed.action === 'MERGE' && targetExists && parsed.mergedContent && parsed.targetId) {
        return {action: 'MERGE', memory: draft, mergedContent: parsed.mergedContent, targetId: parsed.targetId}
      }

      if (parsed.action === 'SKIP') {
        return {action: 'SKIP', memory: draft}
      }

      return {action: 'CREATE', memory: draft}
    } catch (error) {
      // On any error, default to CREATE (fail-open)
      const msg = error instanceof Error ? error.message : String(error)
      console.debug(`[MemoryDeduplicator] Failed for ${draft.category}: ${msg}`)

      return {action: 'CREATE', memory: draft}
    }
  }
}
