/**
 * Curation template executor for the AutoHarness fast path.
 *
 * Prepends the template's learned strategy to the user-message prompt.
 * This is NOT system-prompt injection — it's additional text in the user
 * message, same mechanism as the existing guidance prompt (lines 106-117).
 *
 * The template makes the agent faster, not different. It's prompt
 * engineering learned from feedback, not code synthesis.
 */

import type {StreamOptions} from '../../../../agent/core/domain/streaming/types.js'
import type {HarnessNode} from '../../../core/interfaces/harness/i-harness-tree-store.js'

/** Max iterations for template-guided execution (vs 50 for full agent) */
export const TEMPLATE_MAX_ITERATIONS = 10

export function buildTemplatePrompt(templateNode: HarnessNode, basePrompt: string): string {
  return [
    '## Curation Strategy (learned)',
    templateNode.templateContent,
    '',
    basePrompt,
  ].join('\n')
}

export function buildTemplateStreamOptions(taskSessionId: string, taskId: string): StreamOptions {
  return {
    executionContext: {clearHistory: true, commandType: 'curate', maxIterations: TEMPLATE_MAX_ITERATIONS},
    sessionId: taskSessionId,
    taskId,
  }
}

