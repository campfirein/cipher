/**
 * LLM-based template refinement for the AutoHarness loop.
 *
 * Takes the current template + critic's error summary and generates
 * an improved child template as YAML configuration.
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../../agent/core/interfaces/i-content-generator.js'

/** Default model to use for critic/refiner calls */
const DEFAULT_HARNESS_MODEL = 'default'

/**
 * Generate an improved template based on the critic's feedback.
 *
 * @param contentGenerator - LLM for generation
 * @param currentTemplate - Current template YAML content
 * @param criticSummary - Error pattern summary from the critic
 * @param domain - Domain identifier for context (e.g., 'curation', 'query/decompose')
 * @returns Improved template YAML content
 */
export async function refineTemplate(
  contentGenerator: IContentGenerator,
  currentTemplate: string,
  criticSummary: string,
  domain: string,
): Promise<string> {
  const prompt = [
    `You are improving a ${domain} template for a knowledge management system.`,
    '',
    '## Current Template',
    '```yaml',
    currentTemplate,
    '```',
    '',
    '## Error Analysis',
    criticSummary,
    '',
    '## Task',
    'Generate an improved version of the template that addresses the identified failures.',
    'Rules:',
    '1. Output ONLY the improved YAML template — no explanations, no markdown fences.',
    '2. Preserve all working rules from the current template.',
    '3. Add or modify rules to address the failure patterns.',
    '4. Keep the same YAML schema/structure as the current template.',
    '5. Be conservative: prefer small targeted changes over rewrites.',
  ].join('\n')

  const response = await contentGenerator.generateContent({
    config: {maxTokens: 2048, temperature: 0.5},
    contents: [{content: prompt, role: 'user'}],
    model: DEFAULT_HARNESS_MODEL,
    taskId: randomUUID(),
  })

  // Strip markdown fences if the LLM wraps the output
  let content = response.content.trim()
  if (content.startsWith('```yaml')) {
    content = content.slice(7)
  } else if (content.startsWith('```')) {
    content = content.slice(3)
  }

  if (content.endsWith('```')) {
    content = content.slice(0, -3)
  }

  return content.trim()
}
