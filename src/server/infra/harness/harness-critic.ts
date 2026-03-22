/**
 * LLM-based error consolidation for the AutoHarness refinement loop.
 *
 * Takes a batch of HarnessFeedback entries and produces a summary of
 * failure patterns that can guide template refinement.
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../../agent/core/interfaces/i-content-generator.js'
import type {HarnessFeedback} from '../../core/interfaces/harness/i-harness-feedback.js'

/** Default model to use for critic/refiner calls */
const DEFAULT_HARNESS_MODEL = 'default'

/**
 * Consolidate feedback into a structured summary for the refiner.
 *
 * Includes both explicit failures AND mid-quality shadow evaluations
 * (success=true but F1 < 1.0) to guide improvement of sub-threshold templates.
 *
 * @param contentGenerator - LLM for summarization
 * @param feedbackBatch - Recent feedback entries for this specific node
 * @param templateContent - Current template YAML content
 * @param model - Optional model identifier override
 * @returns A text summary of patterns and improvement suggestions, or empty string if no signal
 */
export async function consolidateErrors(
  contentGenerator: IContentGenerator,
  feedbackBatch: HarnessFeedback[],
  templateContent: string,
  domain?: string,
  model?: string,
): Promise<string> {
  // Include failures AND imperfect shadow evaluations (room for improvement)
  const actionable = feedbackBatch.filter((f) => {
    if (!f.success) return true // explicit failure
    // Shadow mode entries with partial matches indicate room for improvement
    if (f.details.mode === 'shadow' && typeof f.details.f1Score === 'number' && f.details.f1Score < 1) return true

    return false
  })

  if (actionable.length === 0) return ''

  const summaries = actionable.map((f, i) => {
    const label = f.success ? 'Partial match' : 'Failure'

    return `${label} ${i + 1}: ${JSON.stringify(f.details)}`
  }).join('\n')

  const prompt = [
    `You are analyzing performance of a ${domain ?? 'knowledge management'} template.`,
    '',
    '## Current Template',
    '```yaml',
    templateContent,
    '```',
    '',
    '## Recent Evaluations',
    summaries,
    '',
    '## Task',
    'Identify patterns and suggest improvements to the template.',
    'Focus on:',
    '1. Which domain routing rules are missing or too broad?',
    '2. What keywords or patterns in the input data are not covered?',
    '3. Specific YAML changes that would improve domain/path prediction accuracy.',
    '',
    'Respond with a concise summary (max 500 words).',
  ].join('\n')

  const response = await contentGenerator.generateContent({
    config: {maxTokens: 1024, temperature: 0.3},
    contents: [{content: prompt, role: 'user'}],
    model: model ?? DEFAULT_HARNESS_MODEL,
    taskId: randomUUID(),
  })

  return response.content
}
