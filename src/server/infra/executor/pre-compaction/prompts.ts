/**
 * Compaction prompts for pre-curation context compaction.
 *
 * Self-contained prompts that steer the LLM away from query-mode policy
 * (which would try to search the KB). The real guardrail against
 * non-compaction responses is isCompactionOutputValid().
 */

/**
 * Build the system prompt for compaction.
 *
 * Opens with a clear, self-contained instruction that overrides
 * query-mode's "answers from KB only" rules. Note: prompt-level override
 * is best-effort; isCompactionOutputValid() is the actual guardrail.
 */
export function buildCompactionSystemPrompt(): string {
  return `You are a knowledge extraction pre-processor. Your ONLY task is to compact the provided text.

## Rules
- PRESERVE: facts, decisions, code examples, API signatures, diagrams (verbatim), tables (all rows), procedures, file paths, configurations, error patterns
- REMOVE: conversational filler, repeated explanations, verbose tool call descriptions, meta-commentary, acknowledgments
- Output clean structured markdown
- Do NOT wrap output in code blocks or XML tags
- Do NOT search any knowledge base
- Do NOT answer questions about the content
- Do NOT use any tools
- Output ONLY the compacted text`
}

/**
 * Build the user message for a compaction pass.
 *
 * Wraps the context in <source_content> tags for clear delimitation.
 *
 * @param context - The source text to compact
 * @param aggressive - Whether this is the aggressive (pass 2) attempt
 */
export function buildCompactionUserMessage(context: string, aggressive: boolean): string {
  const instruction = aggressive
    ? 'Compact the following text MORE AGGRESSIVELY. A previous compaction attempt was not short enough. Remove all non-essential detail while keeping core facts, decisions, and code.'
    : 'Compact the following text while preserving all knowledge-worthy information — facts, decisions, code, configurations, procedures.'

  return `${instruction}

<source_content>
${context}
</source_content>

Output ONLY the compacted text. Do NOT use any tools.`
}
