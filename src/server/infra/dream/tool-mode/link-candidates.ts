/**
 * Link candidate generator for tool-mode dream.
 *
 * Deterministic — no LLM. The daemon enumerates topics, BM25-searches each
 * one's title+summary to discover related topics, filters out self-matches
 * and existing links, and dedup'es symmetric pairs. The calling agent then
 * decides per pair whether to actually link by emitting UPDATE HTML through
 * `brv curate`.
 *
 * The generator does NOT touch the existing `operations/consolidate.ts` —
 * tool-mode runs alongside the legacy daemon-LLM dream and reuses only the
 * BM25 search service.
 */

import type {ISearchKnowledgeService} from '../../../../agent/infra/sandbox/tools-sdk.js'

/**
 * Pre-parsed topic input. The session manager reads each topic's HTML
 * once upstream so the generator can stay pure and fast.
 */
export type LinkCandidateTopic = {
  /** Parsed `related=` attribute on <bv-topic>, lowercase paths. Empty if no related attr. */
  alreadyLinkedTo: string[]
  /** Full raw HTML of the topic — included in candidates so the agent reads without a second round-trip. */
  html: string
  /** Relative path under .brv/context-tree/, e.g. "security/jwt.html". */
  path: string
  /** Topic summary attr value, or empty string. */
  summary: string
  /** Topic title attr value. */
  title: string
}

export type LinkCandidate = {
  /** Full HTML of the lex-smaller path's topic. */
  htmlA: string
  /** Full HTML of the lex-larger path's topic. */
  htmlB: string
  /** [pathA, pathB], lex-sorted. */
  pair: [string, string]
  /** BM25 score — max of the two symmetric search hits between the pair. */
  score: number
}

export type FindLinkCandidatesOptions = {
  /** Default 20. Cap on returned candidates after sorting by score desc. */
  maxCandidates?: number
  /** Optional path prefix; topics outside it are neither sources nor targets. */
  scope?: string
  /** Default 0.5. Pairs below this score are dropped. */
  scoreThreshold?: number
}

const DEFAULT_MAX_CANDIDATES = 20
const DEFAULT_SCORE_THRESHOLD = 0.5
/** BM25 limit per source-topic search. Generous so we don't miss high-score hits. */
const SEARCH_LIMIT_PER_TOPIC = 10

/**
 * Find link candidates across the supplied topics.
 *
 * For each in-scope topic, search using `title + " " + summary` as the
 * BM25 query and consider every hit above the score threshold. Symmetric
 * pairs (A→B and B→A) are dedup'ed and keep the higher of the two scores.
 *
 * Returns at most `maxCandidates` pairs, sorted by score descending.
 */
export async function findLinkCandidates(params: {
  options?: FindLinkCandidatesOptions
  searchService: ISearchKnowledgeService
  topics: LinkCandidateTopic[]
}): Promise<LinkCandidate[]> {
  const {options, searchService, topics} = params
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const scoreThreshold = options?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
  const scope = options?.scope

  const inScope = scope ? topics.filter((t) => t.path.startsWith(scope)) : topics
  if (inScope.length < 2) return []

  const byPath = new Map<string, LinkCandidateTopic>(inScope.map((t) => [t.path, t]))

  // Search all topics in parallel. Each per-topic search is independent;
  // sequencing them would just add wall-clock latency without correctness benefit.
  const perTopicHits = await Promise.all(
    inScope.map(async (source) => {
      const query = `${source.title} ${source.summary}`.trim()
      if (!query) return {hits: [], source}
      const result = await searchService.search(query, {limit: SEARCH_LIMIT_PER_TOPIC})
      return {hits: result.results, source}
    }),
  )

  // Accumulate symmetric pairs keyed by the lex-canonical "a|b" form.
  const pairs = new Map<string, {pair: [string, string]; score: number}>()
  for (const {hits, source} of perTopicHits) {
    for (const hit of hits) {
      if (hit.score < scoreThreshold) continue
      if (hit.path === source.path) continue
      if (!byPath.has(hit.path)) continue // out-of-scope target
      if (source.alreadyLinkedTo.includes(hit.path)) continue
      const target = byPath.get(hit.path)
      if (target?.alreadyLinkedTo.includes(source.path)) continue

      const [a, b] = source.path < hit.path ? [source.path, hit.path] : [hit.path, source.path]
      const key = `${a}|${b}`
      const existing = pairs.get(key)
      if (!existing || hit.score > existing.score) {
        pairs.set(key, {pair: [a, b], score: hit.score})
      }
    }
  }

  return [...pairs.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, maxCandidates)
    .map(({pair, score}): LinkCandidate => {
      const topicA = byPath.get(pair[0])
      const topicB = byPath.get(pair[1])
      // Map guard — both must exist since we sourced both from the same map.
      if (!topicA || !topicB) throw new Error(`link-candidates: pair lookup failed for ${pair[0]} or ${pair[1]}`)
      return {htmlA: topicA.html, htmlB: topicB.html, pair, score}
    })
}
