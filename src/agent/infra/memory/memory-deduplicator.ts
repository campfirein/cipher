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

    const actions: DeduplicationAction[] = []

    /* eslint-disable no-await-in-loop */
    for (const draft of drafts) {
      // DECISIONS are always appended as immutable log entries
      if (draft.category === 'DECISIONS') {
        actions.push({action: 'CREATE', memory: draft})
        continue
      }

      const action = await this.deduplicateSingle(draft, existing)
      actions.push(action)
    }
    /* eslint-enable no-await-in-loop */

    return actions
  }

  private async deduplicateSingle(draft: DraftMemory, existing: Memory[]): Promise<DeduplicationAction> {
    const existingSummary = existing
      .slice(0, 20)
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

      if (parsed.action === 'MERGE' && parsed.targetId && parsed.mergedContent) {
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
