import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'

/**
 * Result from abstract generation.
 */
export interface AbstractGenerateResult {
  /** L0: one-line summary (~80 tokens) */
  abstractContent: string
  /** L1: key points + structure (~1500 tokens) */
  overviewContent: string
}

const ABSTRACT_SYSTEM_PROMPT = `You are a technical documentation assistant.
Your job is to produce precise, factual summaries of knowledge documents.
Output only the requested content — no preamble, no commentary.`

const OVERVIEW_SYSTEM_PROMPT = `You are a technical documentation assistant.
Your job is to produce structured overviews of knowledge documents.
Preserve factual accuracy, surface important entities and decisions, and format the result in concise markdown.`

function buildAbstractPrompt(content: string): string {
  return `Produce a ONE-LINE summary (max 80 tokens) of the following knowledge document.
The line must be a complete sentence that captures the core topic and key insight.
Output only the single line — nothing else.

<document>
${content}
</document>`
}

function buildOverviewPrompt(content: string): string {
  return `Produce a structured overview of the following knowledge document.
Include:
- Key points (3-7 bullet points)
- Structure / sections summary
- Any notable entities, patterns, or decisions mentioned

Keep it under 1500 tokens. Use markdown formatting.
Output only the overview — no preamble.

<document>
${content}
</document>`
}

/**
 * Generate L0 abstract and L1 overview for a knowledge file.
 *
 * Makes two parallel LLM calls at temperature=0:
 *   1. L0 .abstract.md — one-line summary (~80 tokens)
 *   2. L1 .overview.md — key points + structure (~1500 tokens)
 *
 * @param _contextPath - Path to the context file (unused, reserved for future logging)
 * @param fullContent - Full markdown content of the knowledge file
 * @param generator - LLM content generator
 * @returns Abstract and overview content strings
 */
export async function generateFileAbstracts(
  _contextPath: string,
  fullContent: string,
  generator: IContentGenerator,
): Promise<AbstractGenerateResult> {
  const [abstractResponse, overviewResponse] = await Promise.all([
    generator.generateContent({
      config: {maxTokens: 150, temperature: 0},
      contents: [{content: buildAbstractPrompt(fullContent), role: 'user'}],
      model: 'default',
      systemPrompt: ABSTRACT_SYSTEM_PROMPT,
      taskId: randomUUID(),
    }),
    generator.generateContent({
      config: {maxTokens: 2000, temperature: 0},
      contents: [{content: buildOverviewPrompt(fullContent), role: 'user'}],
      model: 'default',
      systemPrompt: OVERVIEW_SYSTEM_PROMPT,
      taskId: randomUUID(),
    }),
  ])

  return {
    abstractContent: abstractResponse.content.trim(),
    overviewContent: overviewResponse.content.trim(),
  }
}
