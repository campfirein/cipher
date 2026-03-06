/**
 * Prompts for hierarchical summary generation (_index.md).
 *
 * Follows the same pattern as pre-compaction prompts: clear system prompt
 * with isCompactionOutputValid() as the actual guardrail.
 */

import type {SummaryLevel} from '../../../core/domain/knowledge/summary-types.js'

/**
 * Build the system prompt for summary generation.
 */
export function buildSummarySystemPrompt(): string {
  return `You are a knowledge summarization engine. Your ONLY task is to create a structural summary of the provided knowledge entries.

## Rules
- Condense child entries into a structural overview preserving key facts, relationships, and patterns
- Reference child entry names so readers know where to drill down for details
- Target compression: ~20-30% of input token count
- PRESERVE: entity names, file paths, API signatures, architectural decisions, key relationships
- DISCARD: verbose examples, repeated explanations, secondary detail, conversational filler
- Output clean structured markdown (headings, bullet points, brief prose)
- Do NOT wrap output in code blocks or XML tags
- Do NOT search any knowledge base or use any tools
- Output ONLY the summary text`
}

/**
 * Build the user message for a summary generation pass.
 *
 * @param childEntries - Array of { name, content } for each child input
 * @param level - The summary level being generated (d1, d2, d3)
 * @param aggressive - Whether this is the aggressive (pass 2) attempt
 */
export function buildSummaryUserMessage(
  childEntries: Array<{content: string; name: string}>,
  level: SummaryLevel,
  aggressive: boolean,
): string {
  const instruction = aggressive
    ? `Create a MORE CONCISE structural summary at level ${level}. A previous attempt was not short enough. Aggressively compress while keeping only the most critical facts and relationships.`
    : `Create a structural summary at level ${level} from the following knowledge entries. Preserve key facts, architectural decisions, and relationships. Reference entry names for drill-down.`

  const entriesText = childEntries
    .map((entry) => `### ${entry.name}\n${entry.content}`)
    .join('\n\n---\n\n')

  return `${instruction}

<child_entries>
${entriesText}
</child_entries>

Output ONLY the summary text. Do NOT use any tools.`
}
