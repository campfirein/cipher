import type {QueryResult} from '../../core/domain/swarm/types.js'

/**
 * Options for the RRF merger.
 */
export type MergerOptions = {
  /** RRF constant (default: 60) */
  K?: number
  /** Maximum results to return (default: 10) */
  maxResults?: number
}

/**
 * Fuse results from multiple providers using Weighted Reciprocal Rank Fusion.
 *
 * Algorithm:
 *   RRF_score(r) = Σᵢ wᵢ / (K + rankᵢ(r))
 *   where wᵢ is the provider weight and rankᵢ(r) is the 0-based rank.
 *
 * Deduplication: results with identical content are merged (highest provider weight kept).
 *
 * @param resultSets - Map of provider ID → ranked results
 * @param providerWeights - Map of provider ID → weight (0-1)
 * @param options - Merger options
 * @returns Fused, ranked, deduplicated results
 */
export function mergeResults(
  resultSets: Map<string, QueryResult[]>,
  providerWeights: Map<string, number>,
  options?: MergerOptions
): QueryResult[] {
  const K = options?.K ?? 60
  const maxResults = options?.maxResults ?? 10

  const deduped = new Map<string, Array<{rank: number; result: QueryResult; weight: number}>>()

  for (const [providerId, results] of resultSets) {
    const weight = providerWeights.get(providerId) ?? 0.5
    const seenContent = new Set<string>()

    for (const [rank, result] of results.entries()) {
      if (seenContent.has(result.content)) {
        continue
      }

      seenContent.add(result.content)
      const existing = deduped.get(result.content) ?? []
      existing.push({rank, result, weight})
      deduped.set(result.content, existing)
    }
  }

  const scored: Array<{result: QueryResult; rrfScore: number}> = []

  for (const [, occurrences] of deduped) {
    let rrfScore = 0
    let bestContribution = -1
    let representative = occurrences[0]?.result

    for (const occurrence of occurrences) {
      const contribution = occurrence.weight / (K + occurrence.rank)
      rrfScore += contribution

      if (
        contribution > bestContribution ||
        (contribution === bestContribution && occurrence.result.score > (representative?.score ?? -1))
      ) {
        bestContribution = contribution
        representative = occurrence.result
      }
    }

    if (representative) {
      scored.push({result: {...representative, score: rrfScore}, rrfScore})
    }
  }

  // Sort descending by RRF score, limit
  scored.sort((a, b) => b.rrfScore - a.rrfScore)

  return scored.slice(0, maxResults).map((s) => s.result)
}
