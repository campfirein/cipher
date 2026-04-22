/**
 * AutoHarness V2 — Critic prompt builder.
 *
 * The Critic LLM call diagnoses why a harness version is
 * underperforming by analyzing recent outcomes and evaluation
 * scenarios. Its analysis feeds the Refiner, which produces
 * a candidate replacement.
 *
 * The 8000-char ceiling keeps the prompt within weak models'
 * context windows. If outcomes or parent code are too large,
 * they are truncated with an explicit marker so the LLM knows
 * content was omitted.
 */

import type {
  CodeExecOutcome,
  EvaluationScenario,
} from '../../../core/domain/harness/types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum total prompt length. Prevents context-window overflow on weak models. */
const MAX_PROMPT_LENGTH = 8000

/** Maximum characters allocated to the parent code section. */
const MAX_PARENT_CODE_LENGTH = 2000

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CriticPromptContext {
  readonly heuristic: number
  readonly parentCode: string
  readonly recentOutcomes: readonly CodeExecOutcome[]
  readonly scenarios: readonly EvaluationScenario[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 30) + '\n... [truncated for brevity]'
}

/**
 * Format raw outcomes compactly — one line per outcome with key fields.
 * Preserves all signals (commandType, stderr, executionTimeMs, usedHarness)
 * so the Critic LLM can spot correlations the prompt author didn't anticipate.
 * Overall prompt truncation handles budget; no per-section cap needed.
 */
function formatOutcomes(outcomes: readonly CodeExecOutcome[]): string {
  const lines = outcomes.map((o) => {
    const status = o.success ? 'OK' : 'FAIL'
    const stderr = o.stderr ? ` err="${o.stderr}"` : ''
    return `  [${status}] ${o.commandType} ${o.executionTimeMs.toFixed(0)}ms harness=${o.usedHarness}${stderr}`
  })
  return lines.join('\n')
}

function summarizeScenarios(scenarios: readonly EvaluationScenario[]): string {
  return scenarios
    .map((s, i) => `  ${i + 1}. [${s.commandType}] ${s.taskDescription} — expected: ${s.expectedBehavior}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildCriticPrompt(ctx: CriticPromptContext): string {
  const parentCodeSection = truncate(ctx.parentCode, MAX_PARENT_CODE_LENGTH)
  const outcomesSection = formatOutcomes(ctx.recentOutcomes)
  const scenariosSection = summarizeScenarios(ctx.scenarios)

  const prompt = `You are a harness quality critic. Analyze the following harness version and its recent execution outcomes to identify the root cause of failures.

## Current harness code

\`\`\`js
${parentCodeSection}
\`\`\`

## Performance

Current heuristic score (H): ${ctx.heuristic}
Recent outcomes (${ctx.recentOutcomes.length} total):
${outcomesSection}

## Evaluation scenarios (${ctx.scenarios.length} total)

${scenariosSection}

## Your task

Analyze the harness code, outcomes, and scenarios above. Identify:
1. What failure pattern is most common
2. What the root cause is in the harness code
3. What structural change would fix it

Respond in exactly this format:
# Critic analysis
- Failure pattern: <short description of the most common failure>
- Root cause: <mechanism in the code causing failures>
- Suggested change: <structural hint for the Refiner — what to change, not the full code>`

  return truncate(prompt, MAX_PROMPT_LENGTH)
}
