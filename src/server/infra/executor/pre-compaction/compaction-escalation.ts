/**
 * Compaction escalation utilities for pre-curation context compaction.
 *
 * Ported from VoltCode's compaction-escalation.ts with additions:
 * - isCompactionOutputValid() quality gate for rejecting LLM refusals
 *
 * Pure utility functions — no external dependencies.
 */

const CHARS_PER_TOKEN = 4

/**
 * Escalation tiers for compaction-generation passes.
 */
export type CompactionEscalationTier = 'aggressive' | 'fallback' | 'normal'

/**
 * Marker header appended to prompts in aggressive mode.
 */
const AGGRESSIVE_DIRECTIVE_HEADER = '## Aggressive Compression Override'

/**
 * Heuristic token estimation: round(length / 4).
 * Same as VoltCode's Token.estimate().
 */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.round((text || '').length / CHARS_PER_TOKEN))
}

/**
 * Check whether a compaction output is acceptable for convergence.
 * Requires non-empty content and strict token reduction versus the source.
 */
export function shouldAcceptCompactionOutput(output: string, inputTokens: number): boolean {
  const trimmed = output.trim()
  if (!trimmed) return false
  if (!Number.isFinite(inputTokens) || inputTokens <= 1) return false

  return estimateTokens(trimmed) < inputTokens
}

/**
 * Quality gate: reject LLM refusals and trivially short output.
 *
 * - Rejects output < 50 chars (likely a disclaimer)
 * - Rejects common LLM refusal/disclaimer patterns
 * - Accepts >= 200 chars unconditionally (valid prose without markdown is fine)
 * - For 50-199 chars, requires at least one structural signal
 */
export function isCompactionOutputValid(output: string): boolean {
  const trimmed = output.trim()

  if (trimmed.length < 50) return false

  const REFUSAL_PATTERNS = [
    /^I (?:cannot|can't|am unable|don't have)/i,
    /^(?:not found|no (?:information|context|data))/i,
    /^(?:sorry|unfortunately|I apologize)/i,
    /^(?:as an AI|I'm an AI)/i,
    /^(?:based on (?:the|my) (?:knowledge|training))/i,
  ]
  if (REFUSAL_PATTERNS.some((p) => p.test(trimmed))) return false

  if (trimmed.length >= 200) return true

  return (
    trimmed.includes('```') ||
    trimmed.includes('| ') ||
    /^[-*]\s/m.test(trimmed) ||
    /^#{1,4}\s/m.test(trimmed) ||
    trimmed.split('\n').length >= 3
  )
}

/**
 * Append aggressive compression directive to a prompt.
 * Idempotent — does not double-append if already present.
 */
export function withAggressiveCompactionDirective(promptTemplate: string): string {
  if (promptTemplate.includes(AGGRESSIVE_DIRECTIVE_HEADER)) {
    return promptTemplate
  }

  return `${promptTemplate.trim()}\n\n${AGGRESSIVE_DIRECTIVE_HEADER}
- You are in escalation pass 2 because pass 1 was not shorter than input.
- Compress more aggressively than normal while preserving task-critical facts.
- Remove repetition, low-value narrative, and secondary detail.
- Output must still be coherent and safe for continuation.`
}

/**
 * Build deterministic fallback output (pass 3) by truncating source text until
 * it is strictly smaller than the source token count.
 *
 * Uses binary search to find the largest prefix that satisfies the strict
 * token-reduction goal.
 */
export function buildDeterministicFallbackCompaction(input: {
  inputTokens: number
  sourceText: string
  suffixLabel: string
}): string {
  const source = input.sourceText.trim()
  if (!source) return ''

  const targetTokens = Number.isFinite(input.inputTokens) ? Math.max(1, Math.floor(input.inputTokens)) : Infinity
  if (!Number.isFinite(targetTokens) || targetTokens <= 1) {
    return source
  }

  const suffix = `\n[${input.suffixLabel}; truncated from ${targetTokens} tokens]`
  const sourceLen = source.length

  const fitPrefix = (extra: string): string => {
    let lo = 1
    let hi = sourceLen
    let best = ''
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      const prefix = source.slice(0, mid).trimEnd()
      const candidate = `${prefix}${extra}`.trim()
      if (!candidate) {
        hi = mid - 1
        continue
      }

      const candidateTokens = estimateTokens(candidate)
      if (candidateTokens < targetTokens) {
        best = candidate
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    return best
  }

  const withSuffix = fitPrefix(suffix)
  if (withSuffix) return withSuffix

  const plainPrefix = fitPrefix('')
  if (plainPrefix) return plainPrefix

  return source.slice(0, 1)
}
