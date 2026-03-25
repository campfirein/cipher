/**
 * Query reranker template — re-orders results based on domain coherence
 * and query classification heuristics.
 *
 * Pure computation, no I/O. Must complete in < 5ms.
 */

import {load as yamlLoad} from 'js-yaml'

import type {SearchKnowledgeResult} from '../../../../agent/infra/sandbox/tools-sdk.js'

// ── Types ───────────────────────────────────────────────────────────────────

interface QueryClassificationRule {
  boost: number
  domains: string[]
  type: string
}

interface RerankTemplate {
  reranking?: {
    domainCoherenceWeight?: number
    queryClassification?: Record<string, QueryClassificationRule>
  }
}

type QueryType = 'exploratory' | 'factual' | 'unknown'

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Classify a query using simple heuristics.
 *
 * - Contains "how" → exploratory
 * - Contains "what is" → factual
 * - Otherwise → unknown
 */
function classifyQuery(query: string): QueryType {
  const lower = query.toLowerCase()
  if (lower.includes('what is') || lower.includes('what are') || lower.includes('define')) {
    return 'factual'
  }

  if (lower.includes('how') || lower.includes('why') || lower.includes('explain')) {
    return 'exploratory'
  }

  return 'unknown'
}

/**
 * Extract the domain prefix from a symbolPath.
 * e.g., "architecture/api/auth" → "architecture/api"
 */
function extractDomain(symbolPath: string): string {
  const parts = symbolPath.split('/')
  if (parts.length <= 2) {
    return symbolPath
  }

  return parts.slice(0, 2).join('/')
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Re-rank results based on domain coherence and query classification.
 *
 * - Domain coherence: boost results from the same domain as the top-scoring result
 * - Query classification: apply boosts from template rules matching the query type
 *
 * @param results - Search results to re-rank
 * @param templateContent - YAML template with `reranking` section
 * @param query - Original search query
 * @returns Re-ranked results sorted by adjusted score
 */
export function rerankResults(
  results: SearchKnowledgeResult['results'],
  templateContent: string,
  query: string,
): SearchKnowledgeResult['results'] {
  if (results.length === 0) {
    return results
  }

  let template: RerankTemplate
  try {
    template = (yamlLoad(templateContent) as RerankTemplate) ?? {}
  } catch {
    return results
  }

  const reranking = template.reranking ?? {}
  const domainCoherenceWeight = typeof reranking.domainCoherenceWeight === 'number' ? reranking.domainCoherenceWeight : 0
  const classificationRules = reranking.queryClassification ?? {}

  // Build per-result deltas without mutating inputs
  const topDomain = results[0]?.symbolPath ? extractDomain(results[0].symbolPath) : undefined
  const queryType = classifyQuery(query)
  const rule = queryType === 'unknown' ? undefined : classificationRules[queryType]
  const ruleDomains = rule && typeof rule.boost === 'number' && Array.isArray(rule.domains)
    ? rule.domains.map((d: string) => d.toLowerCase())
    : undefined

  const reranked = results.map((result, index) => {
    let delta = 0

    // Domain coherence: boost same-domain as top result (skip top itself)
    if (domainCoherenceWeight !== 0 && index > 0 && topDomain && result.symbolPath && extractDomain(result.symbolPath) === topDomain) {
      delta += domainCoherenceWeight
    }

    // Query classification boost
    if (ruleDomains && rule && typeof rule.boost === 'number' && result.symbolPath) {
      const resultDomain = extractDomain(result.symbolPath).toLowerCase()
      if (ruleDomains.some((rd: string) => resultDomain.includes(rd))) {
        delta += rule.boost
      }
    }

    // Clamp to [0, 0.9999] — prevents false Tier-2 direct hits
    return {...result, score: Math.max(0, Math.min(0.9999, result.score + delta))}
  })

  // Re-sort descending by score
  reranked.sort((a, b) => b.score - a.score)

  return reranked
}
