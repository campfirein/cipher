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

  // Domain coherence: boost results sharing the top result's domain
  if (domainCoherenceWeight !== 0 && results[0].symbolPath) {
    const topDomain = extractDomain(results[0].symbolPath)
    for (let i = 1; i < results.length; i++) {
      const result = results[i]
      if (result.symbolPath) {
        const resultDomain = extractDomain(result.symbolPath)
        if (resultDomain === topDomain) {
          result.score += domainCoherenceWeight
        }
      }
    }
  }

  // Query classification: apply matching rule boosts
  const queryType = classifyQuery(query)
  const rule = queryType === 'unknown' ? undefined : classificationRules[queryType]
  if (rule && typeof rule.boost === 'number' && Array.isArray(rule.domains)) {
    const ruleDomains = rule.domains.map((d) => d.toLowerCase())
    for (const result of results) {
      if (!result.symbolPath) continue
      const resultDomain = extractDomain(result.symbolPath).toLowerCase()
      if (ruleDomains.some((rd) => resultDomain.includes(rd))) {
        result.score += rule.boost
      }
    }
  }

  // Clamp to [0, 0.9999] — same as boost stage. Prevents learned rerank
  // weights from pushing weak matches past direct-search-responder thresholds.
  for (const result of results) {
    result.score = Math.max(0, Math.min(0.9999, result.score))
  }

  // Re-sort descending by score
  results.sort((a, b) => b.score - a.score)

  return results
}
