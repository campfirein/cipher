import {randomUUID} from 'node:crypto'

import type {Memory} from '../../core/domain/memory/types.js'
import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'

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
    let nextIndex = 0

    const worker = async (): Promise<void> => {
      while (nextIndex < drafts.length) {
        const draftIndex = nextIndex++
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
      Array.from({length: Math.min(DEDUPLICATION_CONCURRENCY, drafts.length)}, async () => worker()),
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
      const response = await this.generator.generateContent({
        config: {maxTokens: 300, temperature: 0},
        contents: [{content: prompt, role: 'user'}],
        model: 'default',
        systemPrompt: SYSTEM_PROMPT,
        taskId: randomUUID(),
      })

      const parsed = JSON.parse(response.content.trim()) as {
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
    } catch {
      // On any error, default to CREATE (fail-open)
      return {action: 'CREATE', memory: draft}
    }
  }
}
