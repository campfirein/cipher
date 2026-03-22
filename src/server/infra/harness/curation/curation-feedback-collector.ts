/**
 * Builds HarnessFeedback from CurateLogOperation[] extracted via generate().
 *
 * Feedback source: GenerateResponse.toolCalls[].result.data parsed through
 * extractCurateOperations() — the same function CurateLogHandler uses.
 *
 * Known limitation: toolCalls[].result.data is processedOutput.content
 * (stringified, potentially truncated). Zero operations extracted = neutral
 * signal (no alpha/beta update).
 */

import yaml from 'js-yaml'

import type {GenerateResponse} from '../../../../agent/core/domain/streaming/types.js'
import type {CurateLogOperation} from '../../../core/domain/entities/curate-log-entry.js'
import type {HarnessFeedback} from '../../../core/interfaces/harness/i-harness-feedback.js'

import {extractCurateOperations} from '../../../utils/curate-result-parser.js'

/**
 * Extract CurateLogOperation[] from GenerateResponse tool calls.
 *
 * Reuses extractCurateOperations() from curate-result-parser.ts — the same
 * function CurateLogHandler.onToolResult() uses.
 *
 * @param genResponse - GenerateResponse from agent.generate()
 * @returns Array of curate operations (may be empty if truncated/malformed)
 */
export function extractOperationsFromResponse(genResponse: GenerateResponse): CurateLogOperation[] {
  const ops: CurateLogOperation[] = []

  for (const tc of genResponse.toolCalls) {
    // tc.result.data is `unknown` — extractCurateOperations handles type checking
    // internally and returns [] for non-string or malformed data.
    if (tc.result?.data && (tc.toolName === 'curate' || tc.toolName === 'code_exec')) {
      const extracted = extractCurateOperations({result: tc.result.data, toolName: tc.toolName})
      ops.push(...extracted)
    }
  }

  return ops
}

/**
 * Build HarnessFeedback from extracted curate operations.
 *
 * Returns null if zero operations were extracted (truncation/parse failure).
 * The harness treats null as a neutral signal — no alpha/beta update.
 *
 * @param nodeId - The harness node that was used for this execution
 * @param operations - CurateLogOperation[] from extractOperationsFromResponse()
 * @returns HarnessFeedback or null if no signal
 */
export function buildCurationFeedback(
  nodeId: string,
  operations: CurateLogOperation[],
): HarnessFeedback | null {
  if (operations.length === 0) return null

  let successes = 0
  let failures = 0

  for (const op of operations) {
    if (op.status === 'success') {
      successes++
    } else {
      failures++
    }
  }

  return {
    details: {failures, successes, total: operations.length},
    nodeId,
    success: failures === 0 && successes > 0,
    timestamp: Date.now(),
  }
}

/**
 * Score a shadow-mode template by comparing predicted paths against actual operations.
 *
 * Uses F1-score (precision * recall) to avoid rewarding under-predicting templates.
 * Returns null if scoring is not possible (zero actuals, zero predictions, etc.).
 *
 * @param predictions - Paths the template predicted would be created/updated
 * @param actuals - Actual CurateLogOperation[] from the real execution
 * @returns Alpha/beta increments for Beta distribution, or null if no signal
 */
export function scoreShadow(
  predictions: string[],
  actuals: CurateLogOperation[],
): null | {alpha: number; beta: number} {
  // Guard: if zero operations extracted (truncation, parse failure), skip update entirely
  if (actuals.length === 0) return null

  const actualPaths = new Set(
    actuals
      .filter((op) => op.status === 'success')
      .map((op) => normalizePathForShadowScore(op.path))
      .filter((path) => path.length > 0),
  )
  if (actualPaths.size === 0) return null // all ops failed — not a template quality signal

  const predictedPaths = new Set(
    predictions
      .map((prediction) => normalizePathForShadowScore(prediction))
      .filter((prediction) => prediction.length > 0),
  )
  if (predictedPaths.size === 0) return null // template made no predictions

  // Prefix-match F1: a prediction matches an actual path if the actual path
  // starts with the predicted domain route. Template predictions are domain-level
  // (e.g. "security/authentication") while actual paths include subtopics
  // (e.g. "security/authentication/jwt"). Exact match would always yield F1 ≈ 0.
  const matched = [...predictedPaths].filter((predicted) =>
    [...actualPaths].some((actual) => actual === predicted || actual.startsWith(`${predicted}/`)),
  ).length
  const precision = matched / predictedPaths.size
  const recall = matched / actualPaths.size
  // When matched === 0: precision and recall are both 0, so 0/0 = NaN.
  // This is a real negative signal (complete miss) — score as f1 = 0.
  const f1 = (precision + recall > 0) ? 2 * precision * recall / (precision + recall) : 0

  return {alpha: f1, beta: 1 - f1}
}

function normalizePathForShadowScore(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replaceAll(/^\/+|\/+$/g, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
}

/**
 * Extract predicted domain paths from a template's YAML content.
 *
 * Parses domainRouting entries using js-yaml to handle all valid YAML
 * variants (block lists, reordered keys, quoted scalars, etc.) that
 * LLM-refined templates may produce.
 *
 * @param templateContent - YAML template content
 * @param inputContext - The input context being curated (for keyword matching)
 * @returns Array of predicted domain paths
 */
export function extractPredictionsFromTemplate(
  templateContent: string,
  inputContext: string,
): string[] {
  const predictions: string[] = []
  const contextLower = inputContext.toLowerCase()

  let parsed: unknown
  try {
    parsed = yaml.load(templateContent)
  } catch {
    // Invalid YAML — return no predictions (neutral signal)
    return predictions
  }

  if (!parsed || typeof parsed !== 'object') return predictions

  const template = parsed as Record<string, unknown>
  const routing = template.domainRouting

  if (!Array.isArray(routing)) return predictions

  for (const entry of routing) {
    if (!entry || typeof entry !== 'object') continue

    const entryObj = entry as Record<string, unknown>
    const {keywords} = entryObj
    const {domain} = entryObj

    if (!Array.isArray(keywords) || typeof domain !== 'string') continue

    const keywordStrings = keywords
      .filter((k): k is string => typeof k === 'string')
      .map((k) => k.toLowerCase())

    if (keywordStrings.some((k) => contextLower.includes(k))) {
      predictions.push(domain)
    }
  }

  return predictions
}
