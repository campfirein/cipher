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

import type {GenerateResponse, StreamOptions} from '../../../../agent/core/domain/streaming/types.js'
import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
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

/**
 * Execute a curation task using a harness template for guidance.
 *
 * The template strategy is prepended to the existing guidance prompt,
 * and the agent runs with reduced maxIterations. Both fast path and
 * normal path use generate() for consistent feedback extraction.
 *
 * @param agent - CipherAgent instance
 * @param templateNode - Selected harness node with strategy template
 * @param basePrompt - Existing curation guidance prompt (lines 106-117)
 * @param taskSessionId - Task session ID (already created by caller)
 * @param taskId - Task identifier for event routing
 * @returns GenerateResponse with toolCalls for feedback extraction
 */
export async function executeWithTemplate(
  agent: ICipherAgent,
  templateNode: HarnessNode,
  basePrompt: string,
  taskSessionId: string,
  taskId: string,
): Promise<GenerateResponse> {
  // Use generate() (not executeOnSession()) to get toolCalls[].result.data
  return agent.generate(
    buildTemplatePrompt(templateNode, basePrompt),
    buildTemplateStreamOptions(taskSessionId, taskId),
  )
}
